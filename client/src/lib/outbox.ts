/**
 * Outbox: persistent queue of mutations the user performed offline.
 *
 * Sits alongside the legacy `pending_readings` store (DB v2) used by the MVZ
 * field-capture flow — those readings continue to use their own store so we
 * don't risk losing in-flight queued data. New offline-safe mutations call
 * `enqueueOperation` and are flushed by `flushOutbox()` when connectivity
 * returns.
 *
 * Each operation carries a `clientOpId` (UUID v4) the server can use for
 * deduplication of retries (today the server simply ignores it).
 */

const DB_NAME = "agregen-offline";
const DB_VERSION = 3; // bumped from v2 to add the outbox store
const STORE_OUTBOX = "outbox_operations";
const STORE_READINGS = "pending_readings"; // legacy, kept for compatibility

export type OutboxStatus = "pending" | "syncing" | "failed";

export interface OutboxOperation {
  id: string;
  clientOpId: string;
  method: string;
  url: string;
  body?: unknown;
  contentType?: string;
  /** Short label shown in the UI tray ("Nueva parcela: Lote 7"). ~40 chars. */
  label?: string;
  /** TanStack Query keys to invalidate after a successful sync. */
  invalidateKeys?: string[][];
  enqueuedAt: string;
  attempts: number;
  lastAttemptAt?: string;
  lastError?: string;
  status: OutboxStatus;
}

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `op-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      // Preserve the legacy readings store untouched.
      if (!db.objectStoreNames.contains(STORE_READINGS)) {
        const store = db.createObjectStore(STORE_READINGS, { keyPath: "id" });
        store.createIndex("campaignId", "campaignId", { unique: false });
        store.createIndex("status", "status", { unique: false });
      } else {
        const tx = (e.target as IDBOpenDBRequest).transaction!;
        const store = tx.objectStore(STORE_READINGS);
        if (!store.indexNames.contains("status")) {
          store.createIndex("status", "status", { unique: false });
        }
      }
      // New outbox store (additive — no data loss).
      if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
        const store = db.createObjectStore(STORE_OUTBOX, { keyPath: "id" });
        store.createIndex("status", "status", { unique: false });
        store.createIndex("enqueuedAt", "enqueuedAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function enqueueOperation(
  op: Omit<OutboxOperation, "id" | "clientOpId" | "enqueuedAt" | "attempts" | "status">,
): Promise<OutboxOperation> {
  const record: OutboxOperation = {
    ...op,
    id: `op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    clientOpId: uuid(),
    enqueuedAt: new Date().toISOString(),
    attempts: 0,
    status: "pending",
  };
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_OUTBOX, "readwrite");
    tx.objectStore(STORE_OUTBOX).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  notifyListeners();
  return record;
}

export async function listOutbox(): Promise<OutboxOperation[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_OUTBOX, "readonly");
    const req = tx.objectStore(STORE_OUTBOX).getAll();
    req.onsuccess = () => {
      const items = (req.result as OutboxOperation[]).slice().sort(
        (a, b) => a.enqueuedAt.localeCompare(b.enqueuedAt),
      );
      resolve(items);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteOperation(id: string): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_OUTBOX, "readwrite");
    tx.objectStore(STORE_OUTBOX).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  notifyListeners();
}

async function patchOperation(id: string, patch: Partial<OutboxOperation>): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_OUTBOX, "readwrite");
    const store = tx.objectStore(STORE_OUTBOX);
    const get = store.get(id);
    get.onsuccess = () => {
      const cur = get.result as OutboxOperation | undefined;
      if (!cur) return;
      store.put({ ...cur, ...patch });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  notifyListeners();
}

export async function countPending(): Promise<number> {
  const items = await listOutbox();
  return items.filter((o) => o.status !== "syncing").length;
}

// ---------------------------------------------------------------- listeners --
type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeOutbox(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyListeners(): void {
  listeners.forEach((l) => {
    try { l(); } catch { /* ignore */ }
  });
}

// ----------------------------------------------------------------- flushing --
const MAX_ATTEMPTS = 8;
let flushInFlight = false;

export interface FlushResult {
  attempted: number;
  succeeded: number;
  failed: number;
  invalidated: string[][];
}

/**
 * Try to send every pending operation in FIFO order. Errors classified as
 * "client" (4xx other than 408/409/429) are kept in the queue with status
 * "failed" so the user can dismiss them; transient errors stay "pending"
 * with an exponential backoff applied via the attempts counter.
 */
export async function flushOutbox(): Promise<FlushResult> {
  if (flushInFlight) {
    return { attempted: 0, succeeded: 0, failed: 0, invalidated: [] };
  }
  flushInFlight = true;
  const result: FlushResult = { attempted: 0, succeeded: 0, failed: 0, invalidated: [] };
  try {
    const items = await listOutbox();
    for (const op of items) {
      if (op.status === "syncing") continue;
      if (op.attempts > 0 && op.lastAttemptAt) {
        const waitMs = Math.min(60_000, Math.pow(2, op.attempts) * 1000);
        const since = Date.now() - new Date(op.lastAttemptAt).getTime();
        if (since < waitMs) continue;
      }
      result.attempted++;
      await patchOperation(op.id, { status: "syncing" });
      try {
        const headers: Record<string, string> = {
          "Content-Type": op.contentType || "application/json",
          "X-Client-Op-Id": op.clientOpId,
        };
        const res = await fetch(op.url, {
          method: op.method,
          headers,
          credentials: "include",
          body: op.body !== undefined ? JSON.stringify(op.body) : undefined,
        });
        if (res.ok) {
          await deleteOperation(op.id);
          result.succeeded++;
          if (op.invalidateKeys) result.invalidated.push(...op.invalidateKeys);
          continue;
        }
        if (res.status >= 400 && res.status < 500 && ![408, 409, 429].includes(res.status)) {
          const errText = await res.text().catch(() => "");
          await patchOperation(op.id, {
            status: "failed",
            attempts: op.attempts + 1,
            lastAttemptAt: new Date().toISOString(),
            lastError: `${res.status}: ${errText.slice(0, 200)}`,
          });
          result.failed++;
          continue;
        }
        await patchOperation(op.id, {
          status: "pending",
          attempts: op.attempts + 1,
          lastAttemptAt: new Date().toISOString(),
          lastError: `${res.status}`,
        });
        result.failed++;
      } catch (err) {
        const next = op.attempts + 1;
        await patchOperation(op.id, {
          status: next >= MAX_ATTEMPTS ? "failed" : "pending",
          attempts: next,
          lastAttemptAt: new Date().toISOString(),
          lastError: err instanceof Error ? err.message : "network",
        });
        result.failed++;
      }
    }
  } finally {
    flushInFlight = false;
  }
  return result;
}

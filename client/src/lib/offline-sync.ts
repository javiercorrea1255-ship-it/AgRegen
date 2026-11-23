const DB_NAME = "agregen-offline";
// Bumped to 3 in lockstep with `outbox.ts` so that opening this DB after the
// outbox upgrade doesn't throw a VersionError. The legacy `pending_readings`
// store is preserved by the outbox onupgradeneeded handler.
const DB_VERSION = 3;
const STORE_READINGS = "pending_readings";

export type PendingReadingStatus = "pending" | "discarded";

export interface PendingReading {
  id: string;
  campaignId: string;
  pointId: string;
  value: number;
  latActual?: number;
  lonActual?: number;
  temperatureC?: number;
  soilCondition?: string;
  notes?: string;
  nSubsamples?: number;
  photoBase64?: string;
  photoMime?: string;
  capturedAt: string;
  syncAttempts: number;
  /** "pending" until synced; "discarded" when the server reports the point no longer exists. */
  status?: PendingReadingStatus;
  /** Human-readable reason a reading was discarded (shown in the UI tray). */
  discardReason?: string;
  /** When the reading was discarded (ISO). */
  discardedAt?: string;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
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
      // Co-create the outbox store so v3 schema converges no matter which
      // module opens the DB first (this one or `outbox.ts`). Both upgrade
      // handlers must be idempotent and produce the same final schema.
      if (!db.objectStoreNames.contains("outbox_operations")) {
        const store = db.createObjectStore("outbox_operations", { keyPath: "id" });
        store.createIndex("status", "status", { unique: false });
        store.createIndex("enqueuedAt", "enqueuedAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function patchPendingReading(id: string, patch: Partial<PendingReading>): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_READINGS, "readwrite");
    const store = tx.objectStore(STORE_READINGS);
    const get = store.get(id);
    get.onsuccess = () => {
      const cur = get.result as PendingReading | undefined;
      if (!cur) return;
      store.put({ ...cur, ...patch });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Returns only readings still awaiting sync (status === "pending" or undefined). */
export async function getActivePendingReadings(campaignId?: string): Promise<PendingReading[]> {
  const all = await getPendingReadings(campaignId);
  return all.filter((r) => (r.status ?? "pending") === "pending");
}

/** Returns readings that the server marked as obsolete — to show in a tray. */
export async function getDiscardedReadings(campaignId?: string): Promise<PendingReading[]> {
  const all = await getPendingReadings(campaignId);
  return all.filter((r) => r.status === "discarded");
}

/** Permanently removes a discarded reading after the operator acknowledges it. */
export async function dismissDiscardedReading(id: string): Promise<void> {
  return deletePendingReading(id);
}

export async function savePendingReading(
  reading: Omit<PendingReading, "id" | "syncAttempts">
): Promise<string> {
  const db = await openDB();
  const id = `${reading.campaignId}-${reading.pointId}-${Date.now()}`;
  const record: PendingReading = { ...reading, id, syncAttempts: 0 };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_READINGS, "readwrite");
    tx.objectStore(STORE_READINGS).put(record);
    tx.oncomplete = () => resolve(id);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getPendingReadings(campaignId?: string): Promise<PendingReading[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_READINGS, "readonly");
    const store = tx.objectStore(STORE_READINGS);
    const request = campaignId
      ? store.index("campaignId").getAll(campaignId)
      : store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function deletePendingReading(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_READINGS, "readwrite");
    tx.objectStore(STORE_READINGS).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function uploadOfflinePhoto(pointId: string, base64: string, mime: string): Promise<void> {
  try {
    const byteString = atob(base64);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
    const blob = new Blob([ab], { type: mime });
    const ext = mime.split("/")[1] || "jpg";
    const formData = new FormData();
    formData.append("photo", blob, `offline-photo.${ext}`);
    await fetch(`/api/sampling-points/${pointId}/photo`, {
      method: "POST",
      credentials: "include",
      body: formData,
    });
  } catch {
    // Photo upload failure is non-blocking — reading value is already saved
  }
}

export async function syncPendingReadings(
  campaignId: string
): Promise<{ synced: number; failed: number; discarded: number; syncedPointIds: string[] }> {
  const pending = await getActivePendingReadings(campaignId);
  if (pending.length === 0) return { synced: 0, failed: 0, discarded: 0, syncedPointIds: [] };

  const readings = pending.map((r) => ({
    pointId: r.pointId,
    value: r.value,
    latActual: r.latActual ?? null,
    lonActual: r.lonActual ?? null,
    notes: r.notes ?? null,
    soilCondition: r.soilCondition ?? null,
    nSubsamples: r.nSubsamples ?? 1,
    temperatureC: r.temperatureC ?? null,
  }));

  try {
    const res = await fetch(`/api/sampling-campaigns/${campaignId}/sync-readings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ readings }),
    });

    if (!res.ok) {
      return { synced: 0, failed: pending.length, discarded: 0, syncedPointIds: [] };
    }

    const body = await res.json();
    const details: { pointId: string; updated: boolean; missing?: boolean }[] = body.details || [];

    const detailByPoint = new Map(details.map((d) => [d.pointId, d]));
    const syncedPointIds = details.filter((d) => d.updated).map((d) => d.pointId);

    let synced = 0;
    let failed = 0;
    let discarded = 0;
    for (const r of pending) {
      const detail = detailByPoint.get(r.pointId);
      if (detail?.updated) {
        // Upload offline photo if present (best-effort, non-blocking)
        if (r.photoBase64 && r.photoMime) {
          await uploadOfflinePhoto(r.pointId, r.photoBase64, r.photoMime);
        }
        await deletePendingReading(r.id);
        synced++;
      } else if (detail?.missing) {
        // Server says the point no longer exists (campaign regenerated, etc.).
        // Mark as discarded — keep the reading in the local queue with a
        // reason so the operator can review it from the "no sincronizables"
        // tray in the field-capture UI before deciding to dismiss it.
        await patchPendingReading(r.id, {
          status: "discarded",
          discardReason: "El punto destino ya no existe en el servidor (la campaña pudo haber sido regenerada).",
          discardedAt: new Date().toISOString(),
        });
        discarded++;
      } else {
        failed++;
      }
    }

    return { synced, failed, discarded, syncedPointIds };
  } catch {
    return { synced: 0, failed: pending.length, discarded: 0, syncedPointIds: [] };
  }
}

export async function countPendingReadings(campaignId?: string): Promise<number> {
  const readings = await getPendingReadings(campaignId);
  return readings.length;
}

export function fileToBase64(file: File): Promise<{ base64: string; mime: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1];
      resolve({ base64, mime: file.type || "image/jpeg" });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

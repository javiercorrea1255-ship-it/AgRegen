/**
 * Connectivity context — single source of truth for online/offline state and
 * the pending outbox count. Components subscribe via `useConnectivity()`.
 *
 * Auto-flushes the outbox when the browser fires `online` (debounced so a
 * flapping connection doesn't hammer the server) and polls every 30 s while
 * there are pending items in case the browser missed the online event.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { countPending, flushOutbox, listOutbox, subscribeOutbox, deleteOperation, type OutboxOperation } from "@/lib/outbox";

interface ConnectivityValue {
  isOnline: boolean;
  pendingCount: number;
  outbox: OutboxOperation[];
  syncing: boolean;
  syncNow: () => Promise<void>;
  dismiss: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<ConnectivityValue | null>(null);

export function ConnectivityProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  const [pendingCount, setPendingCount] = useState(0);
  const [outbox, setOutbox] = useState<OutboxOperation[]>([]);
  const [syncing, setSyncing] = useState(false);
  const qc = useQueryClient();
  const flushTimeoutRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [list, count] = await Promise.all([listOutbox(), countPending()]);
      setOutbox(list);
      setPendingCount(count);
    } catch {
      /* IndexedDB unavailable — keep defaults */
    }
  }, []);

  const syncNow = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const result = await flushOutbox();
      if (result.invalidated.length > 0) {
        for (const key of result.invalidated) {
          qc.invalidateQueries({ queryKey: key });
        }
      }
    } finally {
      setSyncing(false);
      await refresh();
    }
  }, [qc, refresh, syncing]);

  const dismiss = useCallback(async (id: string) => {
    await deleteOperation(id);
    await refresh();
  }, [refresh]);

  useEffect(() => {
    refresh();
    return subscribeOutbox(() => { void refresh(); });
  }, [refresh]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      if (flushTimeoutRef.current) window.clearTimeout(flushTimeoutRef.current);
      flushTimeoutRef.current = window.setTimeout(() => { void syncNow(); }, 1500);
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      if (flushTimeoutRef.current) window.clearTimeout(flushTimeoutRef.current);
    };
  }, [syncNow]);

  useEffect(() => {
    if (pendingCount === 0) return;
    const interval = window.setInterval(() => {
      if (navigator.onLine && !syncing) void syncNow();
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [pendingCount, syncNow, syncing]);

  const value = useMemo<ConnectivityValue>(() => ({
    isOnline,
    pendingCount,
    outbox,
    syncing,
    syncNow,
    dismiss,
    refresh,
  }), [isOnline, pendingCount, outbox, syncing, syncNow, dismiss, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useConnectivity(): ConnectivityValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useConnectivity must be used inside ConnectivityProvider");
  return v;
}

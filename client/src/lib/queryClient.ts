import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { enqueueOperation } from "@/lib/outbox";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export interface ApiRequestOptions {
  /**
   * If true and the network is unreachable (or the SW returns the synthetic
   * 503 offline response), the mutation is enqueued in the local outbox and
   * resolves with `{ queued: true }` instead of throwing. The UI should show
   * a "guardado localmente" toast.
   */
  offlineSafe?: boolean;
  /** Short label shown in the offline tray for queued operations. */
  offlineLabel?: string;
  /** Query keys to invalidate after the queued op syncs successfully. */
  invalidateOnSync?: string[][];
}

export interface ApiRequestQueued {
  queued: true;
  clientOpId: string;
}

function isOfflineLike(err: unknown): boolean {
  if (typeof err === "object" && err && "message" in err) {
    const m = String((err as Error).message || "");
    return /Failed to fetch|NetworkError|Load failed|offline/i.test(m);
  }
  return false;
}

export function apiRequest(
  method: string,
  url: string,
  data?: unknown,
): Promise<Response>;
export function apiRequest(
  method: string,
  url: string,
  data: unknown,
  options: ApiRequestOptions & { offlineSafe: true },
): Promise<Response | ApiRequestQueued>;
export function apiRequest(
  method: string,
  url: string,
  data?: unknown,
  options?: ApiRequestOptions,
): Promise<Response | ApiRequestQueued>;
export async function apiRequest(
  method: string,
  url: string,
  data?: unknown,
  options?: ApiRequestOptions,
): Promise<Response | ApiRequestQueued> {
  const offlineSafe = !!options?.offlineSafe;
  try {
    const res = await fetch(url, {
      method,
      headers: data ? { "Content-Type": "application/json" } : {},
      body: data !== undefined ? JSON.stringify(data) : undefined,
      credentials: "include",
    });

    // The SW emits a 503 with X-Offline-Cache: miss when offline.
    if (offlineSafe && res.status === 503 && res.headers.get("X-Offline-Cache") === "miss") {
      const op = await enqueueOperation({
        method,
        url,
        body: data,
        label: options?.offlineLabel,
        invalidateKeys: options?.invalidateOnSync,
      });
      return { queued: true, clientOpId: op.clientOpId };
    }

    await throwIfResNotOk(res);
    return res;
  } catch (err) {
    if (offlineSafe && (isOfflineLike(err) || !navigator.onLine)) {
      const op = await enqueueOperation({
        method,
        url,
        body: data,
        label: options?.offlineLabel,
        invalidateKeys: options?.invalidateOnSync,
      });
      return { queued: true, clientOpId: op.clientOpId };
    }
    throw err;
  }
}

export function isQueued(result: Response | ApiRequestQueued): result is ApiRequestQueued {
  return (result as ApiRequestQueued).queued === true;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});

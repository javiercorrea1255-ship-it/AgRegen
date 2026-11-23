/**
 * Register the AgRegen service worker for the installable PWA.
 *
 * - Production only: registering a SW in dev would cache stale Vite HMR assets
 *   and break the dev experience.
 * - Registers after `load` so it never competes with first-paint.
 * - On a controllerchange (new SW activated), reload once to pick up new assets.
 * - Silently no-ops when SW is unsupported (older Safari, some embedded browsers).
 *
 * In dev: if the browser still has a service worker registered from a previous
 * production visit (e.g. when the user previews `*.replit.app` and then opens
 * the dev URL), it would keep serving stale precached HTML — including the old
 * SSR shell injected inside `#root` — and produce visible "ghost" content
 * overlapping the live React tree. To prevent that, on dev we proactively
 * unregister any existing SW and wipe its caches once per page load.
 */
export function registerServiceWorker(): void {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  if (!import.meta.env.PROD) {
    void purgeStaleServiceWorker();
    return;
  }

  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch((err) => {
        console.warn("[pwa] service worker registration failed:", err);
      });
  });
}

async function purgeStaleServiceWorker(): Promise<void> {
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    if (registrations.length === 0) return;

    await Promise.all(registrations.map((reg) => reg.unregister().catch(() => false)));

    if (typeof caches !== "undefined") {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k).catch(() => false)));
    }

    console.info(
      "[pwa] removed stale service worker from a prior production visit; reload to see fresh content",
    );
  } catch (err) {
    console.warn("[pwa] could not purge stale service worker:", err);
  }
}

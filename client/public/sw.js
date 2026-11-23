/* AgRegen service worker — offline-first for mobile field use.
 *
 * Strategy:
 *  - App shell: network-first for HTML navigations; on failure, fall back to
 *    the cached SPA shell ("/") so React can mount with cached API data.
 *    Last-ditch fallback is the static /offline.html.
 *  - JS/CSS bundles + fonts + icons: stale-while-revalidate.
 *  - Whitelisted API GETs: network-first with cache fallback. Cached responses
 *    carry X-Offline-Cache: hit + X-Offline-Cached-At so the UI can show
 *    "datos del DD/MM HH:MM" badges.
 *  - Earth Engine + map tiles (cross-origin): cache-first with LRU eviction.
 *  - NEVER cache /auth/*, mutations, /api/auth/me (session-scoped), uploads,
 *    interpolation/AI endpoints, or non-GET requests.
 *
 * Bump CACHE_VERSION whenever this file or the precache list changes.
 */
const CACHE_VERSION = "agregen-v6-offline";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const ASSET_CACHE = `${CACHE_VERSION}-assets`;
const API_CACHE = `${CACHE_VERSION}-api`;
const TILE_CACHE = `${CACHE_VERSION}-tiles`;

const PRECACHE_URLS = [
  "/",
  "/offline.html",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/apple-touch-icon.png",
  "/favicon.png",
];

// API GETs whose pathname is safe to cache for offline reads.
const API_CACHEABLE_PATTERNS = [
  /^\/api\/parcels(\/|$|\?)/,
  /^\/api\/parcels\/[^/]+(\/|$|\?)/,
  /^\/api\/sampling-campaigns(\/|$|\?)/,
  /^\/api\/sampling-campaigns\/[^/]+(\/|$|\?)/,
  /^\/api\/sampling-points(\/|$|\?)/,
  /^\/api\/sampling-points\/[^/]+(\/|$|\?)/,
  /^\/api\/master-variables(\/|$|\?)/,
  /^\/api\/community\/posts(\/|$|\?)/,
  /^\/api\/conferences(\/|$|\?)/,
  /^\/api\/nutrition-programs(\/|$|\?)/,
  /^\/api\/nutrition-programs\/[^/]+(\/|$|\?)/,
  /^\/api\/zone-sets(\/|$|\?)/,
  /^\/api\/zone-sets\/[^/]+(\/|$|\?)/,
  /^\/api\/alerts(\/|$|\?)/,
  /^\/api\/parcels\/[^/]+\/amendments-snapshot(\/|$|\?)/,
];

// API endpoints we must NEVER cache.
const API_NEVER_CACHE = [
  // Field notes and private evidence require a fresh parcel permission check.
  /^\/api\/parcels\/[^/]+\/soil-health(?:\/|$)/,
  /^\/api\/auth\//,
  /^\/api\/uploads\//,
  /^\/api\/.*\/photo$/,
  /^\/api\/.*\/avatar$/,
  /^\/api\/.*\/interpolate/,
  /^\/api\/.*\/ai\//,
  /^\/api\/admin\//,
];

// Cross-origin tile providers (best-effort; opaque responses when CORS blocks).
const TILE_HOST_PATTERNS = [
  /earthengine\.googleapis\.com$/,
  /tile\.openstreetmap\.org$/,
  /tile\.opentopomap\.org$/,
  /\.basemaps\.cartocdn\.com$/,
];

const TILE_CACHE_MAX_ENTRIES = 600;
const API_CACHE_MAX_ENTRIES = 200;

self.addEventListener("install", (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(STATIC_CACHE).then((cache) =>
        Promise.all(
          PRECACHE_URLS.map((url) =>
            cache.add(url).catch((err) => {
              console.warn("[sw] precache miss", url, err);
            }),
          ),
        ),
      ),
      // Warm the shell cache with the root document so the SPA is openable
      // offline immediately after install.
      caches.open(SHELL_CACHE).then((cache) =>
        fetch("/", { credentials: "include" })
          .then((res) => (res.ok ? cache.put("/", res.clone()) : null))
          .catch(() => null),
      ),
    ]),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => !k.startsWith(CACHE_VERSION))
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

function pathMatchesAny(pathname, patterns) {
  return patterns.some((p) => p.test(pathname));
}

function isApiCacheable(url) {
  if (pathMatchesAny(url.pathname, API_NEVER_CACHE)) return false;
  return pathMatchesAny(url.pathname, API_CACHEABLE_PATTERNS);
}

function isApiPath(url) {
  return url.pathname.startsWith("/api/");
}

function isAuthPath(url) {
  return url.pathname.startsWith("/auth/") || url.pathname.startsWith("/api/auth/");
}

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/partners/") ||
    /^\/icon-/.test(url.pathname) ||
    url.pathname === "/opengraph.jpg" ||
    url.pathname === "/favicon.png" ||
    url.pathname === "/apple-touch-icon.png" ||
    url.pathname === "/manifest.webmanifest"
  );
}

function isTileHost(url) {
  return TILE_HOST_PATTERNS.some((re) => re.test(url.host));
}

async function trimCache(cacheName, maxEntries) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length <= maxEntries) return;
    const toDelete = keys.slice(0, keys.length - maxEntries);
    await Promise.all(toDelete.map((req) => cache.delete(req)));
  } catch {
    /* ignore */
  }
}

async function withOfflineHeaders(response, cachedAt) {
  if (!response) return response;
  const headers = new Headers(response.headers);
  headers.set("X-Offline-Cache", "hit");
  if (cachedAt) headers.set("X-Offline-Cached-At", cachedAt);
  const body = await response.clone().blob();
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function networkFirstWithCache(req, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) {
      const cloned = fresh.clone();
      const stampHeaders = new Headers(cloned.headers);
      stampHeaders.set("X-Offline-Cached-At", new Date().toISOString());
      const stamped = new Response(await cloned.blob(), {
        status: cloned.status,
        statusText: cloned.statusText,
        headers: stampHeaders,
      });
      cache.put(req, stamped).then(() => trimCache(cacheName, maxEntries));
    }
    return fresh;
  } catch {
    const cached = await cache.match(req);
    if (cached) {
      const at = cached.headers.get("X-Offline-Cached-At") || "";
      return withOfflineHeaders(cached, at);
    }
    return new Response(
      JSON.stringify({ message: "offline", offline: true }),
      {
        status: 503,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "X-Offline-Cache": "miss",
        },
      },
    );
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const networkPromise = fetch(req)
    .then((res) => {
      if (res && res.ok && (res.type === "basic" || res.type === "default")) {
        cache.put(req, res.clone()).catch(() => {});
      }
      return res;
    })
    .catch(() => cached);
  return cached || networkPromise;
}

async function cacheFirst(req, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const fresh = await fetch(req);
    if (fresh && (fresh.ok || fresh.type === "opaque")) {
      cache.put(req, fresh.clone()).then(() => trimCache(cacheName, maxEntries));
    }
    return fresh;
  } catch {
    return cached || Response.error();
  }
}

async function navigationStrategy(req) {
  const shellCache = await caches.open(SHELL_CACHE);
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) {
      const url = new URL(req.url);
      // Only cache the SPA root ("/") — never SSR-rendered learn pages, which
      // would contaminate the offline shell with stale per-URL HTML.
      if (url.pathname === "/") {
        shellCache.put("/", fresh.clone()).catch(() => {});
      }
    }
    return fresh;
  } catch {
    const cachedShell = await shellCache.match("/");
    if (cachedShell) return cachedShell;
    const staticCache = await caches.open(STATIC_CACHE);
    const offline = await staticCache.match("/offline.html");
    return (
      offline ||
      new Response("Sin conexión", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      })
    );
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  if (!sameOrigin) {
    if (isTileHost(url)) {
      event.respondWith(cacheFirst(req, TILE_CACHE, TILE_CACHE_MAX_ENTRIES));
    }
    return;
  }

  if (isAuthPath(url) || url.pathname === "/sw.js") return;

  if (req.mode === "navigate") {
    event.respondWith(navigationStrategy(req));
    return;
  }

  if (isApiPath(url)) {
    if (isApiCacheable(url)) {
      event.respondWith(networkFirstWithCache(req, API_CACHE, API_CACHE_MAX_ENTRIES));
    }
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(staleWhileRevalidate(req, ASSET_CACHE));
    return;
  }
});

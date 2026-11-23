import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { SEO_LOCALES, type SeoLocale } from "./metadata";
import { PUBLIC_URLS } from "./public-urls";
import { GLOSSARY_TERMS } from "../ssr/glossary-data";
import { SATELLITE_INDICES } from "../ssr/indices-data";
import { CROPS } from "../ssr/crops-data";
import { getCaseHubItems } from "../ssr/cases-data";

function getOrigin(req: Request): string {
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function urlEntry(
  origin: string,
  pathname: string,
  changefreq: string,
  priority: number,
  lastmod?: string,
): string {
  const alternates = SEO_LOCALES.map(
    (l: SeoLocale) =>
      `    <xhtml:link rel="alternate" hreflang="${l}" href="${xmlEscape(
        `${origin}${pathname}?lang=${l}`,
      )}" />`,
  ).join("\n");
  const xdefault = `    <xhtml:link rel="alternate" hreflang="x-default" href="${xmlEscape(
    `${origin}${pathname}`,
  )}" />`;
  const lm = lastmod ? `    <lastmod>${lastmod}</lastmod>\n` : "";
  return `  <url>
    <loc>${xmlEscape(`${origin}${pathname}`)}</loc>
${lm}    <changefreq>${changefreq}</changefreq>
    <priority>${priority.toFixed(1)}</priority>
${alternates}
${xdefault}
  </url>`;
}

function urlsetXml(entries: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset
  xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.join("\n")}
</urlset>`;
}

interface CacheEntry { xml: string; expiresAt: number; }
const TTL_MS = 60 * 60 * 1000; // 1h
// Cache keyed by origin to keep multi-host deployments from poisoning <loc>.
const sitemapCaches: Record<string, Map<string, CacheEntry>> = {
  index: new Map(),
  core: new Map(),
  glosario: new Map(),
  indices: new Map(),
  cultivos: new Map(),
  casos: new Map(),
};

function getCached(name: string, origin: string): string | null {
  const c = sitemapCaches[name].get(origin);
  if (c && c.expiresAt > Date.now()) return c.xml;
  return null;
}
function setCached(name: string, origin: string, xml: string): void {
  sitemapCaches[name].set(origin, { xml, expiresAt: Date.now() + TTL_MS });
}

const SITEMAP_CACHE_HEADER = "public, s-maxage=3600, stale-while-revalidate=86400";

export function registerSitemapRoutes(app: Express): void {
  app.get("/robots.txt", (req, res) => {
    const origin = getOrigin(req);
    res.type("text/plain").send(
      [
        "User-agent: *",
        "Allow: /",
        "Disallow: /api/",
        "Disallow: /admin",
        "Disallow: /dashboard",
        "Disallow: /parcel/",
        "Disallow: /parcel",
        "Disallow: /lab-import",
        "Disallow: /tech-profile",
        "Disallow: /auth",
        "Disallow: /uploads/",
        "",
        `Sitemap: ${origin}/sitemap.xml`,
        "",
      ].join("\n"),
    );
  });

  // ── /sitemap.xml — INDEX que apunta a los 5 shards ──────────────────────
  app.get("/sitemap.xml", (req: Request, res: Response) => {
    const origin = getOrigin(req);
    const cached = getCached("index", origin);
    if (cached) {
      res.set("Cache-Control", SITEMAP_CACHE_HEADER).type("application/xml").send(cached);
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const shards = [
      "/sitemap-core.xml",
      "/sitemap-glosario.xml",
      "/sitemap-indices.xml",
      "/sitemap-cultivos.xml",
      "/sitemap-casos.xml",
    ];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${shards
  .map(
    (s) =>
      `  <sitemap>\n    <loc>${xmlEscape(`${origin}${s}`)}</loc>\n    <lastmod>${today}</lastmod>\n  </sitemap>`,
  )
  .join("\n")}
</sitemapindex>`;
    setCached("index", origin, xml);
    res.set("Cache-Control", SITEMAP_CACHE_HEADER).type("application/xml").send(xml);
  });

  // ── shard: core (rutas estáticas + conferencias) ────────────────────────
  app.get("/sitemap-core.xml", async (req: Request, res: Response) => {
    const origin = getOrigin(req);
    const cached = getCached("core", origin);
    if (cached) {
      res.set("Cache-Control", SITEMAP_CACHE_HEADER).type("application/xml").send(cached);
      return;
    }
    const entries: string[] = [];
    // Excluir hubs que tienen su propio shard (glosario, indices, cultivos).
    for (const sp of PUBLIC_URLS) {
      if (
        sp.path === "/glosario" ||
        sp.path === "/indices" ||
        sp.path === "/cultivos"
      ) continue;
      entries.push(urlEntry(origin, sp.path, sp.changefreq, sp.priority));
    }
    try {
      const conferences = await storage.getConferences({ status: "published", limit: 500 });
      for (const c of conferences) {
        const lastmod = c.eventDate
          ? new Date(c.eventDate).toISOString().slice(0, 10)
          : c.createdAt
            ? new Date(c.createdAt).toISOString().slice(0, 10)
            : undefined;
        entries.push(urlEntry(origin, `/conferences/${c.id}`, "weekly", 0.7, lastmod));
      }
    } catch (err) {
      console.error("[sitemap] failed to load conferences:", err);
    }
    const xml = urlsetXml(entries);
    setCached("core", origin, xml);
    res.set("Cache-Control", SITEMAP_CACHE_HEADER).type("application/xml").send(xml);
  });

  // ── shard: glosario ─────────────────────────────────────────────────────
  app.get("/sitemap-glosario.xml", (req: Request, res: Response) => {
    const origin = getOrigin(req);
    const cached = getCached("glosario", origin);
    if (cached) {
      res.set("Cache-Control", SITEMAP_CACHE_HEADER).type("application/xml").send(cached);
      return;
    }
    const entries: string[] = [
      urlEntry(origin, "/glosario", "weekly", 0.7),
      ...GLOSSARY_TERMS.map((t) =>
        urlEntry(origin, `/glosario/${t.slug}`, "monthly", 0.6, t.dateUpdated),
      ),
    ];
    const xml = urlsetXml(entries);
    setCached("glosario", origin, xml);
    res.set("Cache-Control", SITEMAP_CACHE_HEADER).type("application/xml").send(xml);
  });

  // ── shard: índices satelitales ─────────────────────────────────────────
  app.get("/sitemap-indices.xml", (req: Request, res: Response) => {
    const origin = getOrigin(req);
    const cached = getCached("indices", origin);
    if (cached) {
      res.set("Cache-Control", SITEMAP_CACHE_HEADER).type("application/xml").send(cached);
      return;
    }
    const entries: string[] = [
      urlEntry(origin, "/indices", "weekly", 0.7),
      ...SATELLITE_INDICES.map((i) =>
        urlEntry(origin, `/indices/${i.slug}`, "monthly", 0.65, i.dateUpdated),
      ),
    ];
    const xml = urlsetXml(entries);
    setCached("indices", origin, xml);
    res.set("Cache-Control", SITEMAP_CACHE_HEADER).type("application/xml").send(xml);
  });

  // ── shard: cultivos (hub + detalle + etapas) ────────────────────────────
  app.get("/sitemap-cultivos.xml", (req: Request, res: Response) => {
    const origin = getOrigin(req);
    const cached = getCached("cultivos", origin);
    if (cached) {
      res.set("Cache-Control", SITEMAP_CACHE_HEADER).type("application/xml").send(cached);
      return;
    }
    const entries: string[] = [urlEntry(origin, "/cultivos", "weekly", 0.7)];
    for (const c of CROPS) {
      entries.push(urlEntry(origin, `/cultivos/${c.slug}`, "monthly", 0.7, c.dateUpdated));
      for (const s of c.stages) {
        entries.push(
          urlEntry(origin, `/cultivos/${c.slug}/${s.slug}`, "monthly", 0.6, c.dateUpdated),
        );
      }
    }
    const xml = urlsetXml(entries);
    setCached("cultivos", origin, xml);
    res.set("Cache-Control", SITEMAP_CACHE_HEADER).type("application/xml").send(xml);
  });

  // ── shard: casos reales ─────────────────────────────────────────────────
  app.get("/sitemap-casos.xml", async (req: Request, res: Response) => {
    const origin = getOrigin(req);
    const cached = getCached("casos", origin);
    if (cached) {
      res.set("Cache-Control", SITEMAP_CACHE_HEADER).type("application/xml").send(cached);
      return;
    }
    const entries: string[] = [urlEntry(origin, "/casos", "weekly", 0.6)];
    try {
      const items = await getCaseHubItems();
      for (const it of items) {
        const lastmod = it.lastMeasurementAt ?? undefined;
        entries.push(urlEntry(origin, `/casos/${it.slug}`, "weekly", 0.5, lastmod));
      }
    } catch (err) {
      console.error("[sitemap] failed to load cases:", err);
    }
    const xml = urlsetXml(entries);
    setCached("casos", origin, xml);
    res.set("Cache-Control", SITEMAP_CACHE_HEADER).type("application/xml").send(xml);
  });
}

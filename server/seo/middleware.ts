import type { Request } from "express";
import type { Conference, CommunityPost } from "@shared/schema";
import { storage } from "../storage";
import {
  DEFAULT_LOCALE,
  SEO_LOCALES,
  type SeoLocale,
  type RouteKey,
  getRouteContent,
} from "./metadata";
import { renderSeoHtml } from "./render";
import {
  renderGlossaryHub,
  renderGlossaryDetail,
  renderIndicesHub,
  renderIndexDetail,
} from "../ssr/learn-render";
import {
  renderCropsHub,
  renderCropDetail,
  renderCropStage,
} from "../ssr/crops-render";
import {
  renderCasesHub,
  renderCaseDetail,
} from "../ssr/cases-render";

type ExtendedRouteKey =
  | RouteKey
  | "conference-detail"
  | "glossary-detail"
  | "index-detail"
  | "crop-detail"
  | "crop-stage"
  | "cases"
  | "case-detail";

interface PublicRoute {
  key: ExtendedRouteKey;
  match: (pathname: string) => { matched: boolean; params?: Record<string, string> };
}

const PUBLIC_ROUTES: PublicRoute[] = [
  // NOTE: `/` (home) is intentionally NOT pre-rendered. The index.html template
  // already includes all SEO meta tags (title, description, canonical, OG,
  // Twitter card, JSON-LD Organization), so crawlers get full metadata while
  // real users on slow connections (e.g. iPhone over 4G) avoid seeing the
  // static SSR fallback flash inside #root before React hydrates.
  { key: "about", match: (p) => ({ matched: p === "/about" }) },
  { key: "conferences", match: (p) => ({ matched: p === "/conferences" }) },
  { key: "community", match: (p) => ({ matched: p === "/community" }) },
  { key: "glossary", match: (p) => ({ matched: p === "/glosario" }) },
  { key: "indices", match: (p) => ({ matched: p === "/indices" }) },
  { key: "crops", match: (p) => ({ matched: p === "/cultivos" }) },
  { key: "cases", match: (p) => ({ matched: p === "/casos" }) },
  {
    key: "crop-stage",
    match: (p) => {
      const m = p.match(/^\/cultivos\/([a-z0-9-]+)\/([a-z0-9-]+)$/);
      return m ? { matched: true, params: { slug: m[1], etapa: m[2] } } : { matched: false };
    },
  },
  {
    key: "crop-detail",
    match: (p) => {
      const m = p.match(/^\/cultivos\/([a-z0-9-]+)$/);
      return m ? { matched: true, params: { slug: m[1] } } : { matched: false };
    },
  },
  {
    key: "case-detail",
    match: (p) => {
      const m = p.match(/^\/casos\/([a-z0-9-]+)$/);
      return m ? { matched: true, params: { slug: m[1] } } : { matched: false };
    },
  },
  {
    key: "glossary-detail",
    match: (p) => {
      const m = p.match(/^\/glosario\/([a-z0-9-]+)$/);
      return m ? { matched: true, params: { slug: m[1] } } : { matched: false };
    },
  },
  {
    key: "index-detail",
    match: (p) => {
      const m = p.match(/^\/indices\/([a-z0-9-]+)$/);
      return m ? { matched: true, params: { slug: m[1] } } : { matched: false };
    },
  },
  {
    key: "conference-detail",
    match: (p) => {
      const m = p.match(/^\/conferences\/([^/]+)$/);
      return m ? { matched: true, params: { id: m[1] } } : { matched: false };
    },
  },
];

export function matchPublicRoute(pathname: string):
  | { route: PublicRoute; params: Record<string, string> }
  | null {
  for (const route of PUBLIC_ROUTES) {
    const r = route.match(pathname);
    if (r.matched) return { route, params: r.params ?? {} };
  }
  return null;
}

function detectLocale(req: Request): SeoLocale {
  const q = (req.query?.lang as string | undefined)?.toLowerCase();
  if (q && (SEO_LOCALES as string[]).includes(q)) return q as SeoLocale;

  const cookieHeader = req.headers.cookie ?? "";
  const m = cookieHeader.match(/(?:^|;\s*)agregen-locale=([^;]+)/);
  if (m && (SEO_LOCALES as string[]).includes(m[1])) return m[1] as SeoLocale;

  const accept = (req.headers["accept-language"] as string | undefined) ?? "";
  for (const part of accept.split(",")) {
    const code = part.split(";")[0].trim().slice(0, 2).toLowerCase();
    if ((SEO_LOCALES as string[]).includes(code)) return code as SeoLocale;
  }
  return DEFAULT_LOCALE;
}

function getOrigin(req: Request): string {
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

function pathnameOf(req: Request): string {
  const url = req.originalUrl || req.url || "/";
  const i = url.indexOf("?");
  return i >= 0 ? url.slice(0, i) : url;
}

export interface MaybeSeoOutput {
  html: string;
  status?: number;
  cacheControl?: string;
}

const LEARN_CACHE = "public, max-age=86400";
// `must-revalidate` forces browsers to re-check with the origin on every
// navigation while still allowing CDNs to serve a shared copy. This prevents
// stale HTML (with old SEO shell layouts) from being served from the browser
// cache after a deploy that changes the shell structure.
const SSR_CACHE =
  "public, max-age=0, s-maxage=3600, must-revalidate, stale-while-revalidate=86400";

export async function maybeRenderSeo(
  req: Request,
  template: string,
): Promise<MaybeSeoOutput | null> {
  const pathname = pathnameOf(req);
  const matched = matchPublicRoute(pathname);
  if (!matched) return null;

  const locale = detectLocale(req);
  const origin = getOrigin(req);
  const { route, params } = matched;

  if (route.key === "glossary-detail") {
    const out = renderGlossaryDetail({ template, origin, pathname, locale, slug: params.slug });
    return { ...out, cacheControl: SSR_CACHE };
  }
  if (route.key === "index-detail") {
    const out = renderIndexDetail({ template, origin, pathname, locale, slug: params.slug });
    return { ...out, cacheControl: SSR_CACHE };
  }
  if (route.key === "glossary") {
    return { ...renderGlossaryHub({ template, origin, pathname, locale }), cacheControl: SSR_CACHE };
  }
  if (route.key === "indices") {
    return { ...renderIndicesHub({ template, origin, pathname, locale }), cacheControl: SSR_CACHE };
  }
  if (route.key === "crops") {
    return { ...renderCropsHub({ template, origin, pathname, locale }), cacheControl: SSR_CACHE };
  }
  if (route.key === "crop-detail") {
    return { ...renderCropDetail({ template, origin, pathname, locale, slug: params.slug }), cacheControl: SSR_CACHE };
  }
  if (route.key === "crop-stage") {
    return {
      ...renderCropStage({ template, origin, pathname, locale, slug: params.slug, etapa: params.etapa }),
      cacheControl: SSR_CACHE,
    };
  }
  if (route.key === "cases") {
    return {
      ...(await renderCasesHub({
        template,
        origin,
        pathname,
        locale,
        query: req.query as Record<string, string | string[] | undefined>,
      })),
      cacheControl: SSR_CACHE,
    };
  }
  if (route.key === "case-detail") {
    return {
      ...(await renderCaseDetail({ template, origin, pathname, locale, slug: params.slug })),
      cacheControl: SSR_CACHE,
    };
  }
  // LEARN_CACHE retained for backwards-compat in case future routes opt in.
  void LEARN_CACHE;

  if (route.key === "conference-detail") {
    let title = "Conferencia | AgRegen";
    let description = "Conferencia de agricultura regenerativa en AgRegen 5.0.";
    let h1 = title;
    let intro = description;
    let bullets: string[] = [];
    const extraJsonLd: object[] = [];
    let imageUrl: string | undefined;
    let notFound = false;

    try {
      const conf: Conference | undefined = await storage.getConference(params.id);
      // Only published conferences are public-crawlable. Drafts/archived
      // are treated as not found to avoid leaking unpublished metadata.
      if (!conf || conf.status !== "published") {
        notFound = true;
        title = "Conferencia no encontrada | AgRegen";
        description = "Esta conferencia ya no está disponible.";
        h1 = "Conferencia no encontrada";
        intro = description;
      } else {
        title = `${conf.title} | Conferencias AgRegen`;
        description = (conf.description || description).slice(0, 280);
        h1 = conf.title;
        intro = conf.description || intro;
        bullets = (conf.tags ?? []).slice(0, 8).map((t) => `#${t}`);
        imageUrl = conf.thumbnailUrl ?? undefined;
        const datePublished: Date | string | null | undefined =
          conf.eventDate ?? conf.createdAt;
        const dateModified: Date | string | null | undefined =
          conf.updatedAt ?? conf.createdAt;
        const dpIso = datePublished ? new Date(datePublished).toISOString() : undefined;
        const dmIso = dateModified ? new Date(dateModified).toISOString() : undefined;

        // Always emit Article (for crawl-friendly text content + author/date pair).
        extraJsonLd.push({
          "@context": "https://schema.org",
          "@type": "Article",
          headline: conf.title,
          description: conf.description,
          image: conf.thumbnailUrl || undefined,
          inLanguage: locale,
          datePublished: dpIso,
          dateModified: dmIso,
          author: { "@type": "Organization", name: "AgRegen" },
          publisher: {
            "@type": "Organization",
            name: "AgRegen",
            url: origin,
          },
          mainEntityOfPage: `${origin}/conferences/${conf.id}`,
        });

        // Plus Event or VideoObject (depending on conference type).
        extraJsonLd.push({
          "@context": "https://schema.org",
          "@type": conf.videoUrl ? "VideoObject" : "Event",
          name: conf.title,
          description: conf.description,
          inLanguage: locale,
          datePublished: dpIso,
          dateModified: dmIso,
          ...(conf.videoUrl
            ? {
                thumbnailUrl: conf.thumbnailUrl || undefined,
                contentUrl: conf.videoUrl,
                uploadDate: dpIso,
              }
            : {
                startDate: dpIso,
                organizer: { "@type": "Organization", name: "AgRegen" },
                eventAttendanceMode:
                  "https://schema.org/OnlineEventAttendanceMode",
                eventStatus: "https://schema.org/EventScheduled",
                location: {
                  "@type": "VirtualLocation",
                  url: `${origin}/conferences/${conf.id}`,
                },
              }),
        });
      }
    } catch (err) {
      console.error("[seo] failed to load conference:", err);
    }

    return {
      status: notFound ? 404 : undefined,
      html: renderSeoHtml({
        template,
        locale,
        origin,
        pathname,
        route: "conference-detail",
        title,
        description,
        h1,
        intro,
        bullets,
        extraJsonLd,
        imageUrl,
      }),
      cacheControl: SSR_CACHE,
    };
  }

  const content = getRouteContent(route.key as RouteKey, locale);
  let bullets = content.bullets;
  const extraJsonLd: object[] = [];

  // For /community: enrich SSR with the most recent public posts so crawlers
  // see real, route-accurate page structure (titles + tags) instead of a
  // generic shell. Adds an ItemList JSON-LD with same items.
  if (route.key === "community") {
    try {
      const posts: CommunityPost[] = await storage.getCommunityPosts({ limit: 5 });
      if (posts.length > 0) {
        const titles = posts
          .map((p) => ((p.title ?? p.content) ?? "").toString().trim())
          .filter((s): s is string => Boolean(s))
          .slice(0, 5)
          .map((s) => (s.length > 90 ? `${s.slice(0, 90)}…` : s));
        if (titles.length > 0) {
          bullets = [...titles, ...content.bullets].slice(0, 8);
        }
        extraJsonLd.push({
          "@context": "https://schema.org",
          "@type": "ItemList",
          itemListElement: posts.slice(0, 5).map((p, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: ((p.title ?? p.content) ?? "Post").toString().slice(0, 110),
            url: `${origin}/community`,
          })),
        });
      }
    } catch (err) {
      console.error("[seo] failed to load community posts:", err);
    }
  }

  return {
    html: renderSeoHtml({
      template,
      locale,
      origin,
      pathname,
      route: route.key as RouteKey,
      title: content.title,
      description: content.description,
      h1: content.h1,
      intro: content.intro,
      bullets,
      ctaText: content.ctaText,
      extraJsonLd,
    }),
    cacheControl: SSR_CACHE,
  };
}

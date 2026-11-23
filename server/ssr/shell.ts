/**
 * SSR shell — pure builder.
 *
 * `buildShellHtml(args)` is a pure function that takes a parsed contract
 * (title, description, canonical, locale, hreflangs, schemas, body bullets,
 * etc.) and returns the final HTML string injected into the index.html
 * template.
 *
 * The SEO body is rendered as a SIBLING of `<div id="root">` (not inside it).
 * It is hidden by default via CSS (`#seo-shell-wrapper{display:none}`) so users
 * with JavaScript never see it — preventing the "ghost overlay" bug where a
 * stale SSR shell remains visible behind the React tree.
 *
 * For non-JS visitors (Twitter/Slack/Facebook crawlers, screen readers in
 * accessibility audits, scripted curl checks), a `<noscript>` style block
 * unhides `#seo-shell-wrapper` and hides `#root` so they see the full SEO
 * content.
 *
 * For pure-SSR documentation routes (`/glosario`, `/indices`, `/cultivos`,
 * `/casos`), the React bootstrap is stripped so the SEO body is always
 * visible without any client-side toggling.
 *
 * Contract:
 *   buildShellHtml({ template, title, description, canonical, locale,
 *                    hreflangs, schemas, h1, intro, bullets, ctaText,
 *                    ogImage })
 *
 * `renderSeoHtml` (exported below for backwards compatibility) is a thin
 * adapter that resolves the locale-aware base schemas, hreflangs and
 * breadcrumbs from `server/seo/metadata.ts` and then delegates to
 * `buildShellHtml`.
 */

import {
  DEFAULT_LOCALE,
  SEO_LOCALES,
  type SeoLocale,
  type RouteKey,
  type ShellChrome,
  getOgLocale,
  getOrgTagline,
  getShellChrome,
} from "../seo/metadata";

const REPO_URL = "https://github.com/agregen";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}

export type ShellMode = "hybrid" | "pure-ssr";

export interface ShellArgs {
  template: string;
  locale: SeoLocale;
  title: string;
  description: string;
  canonical: string;
  hreflangs: { locale: SeoLocale | "x-default"; href: string }[];
  schemas: object[];
  ogImage: string;
  pathname: string;
  h1: string;
  intro: string;
  bullets: string[];
  ctaText?: string;
  chrome: ShellChrome;
  /**
   * Rendering mode:
   *  - "hybrid": route mounts a real React UI (Spanish landing/about/community/
   *    conferences). We inject ONLY head metadata (title, description, OG,
   *    Twitter, hreflang, canonical, JSON-LD) and leave the body untouched.
   *    NO visible SEO body is emitted, so there is zero chance of "ghost"
   *    English content showing behind the React tree under any cache or race.
   *  - "pure-ssr": documentation routes (/glosario, /indices, /cultivos,
   *    /casos and details) where React renders nothing meaningful. We inject
   *    the full visible SEO body and strip the React bootstrap.
   */
  mode: ShellMode;
}

/**
 * Pure HTML shell builder. No I/O, no business logic — only string assembly
 * from the supplied contract. Safe to unit-test in isolation.
 */
export function buildShellHtml(args: ShellArgs): string {
  const {
    template,
    locale,
    title,
    description,
    canonical,
    hreflangs,
    schemas,
    ogImage,
    pathname,
    h1,
    intro,
    bullets,
    ctaText,
    chrome,
    mode,
  } = args;

  const hreflangTags = hreflangs
    .map(
      (h) =>
        `<link rel="alternate" hreflang="${h.locale}" href="${escapeAttr(h.href)}" />`,
    )
    .join("\n    ");

  const headInjection = `
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeAttr(description)}" />
    <meta name="theme-color" content="#15803d" />
    <link rel="canonical" href="${escapeAttr(canonical)}" />
    ${hreflangTags}
    <meta property="og:site_name" content="AgRegen 5.0" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="${escapeAttr(getOgLocale(locale))}" />
    <meta property="og:title" content="${escapeAttr(title)}" />
    <meta property="og:description" content="${escapeAttr(description)}" />
    <meta property="og:url" content="${escapeAttr(canonical)}" />
    <meta property="og:image" content="${escapeAttr(ogImage)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeAttr(title)}" />
    <meta name="twitter:description" content="${escapeAttr(description)}" />
    <meta name="twitter:image" content="${escapeAttr(ogImage)}" />
    ${schemas
      .map(
        (s) =>
          `<script type="application/ld+json">${JSON.stringify(s).replace(/</g, "\\u003c")}</script>`,
      )
      .join("\n    ")}
  `.trim();

  const noscriptBlock = `
    <noscript>
      <header>
        <h1>${escapeHtml(h1)}</h1>
        <p>${escapeHtml(intro)}</p>
      </header>
      <ul>
        ${bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("\n        ")}
      </ul>
      <p>
        <a href="/auth">${escapeHtml(ctaText ?? "AgRegen")}</a>
        &nbsp;|&nbsp;
        <a href="/about">${escapeHtml(getOrgTagline(locale))}</a>
      </p>
      <nav aria-label="locales">
        ${SEO_LOCALES.map(
          (l) =>
            `<a href="${escapeAttr(`${pathname}?lang=${l}`)}" hreflang="${l}">${l.toUpperCase()}</a>`,
        ).join(" · ")}
      </nav>
    </noscript>
  `.trim();

  // Visible SEO body — only emitted in pure-SSR mode. In hybrid mode this
  // string is built but never inserted into the template.
  const seoBody = `
    <div id="seo-shell" style="font-family:Inter,system-ui,-apple-system,sans-serif;color:#1f2937;background:#f8faf6;min-height:100vh;">
      <header style="border-bottom:1px solid #e5e7eb;padding:1rem 1.5rem;background:#fff;display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;">
        <a href="/" style="font-weight:700;font-size:1.125rem;color:#15803d;text-decoration:none;">AgRegen 5.0</a>
        <nav aria-label="primary" style="display:flex;gap:1.25rem;font-size:0.95rem;">
          <a href="/" style="color:#374151;text-decoration:none;">${escapeHtml(chrome.navHome)}</a>
          <a href="/conferences" style="color:#374151;text-decoration:none;">${escapeHtml(chrome.navConferences)}</a>
          <a href="/community" style="color:#374151;text-decoration:none;">${escapeHtml(chrome.navCommunity)}</a>
          <a href="/about" style="color:#374151;text-decoration:none;">${escapeHtml(chrome.navAbout)}</a>
          <a href="/auth" style="color:#15803d;text-decoration:none;font-weight:600;">${escapeHtml(chrome.navSignIn)}</a>
        </nav>
      </header>
      <main style="max-width:64rem;margin:0 auto;padding:3rem 1.5rem;">
        <h1 style="font-size:2rem;line-height:1.2;font-weight:700;margin:0 0 1rem;color:#0f172a;">${escapeHtml(h1)}</h1>
        <p style="font-size:1.125rem;line-height:1.6;color:#4b5563;margin:0 0 1.5rem;">${escapeHtml(intro)}</p>
        <ul style="list-style:disc;padding-left:1.25rem;margin:0 0 2rem;color:#374151;line-height:1.7;">
          ${bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("\n          ")}
        </ul>
        ${
          ctaText
            ? `<p><a href="/auth" style="display:inline-block;background:#15803d;color:#fff;padding:0.65rem 1.25rem;border-radius:0.5rem;text-decoration:none;font-weight:600;">${escapeHtml(ctaText)}</a></p>`
            : ""
        }
      </main>
      <footer style="border-top:1px solid #e5e7eb;padding:1.5rem;text-align:center;font-size:0.85rem;color:#6b7280;">
        <nav aria-label="Aprendé" style="margin-bottom:0.75rem;">
          <a href="/glosario" style="color:#15803d;margin:0 0.5rem;text-decoration:none;font-weight:600;">${escapeHtml(chrome.learnGlossary)}</a> ·
          <a href="/indices" style="color:#15803d;margin:0 0.5rem;text-decoration:none;font-weight:600;">${escapeHtml(chrome.learnIndices)}</a> ·
          <a href="/cultivos" style="color:#15803d;margin:0 0.5rem;text-decoration:none;font-weight:600;">${escapeHtml(chrome.learnCrops)}</a> ·
          <a href="/casos" style="color:#15803d;margin:0 0.5rem;text-decoration:none;font-weight:600;">${escapeHtml(chrome.learnCases)}</a>
        </nav>
        © 2026 AgRegen 5.0 · ${escapeHtml(chrome.footerNote)} · ${SEO_LOCALES.map(
          (l) => `<a href="${escapeAttr(`${pathname}?lang=${l}`)}" hreflang="${l}" style="color:#6b7280;margin:0 0.35rem;">${l.toUpperCase()}</a>`,
        ).join(" · ")}
      </footer>
    </div>
  `.trim();

  let html = template;
  html = html.replace(/<html\s+lang="[^"]*">/i, `<html lang="${locale}">`);
  if (!/<html\s+lang=/i.test(html)) {
    html = html.replace(/<html(\s|>)/i, `<html lang="${locale}"$1`);
  }
  html = html.replace(/<title>[\s\S]*?<\/title>\s*/gi, "");
  html = html.replace(
    /<meta\s+(?:name|property)="(?:description|og:[^"]+|twitter:[^"]+|theme-color)"[^>]*>\s*/gi,
    "",
  );
  html = html.replace(/<link\s+rel="canonical"[^>]*>\s*/gi, "");
  html = html.replace(/<link\s+rel="alternate"\s+hreflang="[^"]+"[^>]*>\s*/gi, "");
  html = html.replace(/<\/head>/i, `${headInjection}\n  </head>`);

  if (mode === "pure-ssr") {
    // Pure-SSR documentation pages: render the SEO body visibly inside the
    // body and strip the Vite bootstrap so React never mounts and overwrites
    // the SSR content. The noscript fallback would emit a duplicate <h1>, so
    // skip it too.
    html = html.replace(
      /<div id="root"><\/div>/i,
      `<div id="seo-shell-wrapper">${seoBody}</div>\n    <div id="root" hidden></div>`,
    );
    html = html.replace(
      /<script\s+type="module"\s+src="\/src\/main\.tsx[^"]*"[^>]*><\/script>\s*/i,
      "",
    );
  } else {
    // Hybrid mode: do NOT inject any visible SEO body. The body is left as
    // the template emits it (just <div id="root"></div>) so React mounts
    // cleanly and there is no duplicated content that could "leak" through
    // caches, races, or hydration bugs. Crawlers still get full title +
    // description + OG + Twitter + hreflang + JSON-LD from headInjection.
    void noscriptBlock;
    void seoBody;
  }
  return html;
}

export interface SeoRenderInput {
  template: string;
  locale: SeoLocale;
  origin: string;
  pathname: string;
  route: RouteKey | "conference-detail";
  title: string;
  description: string;
  h1: string;
  intro: string;
  bullets: string[];
  ctaText?: string;
  extraJsonLd?: object[];
  imageUrl?: string;
  /**
   * "hybrid" (default) for pages where React mounts a full Spanish UI; only
   * head metadata is injected. "pure-ssr" for documentation routes where the
   * full visible SEO body is rendered and React is stripped.
   */
  mode?: ShellMode;
}

function buildBaseSchemas(origin: string, locale: SeoLocale): object[] {
  return [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": `${origin}/#organization`,
      name: "AgRegen",
      url: origin,
      logo: `${origin}/favicon.png`,
      description: getOrgTagline(locale),
      sameAs: [REPO_URL],
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": `${origin}/#website`,
      url: origin,
      name: "AgRegen 5.0",
      inLanguage: locale,
      publisher: { "@id": `${origin}/#organization` },
      potentialAction: {
        "@type": "SearchAction",
        target: `${origin}/community?search={search_term_string}`,
        "query-input": "required name=search_term_string",
      },
    },
  ];
}

function softwareSchema(origin: string, locale: SeoLocale): object {
  return {
    "@context": "https://schema.org",
    "@type": ["SoftwareApplication", "WebApplication"],
    name: "AgRegen 5.0",
    applicationCategory: "AgricultureApplication",
    operatingSystem: "Web",
    inLanguage: SEO_LOCALES,
    url: origin,
    description: getOrgTagline(locale),
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    license: REPO_URL,
  };
}

function breadcrumbSchema(origin: string, pathname: string, label: string): object | null {
  if (pathname === "/" || pathname === "") return null;
  const segments = pathname.split("/").filter(Boolean);
  const items: object[] = [
    { "@type": "ListItem", position: 1, name: "Home", item: `${origin}/` },
  ];
  segments.forEach((seg, i) => {
    items.push({
      "@type": "ListItem",
      position: i + 2,
      name: i === segments.length - 1 ? label : seg,
      item: `${origin}/${segments.slice(0, i + 1).join("/")}`,
    });
  });
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items,
  };
}

/**
 * Resolves locale-aware schemas + hreflangs and delegates to the pure
 * `buildShellHtml`. Backwards-compatible adapter for `server/seo/middleware.ts`.
 */
export function renderSeoHtml(input: SeoRenderInput): string {
  const { template, locale, origin, pathname, route, title, description, h1,
    intro, bullets, ctaText, extraJsonLd = [], imageUrl, mode = "hybrid" } = input;

  const canonical = `${origin}${pathname}`;
  const ogImage = imageUrl ?? `${origin}/opengraph.jpg`;

  const hreflangs: { locale: SeoLocale | "x-default"; href: string }[] = [
    ...SEO_LOCALES.map((l) => ({ locale: l, href: `${origin}${pathname}?lang=${l}` })),
    { locale: "x-default" as const, href: `${origin}${pathname}` },
  ];

  const schemas: object[] = [...buildBaseSchemas(origin, locale)];
  if (route === "home") schemas.push(softwareSchema(origin, locale));
  const crumb = breadcrumbSchema(origin, pathname, h1);
  if (crumb) schemas.push(crumb);
  schemas.push(...extraJsonLd);

  return buildShellHtml({
    template,
    locale,
    title,
    description,
    canonical,
    hreflangs,
    schemas,
    ogImage,
    pathname,
    h1,
    intro,
    bullets,
    ctaText,
    chrome: getShellChrome(locale),
    mode,
  });
}

// Re-exports retained for callers that import the contract surface.
export { maybeRenderSeo, matchPublicRoute } from "../seo/middleware";
export type { MaybeSeoOutput } from "../seo/middleware";
export { PUBLIC_URLS } from "../seo/public-urls";
export type { PublicUrl } from "../seo/public-urls";
export {
  ROUTE_CONTENT,
  SEO_LOCALES,
  DEFAULT_LOCALE,
  getRouteContent,
  getOrgTagline,
  getOgLocale,
  getShellChrome,
} from "../seo/metadata";
export type { SeoLocale, SeoContent, RouteKey, ShellChrome } from "../seo/metadata";

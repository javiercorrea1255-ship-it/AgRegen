import type { RouteKey } from "./metadata";

export interface PublicUrl {
  path: string;
  routeKey: RouteKey;
  changefreq: "daily" | "weekly" | "monthly" | "yearly";
  priority: number;
}

/**
 * Source of truth for static public URLs that the SEO middleware can render
 * and the sitemap should advertise. Tasks #61 (glosario, índices) and #62
 * (cultivos, casos) extend this list — they MUST add new entries here
 * AND register matching content in `metadata.ts` plus a route in
 * `middleware.ts`.
 */
export const PUBLIC_URLS: PublicUrl[] = [
  { path: "/", routeKey: "home", changefreq: "daily", priority: 1.0 },
  { path: "/about", routeKey: "about", changefreq: "monthly", priority: 0.8 },
  { path: "/conferences", routeKey: "conferences", changefreq: "weekly", priority: 0.9 },
  { path: "/community", routeKey: "community", changefreq: "daily", priority: 0.9 },
  // SEO hubs (skeleton in Phase 1; Tasks #61/#62 fill the real content).
  { path: "/glosario", routeKey: "glossary", changefreq: "weekly", priority: 0.7 },
  { path: "/indices", routeKey: "indices", changefreq: "weekly", priority: 0.7 },
  { path: "/cultivos", routeKey: "crops", changefreq: "weekly", priority: 0.7 },
];

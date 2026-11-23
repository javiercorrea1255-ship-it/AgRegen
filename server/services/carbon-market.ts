export interface VCMPrice {
  price: number;
  currency: string;
  source: string;
  date: string;
}

// ── Gold Standard Marketplace scraper ────────────────────────────────────────
// The Gold Standard Foundation operates an official retail marketplace for
// certified voluntary carbon credits at marketplace.goldstandard.org.
// Shopify's public /products.json endpoint (no auth required) exposes all
// listed projects with per-variant prices in USD / tCO₂.
// We take the median of listed prices (capped to $3–$80 to exclude
// obvious data anomalies) as the reference spot price.

const GS_PRODUCTS_URL =
  "https://marketplace.goldstandard.org/collections/all/products.json?limit=250";

interface ShopifyVariant {
  price?: string;
}
interface ShopifyProduct {
  variants?: ShopifyVariant[];
}
interface ShopifyProducts {
  products?: ShopifyProduct[];
}

async function fetchVCMPriceFromGoldStandard(): Promise<VCMPrice | null> {
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 12_000);
    const resp = await fetch(GS_PRODUCTS_URL, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; AgRegen/5.0; +https://agregen.io)",
        Accept: "application/json",
      },
      signal: ctrl.signal,
    });
    clearTimeout(tid);
    if (!resp.ok) return null;

    const body = await resp.text();
    if (!body || body.trim() === "") return null;

    const data: ShopifyProducts = JSON.parse(body);
    const products = data?.products;
    if (!Array.isArray(products) || products.length === 0) return null;

    // Collect all unique per-variant prices
    const prices: number[] = [];
    for (const p of products) {
      for (const v of p.variants ?? []) {
        const raw = parseFloat(v.price ?? "");
        if (!isNaN(raw) && raw >= 3 && raw <= 80) {
          prices.push(raw);
        }
      }
    }
    if (prices.length === 0) return null;

    prices.sort((a, b) => a - b);
    const median = prices[Math.floor(prices.length / 2)];

    return {
      price: Math.round(median * 100) / 100,
      currency: "USD",
      source:
        "Gold Standard Marketplace — precio mediano de créditos voluntarios certificados (GS4GG), " +
        `${prices.length} proyectos listados al ${new Date().toLocaleDateString("es-MX")}. ` +
        "Estimación no certificada.",
      date: new Date().toISOString().slice(0, 10),
    };
  } catch {
    return null;
  }
}

// ── Cache ─────────────────────────────────────────────────────────────────────
const CACHE_TTL_SUCCESS_MS = 24 * 60 * 60 * 1000; // 24 h on success
const CACHE_TTL_MISS_MS    =  1 * 60 * 60 * 1000; //  1 h on miss (retry sooner)

interface CacheEntry {
  price: VCMPrice | null;
  expiresAt: number;
}
let _cache: CacheEntry | null = null;

/**
 * Returns the current voluntary carbon market (VCM) spot price (USD/tCO₂)
 * scraped from the Gold Standard Foundation's public retail marketplace.
 *
 * Returns **null** when the external source is unreachable.  Callers must
 * treat null by hiding the monetary estimate rather than showing stale data.
 *
 * Cache: 24 h on success · 1 h on failure (to retry sooner).
 */
export async function getVCMPrice(): Promise<VCMPrice | null> {
  if (_cache && Date.now() < _cache.expiresAt) return _cache.price;

  const price = await fetchVCMPriceFromGoldStandard();
  _cache = {
    price,
    expiresAt: Date.now() + (price ? CACHE_TTL_SUCCESS_MS : CACHE_TTL_MISS_MS),
  };
  return price;
}

/** Exposed for testing — resets the in-memory cache. */
export function resetVCMCache(): void {
  _cache = null;
}

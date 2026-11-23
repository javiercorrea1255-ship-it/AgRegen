/**
 * International commodity price benchmarks.
 *
 * Reference prices (monthly average, USD/metric ton):
 *   Primary  — World Bank "Pink Sheet" (CMO-Historical-Data-Monthly.xlsx)
 *              Parsed directly from the official WB document download.
 *              Columns (0-based, verified against the Jan-2025 edition):
 *                A(0)=date "YYYY​Mmm", Y(24)=Soybeans, AE(30)=Maize, AK(36)=Wheat US SRW
 *   Fallback — IMF Primary Commodity Prices DataMapper API (free, no key)
 *
 * Futures prices (daily settle, USD/metric ton converted from cents/bushel):
 *   Primary  — Nasdaq Data Link CHRIS CME continuous contracts (free, no key)
 *   Fallback — Stooq CSV snapshot (free)
 *   Fallback2 — Yahoo Finance unofficial API (free)
 *
 * Source provenance tracked in worldBankSource / cmeFutureSource so the UI
 * can label data accurately.
 * Cache: 24 h in-memory per commodity. Excel fetched once per day for all
 * three crops in a single HTTP request.
 */

import * as XLSX from "xlsx";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 12_000;

// ── Public types ──────────────────────────────────────────────────────────────

export type RefSource = "worldbank" | "imf" | null;
export type FuturesSource = "nasdaq" | "stooq" | "yahoo" | null;

export interface CommodityBenchmark {
  crop: string;
  worldBankPrice: number | null;    // reference monthly avg, USD/ton
  worldBankDate: string | null;
  worldBankSource: RefSource;
  cmeFuturePrice: number | null;    // CBOT front-month daily settle, USD/ton
  cmeFutureDate: string | null;
  cmeFutureSource: FuturesSource;
  unit: "USD/ton";
}

export interface InternationalPricesResult {
  benchmarks: CommodityBenchmark[];
  fetchedAt: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const ACENT: Record<string, string> = { á: "a", é: "e", í: "i", ó: "o", ú: "u" };
function norm(s: string) {
  return s.toLowerCase().replace(/[áéíóú]/g, (c) => ACENT[c] ?? c);
}

// ── Crop specs ─────────────────────────────────────────────────────────────────

interface CropSpec {
  label: string;
  pinkSheetCol: number;     // 0-based column index in "Monthly Prices" sheet
  imfCode: string;          // IMF DataMapper indicator code (fallback)
  nasdaqDataset: string;    // Nasdaq Data Link CHRIS dataset
  stooqSymbol: string;      // Stooq CSV symbol (cents/bushel)
  yahooSymbol: string;      // Yahoo Finance ticker (cents/bushel)
  bushelWeightLb: number;   // pounds per bushel for unit conversion
}

const CROPS: CropSpec[] = [
  {
    label: "Maíz",
    pinkSheetCol: 30,           // Column AE — Maize ($/mt)
    imfCode: "PMAIZMMT",
    nasdaqDataset: "CHRIS/CME_C1",
    stooqSymbol: "zc.f",
    yahooSymbol: "ZC=F",
    bushelWeightLb: 56,
  },
  {
    label: "Soya",
    pinkSheetCol: 24,           // Column Y — Soybeans ($/mt)
    imfCode: "PSOYB",
    nasdaqDataset: "CHRIS/CME_S1",
    stooqSymbol: "zs.f",
    yahooSymbol: "ZS=F",
    bushelWeightLb: 60,
  },
  {
    label: "Trigo",
    pinkSheetCol: 36,           // Column AK — Wheat, US SRW ($/mt)
    imfCode: "PWHEAMTU",
    nasdaqDataset: "CHRIS/CME_W1",
    stooqSymbol: "zw.f",
    yahooSymbol: "ZW=F",
    bushelWeightLb: 60,
  },
];

const CROP_ALIAS: Record<string, string> = {
  maiz: "Maíz", maize: "Maíz", corn: "Maíz",
  soja: "Soya", soya: "Soya", soybean: "Soya", soybeans: "Soya",
  trigo: "Trigo", wheat: "Trigo",
};

export function normalizeCropName(crop: string): string | null {
  const key = norm(crop);
  for (const [alias, label] of Object.entries(CROP_ALIAS)) {
    if (key.includes(alias)) return label;
  }
  return null;
}

/** Crop labels covered by this module */
export const INTERNATIONAL_CROPS = CROPS.map((c) => c.label);

// ── Pink Sheet column constants (verified Jan-2025 edition) ────────────────────
//
// "Monthly Prices" sheet layout:
//   Row 1 (idx 0): title
//   Row 5 (idx 4): commodity headers  →  col Y=Soybeans, col AE=Maize, col AK=Wheat SRW
//   Row 6 (idx 5): unit row           →  ($/mt) for all three
//   Row 7+ (idx 6+): monthly data     →  col A = "YYYYMmm", rest = numeric prices
//
// Column letters → 0-based indices:
//   A=0, Y=24, AE=30, AK=36
const PS_DATE_COL = 0;
// Per-crop column indices stored in CropSpec.pinkSheetCol above

// ── Pink Sheet cache (shared across all crops — fetched once per day) ─────────

interface PinkSheetEntry {
  label: string;
  price: number;
  date: string;
}
interface PsCache {
  data: Map<string, PinkSheetEntry>;  // label → { price, date }
  expiresAt: number;
}
let pinkSheetCache: PsCache | null = null;

// Stable WB Pink Sheet download URL (document ID, updated in-place monthly by WB)
const PINK_SHEET_URL =
  "https://thedocs.worldbank.org/en/doc/5d903e848db1d1b83e0ec8f744e55570-0350012021/related/CMO-Historical-Data-Monthly.xlsx";

async function fetchPinkSheetAll(): Promise<Map<string, PinkSheetEntry>> {
  const res = await fetch(PINK_SHEET_URL, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { Accept: "*/*" },
  });
  if (!res.ok) throw new Error(`Pink Sheet HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());

  const wb = XLSX.read(buf, { type: "buffer", cellDates: false });
  const ws = wb.Sheets["Monthly Prices"];
  if (!ws) throw new Error("Sheet 'Monthly Prices' not found in Pink Sheet");

  // Convert to array-of-arrays for easy indexed access
  const data = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: null,
    blankrows: false,
  });

  // Walk rows bottom-up to find last non-null value per crop
  const result = new Map<string, PinkSheetEntry>();

  for (let ri = data.length - 1; ri >= 6; ri--) {
    const row = data[ri] as unknown[];
    const dateRaw = row[PS_DATE_COL];
    if (!dateRaw || typeof dateRaw !== "string") continue;

    for (const spec of CROPS) {
      if (result.has(spec.label)) continue; // already found a value
      const raw = row[spec.pinkSheetCol];
      if (raw == null) continue;
      const price = typeof raw === "number" ? raw : parseFloat(String(raw));
      if (!isFinite(price) || price <= 0) continue;
      result.set(spec.label, {
        label: spec.label,
        price: Math.round(price * 100) / 100,
        date: dateRaw,            // e.g. "2024M12"
      });
    }

    if (result.size === CROPS.length) break; // got all three
  }

  return result;
}

async function getPinkSheetEntry(
  spec: CropSpec
): Promise<{ price: number; date: string } | null> {
  try {
    const now = Date.now();
    if (!pinkSheetCache || now >= pinkSheetCache.expiresAt) {
      const data = await fetchPinkSheetAll();
      pinkSheetCache = { data, expiresAt: now + CACHE_TTL_MS };
    }
    const entry = pinkSheetCache.data.get(spec.label);
    return entry ? { price: entry.price, date: entry.date } : null;
  } catch {
    // invalidate so next call retries
    pinkSheetCache = null;
    return null;
  }
}

// ── Reference price fallback: IMF DataMapper ───────────────────────────────────
//
// API: https://www.imf.org/external/datamapper/api/v1/{code}
// Response: { "values": { "{code}": { "2024": 202.5, "2023": 185.3, ... } } }
// Annual averages in USD/metric ton.

async function fetchImfDataMapper(
  code: string
): Promise<{ price: number; date: string } | null> {
  try {
    const url = `https://www.imf.org/external/datamapper/api/v1/${encodeURIComponent(code)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const json = (await res.json()) as { values?: Record<string, unknown> };
    const series = json?.values?.[code];
    if (!series || typeof series !== "object") return null;
    const entries = Object.entries(series as Record<string, unknown>)
      .filter(([, v]) => typeof v === "number" && isFinite(v as number))
      .sort(([a], [b]) => b.localeCompare(a));
    if (entries.length === 0) return null;
    const [period, value] = entries[0];
    return { price: Math.round((value as number) * 100) / 100, date: period };
  } catch {
    return null;
  }
}

async function fetchReferencePrice(
  spec: CropSpec
): Promise<{ price: number; date: string; source: RefSource } | null> {
  const wb = await getPinkSheetEntry(spec);
  if (wb) return { ...wb, source: "worldbank" };
  const imf = await fetchImfDataMapper(spec.imfCode);
  if (imf) return { ...imf, source: "imf" };
  return null;
}

// ── Futures price sources ───────────────────────────────────────────────────────

const LB_PER_MT = 2204.62;

function centsPerBushelToUsdPerTon(cents: number, bushelWeightLb: number): number {
  const bushelsPerTon = LB_PER_MT / bushelWeightLb;
  return Math.round((cents / 100) * bushelsPerTon * 100) / 100;
}

// Primary: Nasdaq Data Link CHRIS CME continuous contracts (free, no key)
// Column layout: Date(0), Open(1), High(2), Low(3), Last(4), Change(5), Settle(6), ...
async function fetchNasdaqDataLink(
  spec: CropSpec
): Promise<{ price: number; date: string } | null> {
  try {
    const url = `https://data.nasdaq.com/api/v3/datasets/${encodeURIComponent(spec.nasdaqDataset)}.json?rows=1`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      dataset?: { data?: unknown[][]; column_names?: string[] };
    };
    const rows = json?.dataset?.data;
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const row = rows[0];
    if (!Array.isArray(row)) return null;
    const dateStr = String(row[0] ?? "").slice(0, 10);
    const settle = typeof row[6] === "number" ? row[6] : parseFloat(String(row[6]));
    if (!isFinite(settle) || settle <= 0) return null;
    return { price: centsPerBushelToUsdPerTon(settle, spec.bushelWeightLb), date: dateStr };
  } catch {
    return null;
  }
}

// Fallback 1: Stooq CSV (free, no key) — price in cents/bushel
async function fetchStooqFuture(
  spec: CropSpec
): Promise<{ price: number; date: string } | null> {
  try {
    const url = `https://stooq.com/q/l/?s=${encodeURIComponent(spec.stooqSymbol)}&f=sd2t2ohlcv&h&e=csv`;
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const text = await res.text();
    const lines = text.trim().split("\n");
    if (lines.length < 2) return null;
    const cols = lines[1].trim().split(",");
    if (cols.length < 7 || cols[6] === "N/D") return null;
    const close = parseFloat(cols[6]);
    if (!isFinite(close) || close <= 0) return null;
    return { price: centsPerBushelToUsdPerTon(close, spec.bushelWeightLb), date: cols[1] };
  } catch {
    return null;
  }
}

// Fallback 2: Yahoo Finance (unofficial, no key) — price in USX (cents)
async function fetchYahooFuture(
  spec: CropSpec
): Promise<{ price: number; date: string } | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(spec.yahooSymbol)}?interval=1d&range=5d`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      chart?: {
        result?: Array<{
          meta?: { regularMarketPrice?: number; regularMarketTime?: number };
        }>;
      };
    };
    const meta = json?.chart?.result?.[0]?.meta;
    const raw = meta?.regularMarketPrice;
    if (!raw || !isFinite(raw) || raw <= 0) return null;
    const ts = meta?.regularMarketTime;
    const date = ts
      ? new Date(ts * 1000).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);
    // Yahoo returns cents/bushel for grain futures (currency="USX")
    return { price: centsPerBushelToUsdPerTon(raw, spec.bushelWeightLb), date };
  } catch {
    return null;
  }
}

async function fetchFuturesPrice(
  spec: CropSpec
): Promise<{ price: number; date: string; source: FuturesSource } | null> {
  const nasdaq = await fetchNasdaqDataLink(spec);
  if (nasdaq) return { ...nasdaq, source: "nasdaq" };
  const stooq = await fetchStooqFuture(spec);
  if (stooq) return { ...stooq, source: "stooq" };
  const yahoo = await fetchYahooFuture(spec);
  if (yahoo) return { ...yahoo, source: "yahoo" };
  return null;
}

// ── Per-commodity cache ────────────────────────────────────────────────────────

interface CacheEntry {
  data: CommodityBenchmark;
  expiresAt: number;
}
const cache = new Map<string, CacheEntry>();

function getCached(key: string): CommodityBenchmark | undefined {
  const entry = cache.get(key);
  if (entry && Date.now() < entry.expiresAt) return entry.data;
  return undefined;
}
function setCached(key: string, data: CommodityBenchmark) {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

async function fetchCommodity(spec: CropSpec): Promise<CommodityBenchmark> {
  const cached = getCached(spec.label);
  if (cached) return cached;

  const [ref, futures] = await Promise.all([
    fetchReferencePrice(spec),
    fetchFuturesPrice(spec),
  ]);

  const benchmark: CommodityBenchmark = {
    crop: spec.label,
    worldBankPrice: ref?.price ?? null,
    worldBankDate: ref?.date ?? null,
    worldBankSource: ref?.source ?? null,
    cmeFuturePrice: futures?.price ?? null,
    cmeFutureDate: futures?.date ?? null,
    cmeFutureSource: futures?.source ?? null,
    unit: "USD/ton",
  };

  setCached(spec.label, benchmark);
  return benchmark;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Returns benchmarks for all three covered commodities (Maíz, Soya, Trigo).
 * If `crop` is supplied the matching benchmark is first in the returned array.
 * Individual price fields may be null when upstream APIs are unavailable.
 */
export async function getInternationalPrices(
  crop?: string
): Promise<InternationalPricesResult> {
  const allBenchmarks = await Promise.all(CROPS.map(fetchCommodity));

  let sorted = allBenchmarks;
  if (crop) {
    const label = normalizeCropName(crop);
    if (label) {
      sorted = [
        ...allBenchmarks.filter((b) => b.crop === label),
        ...allBenchmarks.filter((b) => b.crop !== label),
      ];
    }
  }

  return { benchmarks: sorted, fetchedAt: new Date().toISOString() };
}

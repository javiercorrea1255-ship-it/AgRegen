/**
 * Servicio de precios de mercado local e internacional
 * SNIIM (precios agrícolas México) + tipo de cambio oficial
 * Cache en memoria de 6 horas para minimizar peticiones
 */

export interface SniimPrice {
  crop: string;
  price: number;
  unit: string;
  plaza: string;
  state: string;
  date: string;
}

export interface ExchangeRate {
  usdMxn: number;
  date: string;
  source?: string;
}

/** Flat shape returned by GET /api/market/prices */
export interface MarketPriceFlatResult {
  price: number | null;
  currency: string;
  plaza: string | null;
  date: string;
  usdMxn: number | null;
  crop: string;
  state: string;
  supported: boolean;
}

export interface MarketPriceResult {
  sniim: SniimPrice | null;
  exchange: ExchangeRate | null;
  cachedAt: string;
}

// ── In-memory cache ─────────────────────────────────────────────────────────
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const priceCache = new Map<string, CacheEntry<SniimPrice | null>>();
let exchangeCache: CacheEntry<ExchangeRate | null> | null = null;

function getCached<T>(key: string, map: Map<string, CacheEntry<T>>): T | undefined {
  const entry = map.get(key);
  if (entry && Date.now() < entry.expiresAt) return entry.data;
  return undefined;
}

function setCached<T>(key: string, data: T, map: Map<string, CacheEntry<T>>) {
  map.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ── Crop & state code mappings for SNIIM ────────────────────────────────────
const SNIIM_PRODUCTS: Record<string, { id: number; label: string; unit: string }> = {
  maíz:    { id: 85,  label: "Maíz blanco",   unit: "$/ton" },
  maiz:    { id: 85,  label: "Maíz blanco",   unit: "$/ton" },
  trigo:   { id: 107, label: "Trigo",          unit: "$/ton" },
  soya:    { id: 101, label: "Soya",           unit: "$/ton" },
  sorgo:   { id: 100, label: "Sorgo grano",    unit: "$/ton" },
  girasol: { id: 88,  label: "Girasol",        unit: "$/ton" },
  frijol:  { id: 82,  label: "Frijol bayo",    unit: "$/ton" },
  arroz:   { id: 76,  label: "Arroz palay",    unit: "$/ton" },
  cebada:  { id: 79,  label: "Cebada grano",   unit: "$/ton" },
};

const SNIIM_STATES: Record<string, { id: number; label: string }> = {
  aguascalientes:      { id: 1,  label: "Aguascalientes" },
  "baja california":   { id: 2,  label: "Baja California" },
  "baja california sur": { id: 3, label: "Baja California Sur" },
  campeche:            { id: 4,  label: "Campeche" },
  chiapas:             { id: 7,  label: "Chiapas" },
  chihuahua:           { id: 8,  label: "Chihuahua" },
  "ciudad de méxico":  { id: 9,  label: "Ciudad de México" },
  coahuila:            { id: 5,  label: "Coahuila" },
  colima:              { id: 6,  label: "Colima" },
  durango:             { id: 10, label: "Durango" },
  guanajuato:          { id: 11, label: "Guanajuato" },
  guerrero:            { id: 12, label: "Guerrero" },
  hidalgo:             { id: 13, label: "Hidalgo" },
  jalisco:             { id: 14, label: "Jalisco" },
  "estado de méxico":  { id: 15, label: "Estado de México" },
  mexico:              { id: 15, label: "Estado de México" },
  michoacán:           { id: 16, label: "Michoacán" },
  michoacan:           { id: 16, label: "Michoacán" },
  morelos:             { id: 17, label: "Morelos" },
  nayarit:             { id: 18, label: "Nayarit" },
  "nuevo león":        { id: 19, label: "Nuevo León" },
  "nuevo leon":        { id: 19, label: "Nuevo León" },
  oaxaca:              { id: 20, label: "Oaxaca" },
  puebla:              { id: 21, label: "Puebla" },
  querétaro:           { id: 22, label: "Querétaro" },
  queretaro:           { id: 22, label: "Querétaro" },
  "quintana roo":      { id: 23, label: "Quintana Roo" },
  "san luis potosí":   { id: 24, label: "San Luis Potosí" },
  "san luis potosi":   { id: 24, label: "San Luis Potosí" },
  sinaloa:             { id: 25, label: "Sinaloa" },
  sonora:              { id: 26, label: "Sonora" },
  tabasco:             { id: 27, label: "Tabasco" },
  tamaulipas:          { id: 28, label: "Tamaulipas" },
  tlaxcala:            { id: 29, label: "Tlaxcala" },
  veracruz:            { id: 30, label: "Veracruz" },
  yucatán:             { id: 31, label: "Yucatán" },
  yucatan:             { id: 31, label: "Yucatán" },
  zacatecas:           { id: 32, label: "Zacatecas" },
};

// ── Helpers ─────────────────────────────────────────────────────────────────
function todayMx(): string {
  return new Date().toLocaleDateString("es-MX", {
    day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Mexico_City",
  });
}

function normalizeCrop(crop: string): string {
  return crop.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeState(loc: string): string {
  return loc.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Parse a price value from SNIIM HTML — look for numeric patterns in typical table cells */
function extractPriceFromHtml(html: string): { price: number; plaza: string } | null {
  // SNIIM HTML tables contain rows like: Fecha | Origen | Destino (plaza) | Precio | Var
  // We look for the first clear numeric price in the range 1000–99999 (pesos/ton for grains)
  const tableMatch = html.match(/<table[^>]*class="[^"]*Grilla[^"]*"[^>]*>([\s\S]*?)<\/table>/i);
  const searchArea = tableMatch ? tableMatch[1] : html;

  // Find all table rows after header
  const rows = searchArea.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];

  for (const row of rows.slice(1)) { // skip header row
    const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
    if (cells.length < 4) continue;

    const texts = cells.map(c => c.replace(/<[^>]+>/g, "").trim());
    const plaza = texts[2] || texts[1] || "";

    // Price cell: look for a number in range 1,000 – 99,999
    for (let i = 3; i < texts.length; i++) {
      const raw = texts[i].replace(/[$,\s]/g, "");
      const num = parseFloat(raw);
      if (!isNaN(num) && num >= 500 && num <= 99_999) {
        return { price: num, plaza };
      }
    }
  }
  return null;
}

// ── SNIIM fetch ──────────────────────────────────────────────────────────────
async function fetchSniimPrice(
  productId: number,
  stateId: number,
  productLabel: string,
  stateLabel: string,
  unit: string
): Promise<SniimPrice | null> {
  try {
    const date = todayMx();
    const url =
      `http://www.economia-sniim.gob.mx/nuevo/Precios/Agricolas/Default.aspx?` +
      `Opc=3&Datos=1&fechaIni=${date}&fechaFin=${date}` +
      `&IdProducto=${productId}&IdEstado=${stateId}&RegistrosPorPagina=10&RegistrosTotal=0`;

    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 8000);

    const resp = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 AgRegen/5.0",
        "Accept": "text/html,application/xhtml+xml",
        "Referer": "http://www.economia-sniim.gob.mx/",
      },
      signal: ctrl.signal,
    });
    clearTimeout(timeout);

    if (!resp.ok) return null;
    const html = await resp.text();

    const extracted = extractPriceFromHtml(html);
    if (!extracted) return null;

    return {
      crop:  productLabel,
      price: extracted.price,
      unit,
      plaza: extracted.plaza || stateLabel,
      state: stateLabel,
      date,
    };
  } catch {
    return null;
  }
}

// ── Exchange rate fetch — Banxico SIE API (official), fallback open.er-api.com ─
// Series SF43718 = Fix parity MXN per 1 USD published by Banxico
// Token: register free at https://www.banxico.org.mx/SieAPIRest/service/v1/token
const BANXICO_SERIES = "SF43718";
const BANXICO_URL = `https://www.banxico.org.mx/SieAPIRest/service/v1/series/${BANXICO_SERIES}/datos/oportuno`;

async function fetchExchangeRateBanxico(token: string): Promise<ExchangeRate | null> {
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 8000);
    const resp = await fetch(BANXICO_URL, {
      headers: { "Bmx-Token": token },
      signal: ctrl.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) return null;
    const json = await resp.json() as {
      bmx?: { series?: Array<{ datos?: Array<{ dato: string; fecha: string }> }> };
    };
    const dato = json?.bmx?.series?.[0]?.datos?.[0];
    if (!dato) return null;
    const rate = parseFloat(dato.dato.replace(",", "."));
    if (isNaN(rate) || rate <= 0) return null;
    return {
      usdMxn: Math.round(rate * 100) / 100,
      date: dato.fecha,
      source: "Banxico",
    };
  } catch {
    return null;
  }
}

async function fetchExchangeRateFallback(): Promise<ExchangeRate | null> {
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 6000);
    const resp = await fetch("https://open.er-api.com/v6/latest/USD", { signal: ctrl.signal });
    clearTimeout(timeout);
    if (!resp.ok) return null;
    const data = await resp.json() as { rates?: Record<string, number>; time_last_update_utc?: string };
    const rate = data?.rates?.MXN;
    if (!rate || isNaN(rate)) return null;
    return {
      usdMxn: Math.round(rate * 100) / 100,
      date: data?.time_last_update_utc
        ? new Date(data.time_last_update_utc).toLocaleDateString("es-MX")
        : new Date().toLocaleDateString("es-MX"),
      source: "open.er-api",
    };
  } catch {
    return null;
  }
}

async function fetchExchangeRate(): Promise<ExchangeRate | null> {
  const token = process.env.BANXICO_TOKEN;
  if (token) {
    const result = await fetchExchangeRateBanxico(token);
    if (result) return result;
    // Token present but request failed — fall through to backup
  }
  return fetchExchangeRateFallback();
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns exchange rate (USD/MXN) with 6-hour cache.
 * Returns null if the external API is unavailable.
 */
export async function getExchangeRate(): Promise<ExchangeRate | null> {
  if (exchangeCache && Date.now() < exchangeCache.expiresAt) {
    return exchangeCache.data;
  }
  const data = await fetchExchangeRate();
  exchangeCache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
  return data;
}

/**
 * Returns today's SNIIM price for a crop in a given state.
 * @param crop Free-form crop name (e.g. "Maíz", "Soya")
 * @param state Mexican state name (e.g. "Jalisco", "Sinaloa")
 */
export async function getSniimPrice(crop: string, state: string): Promise<SniimPrice | null> {
  const cropKey = normalizeCrop(crop);
  const stateKey = normalizeState(state);

  const product = SNIIM_PRODUCTS[cropKey];
  if (!product) return null; // crop not covered by SNIIM

  const stateInfo = SNIIM_STATES[stateKey];
  const resolvedState = stateInfo ?? { id: 0, label: state };

  const cacheKey = `${product.id}:${resolvedState.id}`;
  const cached = getCached<SniimPrice | null>(cacheKey, priceCache as Map<string, CacheEntry<SniimPrice | null>>);
  if (cached !== undefined) return cached;

  const result = await fetchSniimPrice(product.id, resolvedState.id, product.label, resolvedState.label, product.unit);
  setCached(cacheKey, result, priceCache as Map<string, CacheEntry<SniimPrice | null>>);
  return result;
}

/**
 * Returns combined market price result for the given crop + state.
 * Both SNIIM and exchange rate are fetched in parallel.
 */
export async function getMarketPrices(crop: string, state: string): Promise<MarketPriceResult> {
  const [sniim, exchange] = await Promise.all([
    getSniimPrice(crop, state),
    getExchangeRate(),
  ]);
  return {
    sniim,
    exchange,
    cachedAt: new Date().toISOString(),
  };
}

/**
 * Returns the flat API contract required by GET /api/market/prices.
 * Shape: { price, currency, plaza, date, usdMxn, crop, state, supported }
 */
export async function getMarketPriceFlat(crop: string, state: string): Promise<MarketPriceFlatResult> {
  const cropKey = normalizeCrop(crop);
  const isCropSupported = cropKey in SNIIM_PRODUCTS;
  const [sniim, exchange] = await Promise.all([
    getSniimPrice(crop, state),
    getExchangeRate(),
  ]);
  return {
    price: sniim?.price ?? null,
    currency: "MXN",
    plaza: sniim?.plaza ?? null,
    date: sniim?.date ?? new Date().toLocaleDateString("es-MX"),
    usdMxn: exchange?.usdMxn ?? null,
    crop,
    state,
    supported: isCropSupported,
  };
}

/** List of crops covered by SNIIM for informational purposes */
export const SUPPORTED_SNIIM_CROPS = Object.keys(SNIIM_PRODUCTS);

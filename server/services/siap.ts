/**
 * SIAP – Servicio de Información Agroalimentaria y Pesquera (México)
 *
 * Fuente: Cierre Agrícola SIAP 2022 (publicación anual más reciente con datos completos).
 * Promedios en ton/ha, diferenciados por ciclo PV (primavera-verano) y OI (otoño-invierno).
 *
 * La API pública nube.siap.gob.mx requiere sesiones HTML y no es accesible desde entornos
 * de nube sin IP fija. Se usan datos embebidos del Cierre Agrícola publicado por SIAP/SADER.
 * Caché en memoria 7 días (los datos cambian una vez al año en el Cierre Agrícola).
 */

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// ── Tipos públicos ────────────────────────────────────────────────────────────

export interface SIAPBenchmark {
  crop: string;               // cultivo normalizado (e.g. "Maíz grano")
  state: string;              // estado detectado (e.g. "Sinaloa") o "Nacional"
  siapStateCode: number | null; // código SIAP oficial del estado (1-32)
  cycle: string;              // ciclo ("PV", "OI" o "Anual")
  year: number;               // año del Cierre Agrícola de referencia
  producerYield: number | null; // rendimiento del productor (t/ha)
  stateAvg: number | null;    // promedio estatal SIAP (t/ha), null si sin datos
  nationalAvg: number | null; // promedio nacional SIAP (t/ha), null si sin datos
  aboveStateAvg: boolean;
  available: boolean;         // true si hay al menos un referencial SIAP válido
  missingReason?: string;     // descripción si available=false
}

// ── Mapeo oficial de estados a códigos SIAP ──────────────────────────────────
// Fuente: Nomenclatura oficial SIAP (catálogo de estados 2022)

export const SIAP_STATE_CODES: Record<string, number> = {
  "Aguascalientes":    1,
  "Baja California":   2,
  "Baja California Sur": 3,
  "Campeche":          4,
  "Coahuila":          5,
  "Colima":            6,
  "Chiapas":           7,
  "Chihuahua":         8,
  "Ciudad de México":  9,
  "Durango":          10,
  "Guanajuato":       11,
  "Guerrero":         12,
  "Hidalgo":          13,
  "Jalisco":          14,
  "Estado de México": 15,
  "Michoacán":        16,
  "Morelos":          17,
  "Nayarit":          18,
  "Nuevo León":       19,
  "Oaxaca":           20,
  "Puebla":           21,
  "Querétaro":        22,
  "Quintana Roo":     23,
  "San Luis Potosí":  24,
  "Sinaloa":          25,
  "Sonora":           26,
  "Tabasco":          27,
  "Tamaulipas":       28,
  "Tlaxcala":         29,
  "Veracruz":         30,
  "Yucatán":          31,
  "Zacatecas":        32,
};

// ── Normalización de cultivos ─────────────────────────────────────────────────

const ACENT: Record<string, string> = { á:"a", é:"e", í:"i", ó:"o", ú:"u" };
function norm(s: string) {
  return s.toLowerCase().replace(/[áéíóú]/g, (c) => ACENT[c] ?? c);
}

const CROP_ALIAS: Record<string, string> = {
  "maiz": "Maíz grano", "maíz": "Maíz grano", "corn": "Maíz grano",
  "trigo": "Trigo grano", "wheat": "Trigo grano",
  "soja": "Soya", "soya": "Soya", "soybean": "Soya", "soybeans": "Soya",
  "sorgo": "Sorgo grano", "sorghum": "Sorgo grano",
  "frijol": "Frijol", "bean": "Frijol", "beans": "Frijol",
  "girasol": "Girasol", "sunflower": "Girasol",
  "arroz": "Arroz", "rice": "Arroz",
  "cebada": "Cebada grano", "barley": "Cebada grano",
  "algodón": "Algodón hueso", "algodon": "Algodón hueso", "cotton": "Algodón hueso",
  "canola": "Canola", "colza": "Canola",
  "cartamo": "Cártamo", "cártamo": "Cártamo", "safflower": "Cártamo",
  "garbanzo": "Garbanzo", "chickpea": "Garbanzo",
  "amaranto": "Amaranto", "amaranth": "Amaranto",
  "avena": "Avena grano", "oat": "Avena grano",
  "ajonjoli": "Ajonjolí", "ajonjolí": "Ajonjolí", "sesame": "Ajonjolí",
};

export function normalizeCrop(raw: string): string | null {
  const k = norm(raw);
  for (const [alias, label] of Object.entries(CROP_ALIAS)) {
    if (k.includes(norm(alias))) return label;
  }
  return null;
}

// ── Normalización y detección de estados ────────────────────────────────────

const MX_STATES = Object.keys(SIAP_STATE_CODES);

// Unambiguous abbreviations only — "mexico" (country) is intentionally excluded
// to prevent "Culiacán, Sinaloa, México" from resolving to "Estado de México".
const STATE_EXTRA_ALIASES: Record<string, string> = {
  "cdmx": "Ciudad de México",
  "df": "Ciudad de México",
  "ciudad de mexico": "Ciudad de México",
  "edomex": "Estado de México",
  "michoacan": "Michoacán",
  "queretaro": "Querétaro",
  "san luis potosi": "San Luis Potosí",
  "nuevo leon": "Nuevo León",
  "yucatan": "Yucatán",
};

export function inferStateFromText(text: string): string | null {
  if (!text) return null;
  const t = norm(text);

  // 1. Check official state names first (longest → shortest to avoid "México" →
  //    country false-positive before "Estado de México" → correct state match).
  const sorted = [...MX_STATES].sort((a, b) => b.length - a.length);
  for (const state of sorted) {
    if (t.includes(norm(state))) return state;
  }

  // 2. Check unambiguous abbreviations only after full-name matching fails.
  for (const [alias, state] of Object.entries(STATE_EXTRA_ALIASES)) {
    if (t.includes(norm(alias))) return state;
  }

  return null;
}

// ── Datos SIAP 2022 — Cierre Agrícola — por ciclo ────────────────────────────
//
// Fuente: SIAP/SADER. "Cierre de la Producción Agrícola por Estado", Año 2022.
// https://nube.siap.gob.mx/cierre_agricola/
//
// Estructura: SIAP_DATA[ciclo][estado][cultivo] = ton/ha
// Ciclos: "PV" = primavera-verano, "OI" = otoño-invierno, "Anual" = PV+OI ponderado

type CropMap = Record<string, number>;
type StateMap = Record<string, CropMap>;

const SIAP_DATA: Record<"PV" | "OI" | "Anual", { nacional: CropMap; estados: StateMap }> = {
  // ── Primavera-Verano (mayormente temporal/lluvia, cultivos de verano) ──────
  "PV": {
    nacional: {
      "Maíz grano":    3.12,
      "Sorgo grano":   4.72,
      "Soya":          2.12,
      "Frijol":        1.18,
      "Arroz":         5.22,
      "Girasol":       1.38,
      "Ajonjolí":      0.76,
      "Amaranto":      1.08,
      "Avena grano":   1.98,
    },
    estados: {
      "Sinaloa":            { "Maíz grano": 9.24, "Sorgo grano": 5.87, "Soya": 3.28, "Frijol": 2.04, "Arroz": 6.57 },
      "Jalisco":            { "Maíz grano": 3.68, "Sorgo grano": 4.21, "Frijol": 1.18, "Soya": 1.84, "Arroz": 5.12 },
      "Chiapas":            { "Maíz grano": 2.04, "Soya": 1.84, "Frijol": 1.02, "Arroz": 4.72 },
      "Veracruz":           { "Maíz grano": 2.48, "Sorgo grano": 3.87, "Frijol": 1.08, "Arroz": 5.31, "Ajonjolí": 0.88 },
      "Michoacán":          { "Maíz grano": 3.24, "Sorgo grano": 4.65, "Frijol": 1.12 },
      "Oaxaca":             { "Maíz grano": 1.36, "Frijol": 0.88, "Ajonjolí": 0.65 },
      "Guerrero":           { "Maíz grano": 1.68, "Frijol": 0.82, "Arroz": 4.12, "Ajonjolí": 0.68 },
      "Estado de México":   { "Maíz grano": 2.84, "Frijol": 1.18, "Avena grano": 2.08 },
      "Puebla":             { "Maíz grano": 2.72, "Frijol": 1.08, "Avena grano": 1.98 },
      "Guanajuato":         { "Maíz grano": 4.24, "Sorgo grano": 5.02 },
      "Tamaulipas":         { "Maíz grano": 3.88, "Sorgo grano": 5.12, "Soya": 2.74, "Girasol": 1.54 },
      "Nayarit":            { "Maíz grano": 4.42, "Sorgo grano": 3.95, "Frijol": 1.38, "Arroz": 5.72, "Soya": 2.26 },
      "Hidalgo":            { "Maíz grano": 2.21, "Frijol": 1.08, "Avena grano": 1.84 },
      "Zacatecas":          { "Maíz grano": 2.04, "Frijol": 0.61, "Avena grano": 1.48 },
      "Durango":            { "Maíz grano": 3.04, "Frijol": 0.68, "Sorgo grano": 3.95 },
      "San Luis Potosí":    { "Maíz grano": 2.44, "Soya": 2.04, "Sorgo grano": 4.12 },
      "Chihuahua":          { "Maíz grano": 5.64, "Frijol": 0.74, "Avena grano": 2.26 },
      "Tlaxcala":           { "Maíz grano": 2.98, "Frijol": 1.26, "Avena grano": 2.08 },
      "Colima":             { "Maíz grano": 4.87, "Sorgo grano": 5.21 },
      "Morelos":            { "Maíz grano": 3.08, "Sorgo grano": 4.94 },
      "Aguascalientes":     { "Maíz grano": 3.68, "Frijol": 0.92, "Sorgo grano": 4.24 },
      "Querétaro":          { "Maíz grano": 3.94, "Sorgo grano": 4.65 },
      "Tabasco":            { "Maíz grano": 1.87, "Arroz": 4.21, "Soya": 1.87 },
      "Campeche":           { "Maíz grano": 1.36, "Soya": 2.24, "Sorgo grano": 3.04, "Arroz": 3.74 },
      "Yucatán":            { "Maíz grano": 0.78, "Soya": 2.08, "Sorgo grano": 3.12 },
      "Quintana Roo":       { "Maíz grano": 0.71, "Soya": 1.82 },
    },
  },

  // ── Otoño-Invierno (mayormente riego, cultivos de invierno) ──────────────
  "OI": {
    nacional: {
      "Maíz grano":    8.45,
      "Trigo grano":   6.12,
      "Soya":          2.18,
      "Sorgo grano":   5.48,
      "Garbanzo":      1.45,
      "Frijol":        1.58,
      "Cártamo":       1.24,
      "Algodón hueso": 1.85,
      "Canola":        1.68,
      "Cebada grano":  2.92,
      "Avena grano":   2.14,
    },
    estados: {
      "Sinaloa":          { "Maíz grano": 9.87, "Trigo grano": 5.24, "Soya": 3.54, "Garbanzo": 1.65, "Frijol": 2.32, "Cártamo": 1.44, "Sorgo grano": 6.32 },
      "Sonora":           { "Maíz grano": 12.24, "Trigo grano": 6.92, "Soya": 3.18, "Garbanzo": 1.57, "Cártamo": 1.41, "Algodón hueso": 1.95 },
      "Baja California":  { "Trigo grano": 6.13, "Maíz grano": 11.8, "Algodón hueso": 2.27, "Cártamo": 1.55 },
      "Baja California Sur": { "Trigo grano": 5.48, "Sorgo grano": 5.92, "Garbanzo": 1.72, "Frijol": 1.86 },
      "Tamaulipas":       { "Soya": 2.92, "Sorgo grano": 5.54, "Trigo grano": 4.14, "Maíz grano": 4.34, "Girasol": 1.68 },
      "Guanajuato":       { "Trigo grano": 5.92, "Cebada grano": 3.18, "Sorgo grano": 5.38, "Maíz grano": 4.78 },
      "Chihuahua":        { "Trigo grano": 4.38, "Avena grano": 2.42, "Algodón hueso": 1.78, "Maíz grano": 6.12 },
      "Coahuila":         { "Sorgo grano": 4.62, "Trigo grano": 3.94, "Algodón hueso": 1.72, "Maíz grano": 4.18 },
      "Jalisco":          { "Trigo grano": 4.92, "Cebada grano": 2.68, "Sorgo grano": 4.65, "Maíz grano": 4.02 },
      "Puebla":           { "Trigo grano": 3.94, "Cebada grano": 3.28, "Avena grano": 2.12 },
      "Tlaxcala":         { "Trigo grano": 3.52, "Cebada grano": 3.02, "Avena grano": 2.24 },
      "Hidalgo":          { "Trigo grano": 4.32, "Cebada grano": 2.48, "Avena grano": 2.02 },
      "Michoacán":        { "Trigo grano": 4.62, "Sorgo grano": 5.08 },
      "Nayarit":          { "Frijol": 1.54, "Sorgo grano": 4.31, "Maíz grano": 4.84 },
      "Nuevo León":       { "Sorgo grano": 4.24, "Trigo grano": 4.32 },
      "Durango":          { "Avena grano": 1.94 },
      "Querétaro":        { "Trigo grano": 5.28, "Cebada grano": 3.12 },
    },
  },

  // ── Anual (combinado PV+OI ponderado, para ciclos sin especificar) ────────
  "Anual": {
    nacional: {
      "Maíz grano":    3.73,
      "Trigo grano":   5.85,
      "Soya":          2.12,
      "Sorgo grano":   4.98,
      "Frijol":        1.34,
      "Girasol":       1.43,
      "Arroz":         5.22,
      "Cebada grano":  2.85,
      "Algodón hueso": 1.82,
      "Canola":        1.65,
      "Cártamo":       1.21,
      "Garbanzo":      1.42,
      "Avena grano":   2.05,
      "Amaranto":      1.08,
      "Ajonjolí":      0.78,
    },
    estados: {
      "Sinaloa":            { "Maíz grano": 9.56, "Trigo grano": 5.24, "Soya": 3.42, "Sorgo grano": 6.12, "Frijol": 2.18, "Arroz": 6.84, "Garbanzo": 1.67, "Algodón hueso": 2.12, "Cártamo": 1.42 },
      "Sonora":             { "Maíz grano": 12.24, "Trigo grano": 6.92, "Soya": 3.18, "Sorgo grano": 5.98, "Frijol": 1.85, "Garbanzo": 1.55, "Algodón hueso": 1.93, "Cártamo": 1.38 },
      "Tamaulipas":         { "Maíz grano": 4.12, "Sorgo grano": 5.34, "Soya": 2.85, "Trigo grano": 4.12, "Girasol": 1.62, "Frijol": 1.14, "Cártamo": 1.28 },
      "Jalisco":            { "Maíz grano": 3.84, "Sorgo grano": 4.43, "Frijol": 1.25, "Soya": 1.92, "Trigo grano": 4.85, "Avena grano": 2.14, "Cebada grano": 2.62 },
      "Guanajuato":         { "Maíz grano": 4.52, "Trigo grano": 5.85, "Sorgo grano": 5.21, "Frijol": 1.42, "Cebada grano": 3.12, "Avena grano": 2.18 },
      "Chihuahua":          { "Maíz grano": 5.87, "Frijol": 0.78, "Avena grano": 2.34, "Trigo grano": 4.32, "Sorgo grano": 4.76, "Algodón hueso": 1.75 },
      "Veracruz":           { "Maíz grano": 2.63, "Sorgo grano": 4.05, "Frijol": 1.12, "Arroz": 5.43, "Ajonjolí": 0.92 },
      "Michoacán":          { "Maíz grano": 3.42, "Sorgo grano": 4.87, "Frijol": 1.18, "Trigo grano": 4.54, "Arroz": 5.12 },
      "Chiapas":            { "Maíz grano": 2.14, "Soya": 1.84, "Frijol": 1.08, "Arroz": 4.82, "Sorgo grano": 3.95, "Ajonjolí": 0.74 },
      "Oaxaca":             { "Maíz grano": 1.43, "Frijol": 0.95, "Girasol": 1.12, "Ajonjolí": 0.68 },
      "Guerrero":           { "Maíz grano": 1.76, "Frijol": 0.87, "Arroz": 4.23, "Ajonjolí": 0.71 },
      "Hidalgo":            { "Maíz grano": 2.34, "Trigo grano": 4.23, "Cebada grano": 2.42, "Frijol": 1.15, "Avena grano": 1.98 },
      "Estado de México":   { "Maíz grano": 2.98, "Frijol": 1.23, "Cebada grano": 2.85, "Avena grano": 2.12, "Trigo grano": 3.54 },
      "Puebla":             { "Maíz grano": 2.87, "Frijol": 1.15, "Cebada grano": 3.21, "Trigo grano": 3.87, "Avena grano": 2.05 },
      "Tlaxcala":           { "Maíz grano": 3.12, "Trigo grano": 3.45, "Cebada grano": 2.95, "Frijol": 1.32, "Avena grano": 2.18 },
      "Durango":            { "Maíz grano": 3.21, "Frijol": 0.72, "Sorgo grano": 4.12, "Avena grano": 1.87 },
      "Zacatecas":          { "Maíz grano": 2.15, "Frijol": 0.64, "Avena grano": 1.54 },
      "San Luis Potosí":    { "Maíz grano": 2.56, "Soya": 2.12, "Sorgo grano": 4.23, "Frijol": 0.95 },
      "Nayarit":            { "Maíz grano": 4.63, "Sorgo grano": 4.12, "Frijol": 1.43, "Arroz": 5.87, "Soya": 2.34, "Girasol": 1.54 },
      "Colima":             { "Maíz grano": 5.12, "Sorgo grano": 5.43 },
      "Nuevo León":         { "Maíz grano": 3.87, "Sorgo grano": 4.12, "Trigo grano": 4.23, "Frijol": 1.02 },
      "Baja California":    { "Maíz grano": 11.8, "Trigo grano": 6.13, "Algodón hueso": 2.24, "Cártamo": 1.52 },
      "Baja California Sur":{ "Trigo grano": 5.42, "Sorgo grano": 5.84, "Garbanzo": 1.68, "Frijol": 1.82 },
      "Yucatán":            { "Maíz grano": 0.82, "Soya": 2.15, "Sorgo grano": 3.24 },
      "Campeche":           { "Maíz grano": 1.43, "Soya": 2.34, "Sorgo grano": 3.12, "Arroz": 3.87 },
      "Tabasco":            { "Maíz grano": 1.98, "Arroz": 4.32, "Soya": 1.94 },
      "Querétaro":          { "Maíz grano": 4.12, "Sorgo grano": 4.87, "Trigo grano": 5.12, "Cebada grano": 3.04 },
      "Morelos":            { "Maíz grano": 3.24, "Sorgo grano": 5.12 },
      "Aguascalientes":     { "Maíz grano": 3.87, "Frijol": 0.98, "Sorgo grano": 4.43 },
      "Coahuila":           { "Sorgo grano": 4.54, "Trigo grano": 3.87, "Maíz grano": 4.12, "Algodón hueso": 1.68 },
      "Quintana Roo":       { "Maíz grano": 0.75, "Soya": 1.87 },
      "Ciudad de México":   { "Maíz grano": 2.87 },
    },
  },
};

const SIAP_YEAR = 2022;

// ── Normalización de ciclo ─────────────────────────────────────────────────

export function normalizeCycle(cycleSeason: string | null | undefined): "PV" | "OI" | "Anual" {
  if (!cycleSeason) return "Anual";
  const c = cycleSeason.toLowerCase();
  if (c.includes("primavera") || c.includes("verano") || c === "pv") return "PV";
  if (c.includes("otono") || c.includes("otoño") || c.includes("invierno") || c === "oi") return "OI";
  return "Anual";
}

// ── Cache ──────────────────────────────────────────────────────────────────────

interface CacheEntry { data: SIAPBenchmark; expiresAt: number }
const cache = new Map<string, CacheEntry>();

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Returns SIAP benchmark data for a given crop, state, cycle and optional producer yield.
 *
 * @param cropRaw       Raw crop name (e.g. "Maíz amarillo", "Soya")
 * @param stateRaw      State name from parcel location or user profile (may be null)
 * @param cycle         Detected cycle ("PV" | "OI" | "Anual")
 * @param producerYield Producer's recorded yield in t/ha (null if no record)
 */
export function getSIAPYieldBenchmark(
  cropRaw: string,
  stateRaw: string | null,
  cycle: "PV" | "OI" | "Anual",
  producerYield: number | null,
): SIAPBenchmark {
  const crop = normalizeCrop(cropRaw) ?? cropRaw;
  const state = (stateRaw && inferStateFromText(stateRaw)) ?? stateRaw ?? "Nacional";
  const siapStateCode = SIAP_STATE_CODES[state] ?? null;

  const cacheK = `${crop}|${state}|${cycle}|${producerYield ?? "null"}`;
  const cached = cache.get(cacheK);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  const cycleData = SIAP_DATA[cycle];
  const nationalAvg = cycleData.nacional[crop] ?? null;
  const stateAvg = (state !== "Nacional" ? cycleData.estados[state]?.[crop] : null) ?? null;

  // If neither national nor state data exists, crop is not covered by SIAP data
  const available = nationalAvg !== null || stateAvg !== null;

  const data: SIAPBenchmark = {
    crop,
    state,
    siapStateCode,
    cycle,
    year: SIAP_YEAR,
    producerYield,
    stateAvg,
    nationalAvg,
    aboveStateAvg:
      producerYield != null && stateAvg != null ? producerYield > stateAvg : false,
    available,
    missingReason: !available
      ? `Sin datos SIAP para "${crop}" en ciclo ${cycle}. Cultivo no disponible en el Cierre Agrícola ${SIAP_YEAR}.`
      : undefined,
  };

  cache.set(cacheK, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}

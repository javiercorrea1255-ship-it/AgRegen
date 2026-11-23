/**
 * Casos reales — pipeline async desde la base.
 *
 * Lee parcelas marcadas `isPublic=true` y construye un dataset
 * sanitizado para SSR de `/casos` y `/casos/:slug`. Reglas de
 * privacidad acordadas:
 *   - No exponemos `userId`, `name` interno ni `latitude`/`longitude`
 *     exactas.
 *   - El campo `location` (texto libre) se respeta como región pero se
 *     trunca a la primera coma o paréntesis para no filtrar dirección.
 *   - El slug es estable y derivado del id (primeros 8 chars del UUID)
 *     más el slug del cultivo, así una parcela despublicada no expone
 *     el id completo si alguien colecciona urls.
 *   - No publicamos parcelas sin un mínimo de evidencia (al menos 3
 *     mediciones de NDVI y ≥30 días de cobertura). Esto evita publicar
 *     casos vacíos sólo por estar marcados públicos.
 */

import { storage } from "../storage";
import type {
  Parcel,
  ParcelData,
  TillagePractices,
  CropRotation,
  AnimalIntegration,
} from "@shared/schema";
import { CROPS, slugifyStage } from "./crops-data";

export type CaseLocale = "es" | "en" | "pt" | "zh";

export interface CaseSeries {
  /** ISO yyyy-mm-dd. */
  date: string;
  ndvi: number | null;
  evi: number | null;
  soilMoisture: number | null;
}

export interface CaseRecord {
  /** Slug url-safe estable, ej. "soja-a3f4b7c2". */
  slug: string;
  /** Cultivo (slug del catálogo si existe; si no, el texto crudo). */
  cropSlug: string | null;
  cropLabel: string;
  /** Región sanitizada (texto), ej. "Buenos Aires, Argentina". */
  region: string;
  /** Hectáreas, redondeadas a 1 decimal. */
  areaHa: number;
  /** Sistema de riego declarado (texto del schema). */
  irrigationSystem: string;
  /** Fecha de siembra ISO yyyy-mm-dd, si está disponible. */
  plantingDate: string | null;
  /** Etapa fenológica reportada, si la hay. */
  phenologicalStage: string | null;
  /** Series ordenadas por fecha ascendente. Hasta 60 puntos. */
  series: CaseSeries[];
  /** Fecha de la última medición, ISO. Útil como `dateModified`. */
  lastMeasurementAt: string | null;
  /**
   * Prácticas regenerativas declaradas, en formato editorial corto
   * (etiquetas legibles). Vacío si la parcela no reportó prácticas.
   */
  practices: string[];
  /**
   * Resultados observados a partir de la serie NDVI: pico, media,
   * cobertura temporal. No publicamos comparaciones contra años previos
   * porque no tenemos baseline confiable a este nivel.
   */
  outcomes: {
    ndviPeak: number;
    ndviAvg: number;
    daysCovered: number;
    measurements: number;
  };
}

const MIN_SERIES_POINTS = 3;
const MIN_DAYS_COVERAGE = 30;

function shortHash(id: string): string {
  // primeros 8 chars del uuid, sin guiones.
  return id.replace(/-/g, "").slice(0, 8);
}

function sanitizeRegion(raw: string): string {
  if (!raw) return "";
  // Política: granularidad región/municipio como máximo. Nunca calle, lote,
  // referencia, ni texto libre del productor que pueda identificar la
  // parcela. Reglas en cascada:
  //  1. Cortar al primer separador (coma, punto y coma, paréntesis, slash).
  //  2. Eliminar dígitos (números de calle, lote, ruta).
  //  3. Si tras limpiar quedan más de 4 palabras → tomar sólo las 2 primeras
  //     (heurística para descartar direcciones tipo "Calle X entre A y B").
  //  4. Tope duro de 40 chars.
  const firstSep = raw.search(/[,;(/]/);
  let head = (firstSep >= 0 ? raw.slice(0, firstSep) : raw).trim();
  head = head.replace(/\d+/g, "").replace(/\s{2,}/g, " ").trim();
  const words = head.split(/\s+/).filter(Boolean);
  if (words.length > 4) head = words.slice(0, 2).join(" ");
  if (head.length > 40) head = head.slice(0, 37).trimEnd() + "…";
  return head;
}

/**
 * Convierte filas crudas de prácticas/rotación/integración animal en una
 * lista corta de etiquetas editoriales legibles. Pensado para SEO y para
 * comunicar al lector qué hizo el productor sin exponer cifras sensibles
 * (ej. cantidad de cabezas). Idioma base: español neutro; el renderer las
 * envuelve tal cual o las localiza.
 */
/**
 * Mapa estable slug → etiqueta editorial. Los slugs son la clave canónica
 * usada en URLs (`?practica=siembra-directa`) y en el filtro server-side;
 * las etiquetas son lo que ve el lector. No agregar entradas sin
 * actualizar también `PRACTICE_KEYS`.
 */
export const PRACTICE_LABELS: Record<string, { es: string; en: string }> = {
  "siembra-directa": { es: "Siembra directa", en: "No-till seeding" },
  "labranza-minima": { es: "Labranza mínima", en: "Minimum tillage" },
  "rotacion-descanso": { es: "Rotación con descanso", en: "Rotation with fallow" },
  "agroforestal": { es: "Sistema agroforestal", en: "Agroforestry system" },
  "doble-cultivo": { es: "Doble cultivo anual", en: "Double cropping" },
  "integracion-animal": { es: "Integración animal", en: "Livestock integration" },
};
export const PRACTICE_KEYS = Object.keys(PRACTICE_LABELS);

function derivePractices(
  tillage: TillagePractices[],
  rotation: CropRotation[],
  animals: AnimalIntegration | undefined,
): string[] {
  const out = new Set<string>();
  const lastTill = tillage.slice().sort((a, b) => b.cycleYear - a.cycleYear)[0];
  if (lastTill) {
    const mech =
      (lastTill.desvaradora ?? 0) +
      (lastTill.barbecho ?? 0) +
      (lastTill.aradoSubsolado ?? 0) +
      (lastTill.rastra ?? 0);
    if (mech === 0) out.add("siembra-directa");
    else if (mech <= 1) out.add("labranza-minima");
  }
  const lastRot = rotation.slice().sort((a, b) => b.year - a.year)[0];
  if (lastRot) {
    if (lastRot.rotationSystem === "rotacion_descanso") out.add("rotacion-descanso");
    else if (lastRot.rotationSystem === "agroforestal") out.add("agroforestal");
    if (lastRot.springCrops && lastRot.fallCrops) out.add("doble-cultivo");
  }
  if (animals) {
    const anyLivestock =
      animals.hasBovinos ||
      animals.hasOvinos ||
      animals.hasCaprinos ||
      animals.hasAves ||
      animals.hasPorcinos;
    if (anyLivestock) out.add("integracion-animal");
  }
  return Array.from(out);
}

/**
 * Convierte una región sanitizada en slug estable (`"Zapopan"` →
 * `"zapopan"`). Devuelve "" si la región está vacía.
 */
export function regionToSlug(region: string): string {
  return region
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function cropSlugFromText(text: string): string | null {
  const norm = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  for (const c of CROPS) {
    if (norm === c.slug || norm === c.curveKey.toLowerCase()) return c.slug;
  }
  return null;
}

function toIsoDate(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  try {
    const date = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

function decimalToNumber(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
}

export interface CaseHubItem {
  slug: string;
  cropSlug: string | null;
  cropLabel: string;
  region: string;
  regionSlug: string;
  areaHa: number;
  lastMeasurementAt: string | null;
  practices: string[];
}

let cache: { at: number; items: CaseRecord[] } | null = null;
const TTL_MS = 5 * 60 * 1000;

async function loadAll(): Promise<CaseRecord[]> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.items;

  const parcels: Parcel[] = await storage.getPublicParcels();
  const out: CaseRecord[] = [];

  for (const p of parcels) {
    let dataRows: ParcelData[];
    try {
      dataRows = await storage.getParcelData(p.id, 60);
    } catch (err) {
      console.error("[cases] failed to load parcel data:", err);
      continue;
    }
    // Orden ascendente por fecha (storage devuelve desc).
    const series: CaseSeries[] = dataRows
      .slice()
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .map((r) => ({
        date: toIsoDate(r.date) ?? "",
        ndvi: decimalToNumber(r.ndvi),
        evi: decimalToNumber(r.evi),
        soilMoisture: decimalToNumber(r.soilMoisture),
      }))
      .filter((r) => r.date);

    const ndviPoints = series.filter((s) => s.ndvi !== null);
    if (ndviPoints.length < MIN_SERIES_POINTS) continue;

    const firstDate = new Date(ndviPoints[0].date).getTime();
    const lastDate = new Date(ndviPoints[ndviPoints.length - 1].date).getTime();
    const days = (lastDate - firstDate) / (1000 * 60 * 60 * 24);
    if (days < MIN_DAYS_COVERAGE) continue;

    const cropSlug = cropSlugFromText(p.crop);
    const cropLabel = cropSlug
      ? CROPS.find((c) => c.slug === cropSlug)?.curveKey ?? p.crop
      : p.crop;

    const slug = `${cropSlug ?? "parcela"}-${shortHash(p.id)}`;

    // Prácticas + resultados observados.
    let tillage: TillagePractices[] = [];
    let rotation: CropRotation[] = [];
    let animals: AnimalIntegration | undefined;
    try {
      [tillage, rotation, animals] = await Promise.all([
        storage.getTillagePracticesByParcel(p.id),
        storage.getCropRotationByParcel(p.id),
        storage.getAnimalIntegrationByParcel(p.id),
      ]);
    } catch (err) {
      console.error("[cases] failed to load practices for parcel", p.id, err);
    }
    const practices = derivePractices(tillage, rotation, animals);

    const ndviValues = ndviPoints.map((s) => s.ndvi as number);
    const ndviPeak = Math.max(...ndviValues);
    const ndviAvg = ndviValues.reduce((a, b) => a + b, 0) / ndviValues.length;

    out.push({
      slug,
      cropSlug,
      cropLabel,
      region: sanitizeRegion(p.location),
      areaHa: Math.round(parseFloat(String(p.area)) * 10) / 10,
      irrigationSystem: p.irrigationSystem ?? "temporal",
      plantingDate: toIsoDate(p.plantingDate),
      phenologicalStage: p.phenologicalStage ?? null,
      series,
      lastMeasurementAt: ndviPoints[ndviPoints.length - 1].date,
      practices,
      outcomes: {
        ndviPeak: Math.round(ndviPeak * 100) / 100,
        ndviAvg: Math.round(ndviAvg * 100) / 100,
        daysCovered: Math.round(days),
        measurements: ndviPoints.length,
      },
    });
  }

  cache = { at: now, items: out };
  return out;
}

export async function getAllCases(): Promise<CaseRecord[]> {
  return loadAll();
}

export async function findCase(slug: string): Promise<CaseRecord | null> {
  const all = await loadAll();
  return all.find((c) => c.slug === slug) ?? null;
}

export async function getCaseHubItems(): Promise<CaseHubItem[]> {
  const all = await loadAll();
  return all.map((c) => ({
    slug: c.slug,
    cropSlug: c.cropSlug,
    cropLabel: c.cropLabel,
    region: c.region,
    regionSlug: regionToSlug(c.region),
    areaHa: c.areaHa,
    lastMeasurementAt: c.lastMeasurementAt,
    practices: c.practices,
  }));
}

export { slugifyStage };

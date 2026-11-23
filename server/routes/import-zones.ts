/**
 * AgRegen — Import / Export Zones routes (T147)
 *
 * Endpoints registered here:
 *  - POST   /api/parcels/:id/import-geometry        — multipart, returns preview only
 *  - POST   /api/parcels/:id/zones/from-import      — commit preview → managementZones
 *  - GET    /api/parcels/:id/zone-imports           — list traceability rows
 *  - GET    /api/zone-sets/:zoneSetId/export-machine?format=… — download in autoguidance format
 *
 * The factory pattern mirrors `registerSatelliteZoneRoutes` so the routes can
 * be exercised end-to-end via supertest with stubbed auth middleware.
 */
import type { Express, Request, Response as ExpressResponse, RequestHandler } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";
import * as turf from "@turf/turf";
import type { Feature, FeatureCollection, Geometry, Point, Polygon, MultiPolygon, LineString, MultiLineString, MultiPoint, Position } from "geojson";

import type { IStorage } from "../storage";
import { parseGeometryFile, geometryIntersectsParcel, type CsvColumnMapping, type ParseResult } from "../services/geometry-import";
import { exportZones, type ExportZoneInput, type MachineExportFormat } from "../services/zone-export";
import type { ManagementZone, InsertManagementZone, ZonePrescription, InsertSamplingPoint } from "@shared/schema";

export interface ImportZoneDeps {
  storage: IStorage;
  fetchWithTimeout: (url: string, init?: RequestInit, timeoutMs?: number) => Promise<Response>;
  geoServiceUrl?: string;
}

export interface ImportZoneAuth {
  isAuthenticated: RequestHandler;
  isActiveUser: RequestHandler;
}

/** Usuario autenticado inyectado por Passport tras el middleware isAuthenticated. */
interface AuthUser {
  id: string;
  isActive: boolean;
  role?: string;
}

/**
 * Devuelve el usuario autenticado del request de forma tipada.
 * Solo se llama dentro de rutas protegidas por isAuthenticated, por lo que
 * `user` siempre existe en runtime. La única aserción está centralizada aquí.
 */
function getAuthUser(req: Request): AuthUser {
  return (req as Request & { user: AuthUser }).user;
}

/**
 * Extrae un parámetro de ruta como `string` plano.
 * Express garantiza que los params de ruta nombrados sean siempre string,
 * pero la tipografía genérica de `Request` puede incluir `string[]`.
 */
function paramStr(val: string | string[]): string {
  return Array.isArray(val) ? val[0] ?? "" : val;
}

const MAX_UPLOAD_MB = Number(process.env.IMPORT_GEOMETRY_MAX_MB ?? "10");
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
});

const ZONE_COLORS_FALLBACK = ["#d73027", "#fdae61", "#fee08b", "#a6d96a", "#1a9850", "#2166ac", "#762a83", "#1b7837"];
const ZONE_LABELS_FALLBACK = ["Baja", "Media-Baja", "Media", "Media-Alta", "Alta"];

// ── Helpers ──────────────────────────────────────────────────────────────────

function ringArea(ring: Position[]): number {
  // Shoelace area in square degrees (approximate). For ha conversion we use turf.
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(s) / 2;
}

function polygonAreaHa(poly: Polygon | MultiPolygon): number {
  try {
    const m2 = turf.area(turf.feature(poly));
    return m2 / 10_000;
  } catch {
    // Fallback approximate (degree²): only used if turf.area throws on degenerate input.
    if (poly.type === "Polygon") return ringArea(poly.coordinates[0] ?? []) * 12_321; // ~111km²
    return poly.coordinates.reduce((s, p) => s + ringArea(p[0] ?? []) * 12_321, 0);
  }
}

function ensureClosedRing(ring: Position[]): Position[] {
  if (ring.length === 0) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return ring;
  return [...ring, first];
}

function normalizeToPolygon(g: Geometry): Polygon | MultiPolygon | null {
  if (g.type === "Polygon") return { type: "Polygon", coordinates: g.coordinates.map(ensureClosedRing) };
  if (g.type === "MultiPolygon") return { type: "MultiPolygon", coordinates: g.coordinates.map(p => p.map(ensureClosedRing)) };
  return null;
}

function pickColor(idx: number, total: number): string {
  // Stretch the fallback palette to cover the requested zone count.
  if (total <= ZONE_COLORS_FALLBACK.length) return ZONE_COLORS_FALLBACK[idx] ?? "#888888";
  // Sample evenly across the gradient.
  const t = total > 1 ? idx / (total - 1) : 0;
  const i = Math.min(ZONE_COLORS_FALLBACK.length - 1, Math.max(0, Math.round(t * (ZONE_COLORS_FALLBACK.length - 1))));
  return ZONE_COLORS_FALLBACK[i];
}

function quantileLabel(rank: number, n: number): string {
  if (n <= 0) return "Zona";
  const t = n > 1 ? rank / (n - 1) : 0.5;
  if (t < 0.2) return "Baja";
  if (t < 0.4) return "Media-Baja";
  if (t < 0.6) return "Media";
  if (t < 0.8) return "Media-Alta";
  return "Alta";
}

// ── Voronoi from points clipped to parcel polygon ────────────────────────────

function buildVoronoiZones(
  pointFc: FeatureCollection<Point>,
  parcelLatLng: [number, number][],
): { zones: { geometry: Polygon | MultiPolygon; valueMean: number; areaHa: number; sourcePoint: Point }[]; warnings: string[] } {
  const warnings: string[] = [];
  if (pointFc.features.length < 2) {
    return { zones: [], warnings: ["Se necesitan al menos 2 puntos para Voronoi."] };
  }
  // Build parcel polygon as turf feature (lon,lat).
  const parcelRing: Position[] = parcelLatLng.map(([lat, lon]) => [lon, lat]);
  const closed = ensureClosedRing(parcelRing);
  const parcelPoly = turf.polygon([closed]);
  const bbox = turf.bbox(parcelPoly);
  // Voronoi requires bbox in [minX, minY, maxX, maxY].
  const v = turf.voronoi(pointFc, { bbox: [bbox[0], bbox[1], bbox[2], bbox[3]] });
  const out: { geometry: Polygon | MultiPolygon; valueMean: number; areaHa: number; sourcePoint: Point }[] = [];
  v.features.forEach((cell, idx) => {
    if (!cell || !cell.geometry) return;
    let clipped: Polygon | MultiPolygon | null = null;
    try {
      const inter = turf.intersect(turf.featureCollection([cell as Feature<Polygon>, parcelPoly]));
      if (inter && (inter.geometry.type === "Polygon" || inter.geometry.type === "MultiPolygon")) {
        clipped = inter.geometry as Polygon | MultiPolygon;
      }
    } catch (e) {
      warnings.push(`Voronoi: no se pudo recortar la celda ${idx} (${(e as Error).message}).`);
    }
    if (!clipped) return;
    const sourcePoint = pointFc.features[idx]?.geometry as Point | undefined;
    if (!sourcePoint) return;
    const sourceProps = (pointFc.features[idx]?.properties ?? {}) as Record<string, unknown>;
    const value = typeof sourceProps.value === "number"
      ? sourceProps.value
      : Number(sourceProps.value ?? sourceProps.valor ?? sourceProps.z ?? NaN);
    out.push({
      geometry: clipped,
      valueMean: Number.isFinite(value) ? value : 0,
      areaHa: polygonAreaHa(clipped),
      sourcePoint,
    });
  });
  return { zones: out, warnings };
}

// ── Convert ParseResult features → InsertManagementZone[] ────────────────────

function buildZonesFromPolygons(
  fc: FeatureCollection,
  parcelId: string,
  zoneSetId: string,
  meta: Record<string, unknown>,
): { zones: InsertManagementZone[]; warnings: string[] } {
  const warnings: string[] = [];
  const polys = fc.features
    .map(f => normalizeToPolygon(f.geometry as Geometry))
    .map((p, i) => ({ p, props: (fc.features[i].properties ?? {}) as Record<string, unknown> }))
    .filter((x): x is { p: Polygon | MultiPolygon; props: Record<string, unknown> } => x.p != null);

  if (polys.length === 0) {
    return { zones: [], warnings: ["El archivo no contiene polígonos importables."] };
  }
  // Sort by descending value (so zoneIndex 0 = highest dose if dose-style import).
  const enriched = polys.map(({ p, props }, i) => {
    const valueMean = Number(props.value ?? props.valor ?? props.dose_per_ha ?? props.dose ?? 0);
    const label = String(props.label ?? props.name ?? props.zone_label ?? props.zoneLabel ?? "");
    return { p, valueMean: Number.isFinite(valueMean) ? valueMean : 0, label, areaHa: polygonAreaHa(p), srcIdx: i };
  });
  enriched.sort((a, b) => a.valueMean - b.valueMean); // ascending so 0 = lowest

  const total = enriched.length;
  const zones: InsertManagementZone[] = enriched.map((z, idx) => ({
    parcelId,
    interpolationId: null,
    source: "imported",
    zoneSetId,
    sourceMetadata: { ...meta, importedFromIndex: z.srcIdx },
    zoneIndex: idx,
    zoneLabel: z.label || quantileLabel(idx, total),
    category: "imported",
    areaHa: z.areaHa,
    valueMean: z.valueMean || null,
    valueStd: null,
    valueMin: null,
    valueMax: null,
    polygonGeojson: z.p,
    colorHex: pickColor(idx, total),
    aiInterpretation: null,
  }));
  return { zones, warnings };
}

function buildZonesFromVoronoi(
  fc: FeatureCollection,
  parcelId: string,
  parcel: { polygonCoordinates?: [number, number][] | null },
  zoneSetId: string,
  meta: Record<string, unknown>,
): { zones: InsertManagementZone[]; warnings: string[] } {
  if (!Array.isArray(parcel.polygonCoordinates) || parcel.polygonCoordinates.length < 3) {
    return { zones: [], warnings: ["La parcela no tiene polígono definido. Edítala antes de generar Voronoi."] };
  }
  const points: Feature<Point>[] = fc.features
    .filter(f => f.geometry?.type === "Point")
    .map(f => ({ type: "Feature", geometry: f.geometry as Point, properties: f.properties ?? {} }));
  if (points.length === 0) {
    return { zones: [], warnings: ["No hay puntos en el archivo para construir Voronoi."] };
  }
  const pointFc: FeatureCollection<Point> = { type: "FeatureCollection", features: points };
  const { zones: vzones, warnings } = buildVoronoiZones(pointFc, parcel.polygonCoordinates);
  if (vzones.length === 0) return { zones: [], warnings };
  // Sort by valueMean ascending so zoneIndex 0 = lowest.
  vzones.sort((a, b) => a.valueMean - b.valueMean);
  const total = vzones.length;
  const inserts: InsertManagementZone[] = vzones.map((vz, idx) => ({
    parcelId,
    interpolationId: null,
    source: "imported",
    zoneSetId,
    sourceMetadata: { ...meta, mode: "voronoi", sourcePoint: vz.sourcePoint },
    zoneIndex: idx,
    zoneLabel: quantileLabel(idx, total),
    category: "voronoi",
    areaHa: vz.areaHa,
    valueMean: vz.valueMean || null,
    valueStd: null,
    valueMin: null,
    valueMax: null,
    polygonGeojson: vz.geometry,
    colorHex: pickColor(idx, total),
    aiInterpretation: null,
  }));
  return { zones: inserts, warnings };
}

// ── Sampling extraction (mode = "samples") ──────────────────────────────────
// Convierte los Point/MultiPoint del FeatureCollection en filas planas que
// pueden insertarse en samplingPoints. El "value" se extrae de varios alias
// comunes para tolerar archivos heterogéneos (CE, NDVI, CIC, etc.).
const SAMPLE_VALUE_KEYS = ["value", "valor", "valor_medio", "ce", "ndvi", "elevation", "altitud", "z", "ph", "om", "n", "p", "k"];
function extractValueFromProps(props: Record<string, unknown> | null | undefined): number | null {
  if (!props) return null;
  for (const k of SAMPLE_VALUE_KEYS) {
    const v = props[k] ?? props[k.toUpperCase()];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const n = Number(v.replace(",", "."));
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}
function extractPointsForSampling(fc: FeatureCollection): Array<{ lat: number; lon: number; value: number | null; label: string | null }> {
  const out: Array<{ lat: number; lon: number; value: number | null; label: string | null }> = [];
  for (const f of fc.features) {
    if (!f.geometry) continue;
    const props = (f.properties ?? null) as Record<string, unknown> | null;
    const value = extractValueFromProps(props);
    const label = props ? (String(props.name ?? props.nombre ?? props.label ?? props.id ?? "") || null) : null;
    if (f.geometry.type === "Point") {
      const [lon, lat] = f.geometry.coordinates;
      if (Number.isFinite(lat) && Number.isFinite(lon)) out.push({ lat, lon, value, label: label ? String(label) : null });
    } else if (f.geometry.type === "MultiPoint") {
      for (const [lon, lat] of f.geometry.coordinates) {
        if (Number.isFinite(lat) && Number.isFinite(lon)) out.push({ lat, lon, value, label: label ? String(label) : null });
      }
    }
  }
  return out;
}

// ── Buffer-to-zones (mode = "reference" + bufferMeters > 0) ──────────────────
// Toma líneas (LineString/MultiLineString) o puntos y los buffereada a polígonos
// con turf.buffer; recorta a la parcela cuando hay polígono definido.
function buildZonesFromBuffer(
  fc: FeatureCollection,
  parcelId: string,
  parcel: { polygonCoordinates?: [number, number][] | null },
  zoneSetId: string,
  meta: Record<string, unknown>,
  bufferMeters: number,
): { zones: InsertManagementZone[]; warnings: string[] } {
  const warnings: string[] = [];
  const candidates = fc.features.filter(f => {
    const t = f.geometry?.type;
    return t === "LineString" || t === "MultiLineString" || t === "Point" || t === "MultiPoint";
  });
  if (candidates.length === 0) {
    return { zones: [], warnings: ["No hay líneas ni puntos para buffereada."] };
  }
  let parcelPoly: Feature<Polygon> | null = null;
  if (Array.isArray(parcel.polygonCoordinates) && parcel.polygonCoordinates.length >= 3) {
    const ring: Position[] = parcel.polygonCoordinates.map(([lat, lon]) => [lon, lat]);
    if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) ring.push([ring[0][0], ring[0][1]]);
    parcelPoly = turf.polygon([ring]);
  }
  const inserts: InsertManagementZone[] = [];
  candidates.forEach((f, idx) => {
    try {
      // Narrowamos el tipo de feature antes de pasar a turf.buffer.
      // El filtro anterior ya garantiza que la geometría es Line/Point.
      type BufferableGeom = LineString | MultiLineString | Point | MultiPoint;
      const typedFeature = turf.feature(f.geometry as BufferableGeom, f.properties ?? {});
      const buffered = turf.buffer(typedFeature, bufferMeters / 1000, { units: "kilometers" });
      if (!buffered || !buffered.geometry) return;
      let geom: Polygon | MultiPolygon = buffered.geometry as Polygon | MultiPolygon;
      if (parcelPoly) {
        // turf.intersect acepta Feature<Polygon | MultiPolygon>[] (v6 API).
        const fc = turf.featureCollection<Polygon | MultiPolygon>([turf.feature(geom), parcelPoly]);
        const clipped = turf.intersect(fc);
        if (clipped) geom = clipped.geometry as Polygon | MultiPolygon;
      }
      const areaHa = polygonAreaHa(geom);
      if (areaHa <= 0) return;
      const props = f.properties as Record<string, unknown>;
      inserts.push({
        parcelId,
        interpolationId: null,
        source: "imported",
        zoneSetId,
        sourceMetadata: { ...meta, mode: "reference", bufferMeters, sourceIndex: idx },
        zoneIndex: idx,
        zoneLabel: String(props?.name ?? props?.nombre ?? `Buffer ${idx + 1}`).slice(0, 60),
        category: "buffered",
        areaHa,
        valueMean: typeof props?.value === "number" ? props.value : null,
        valueStd: null,
        valueMin: null,
        valueMax: null,
        polygonGeojson: geom,
        colorHex: pickColor(idx, candidates.length),
        aiInterpretation: null,
      });
    } catch (e) {
      warnings.push(`Buffer ${idx + 1} falló: ${(e as Error).message}`);
    }
  });
  return { zones: inserts, warnings };
}

// ── Zod schemas ──────────────────────────────────────────────────────────────

const csvMappingSchema = z.object({
  latColumn: z.string().optional(),
  lonColumn: z.string().optional(),
  valueColumn: z.string().optional(),
  labelColumn: z.string().optional(),
}).optional();

// Strict GeoJSON geometry validators — rechazamos payloads malformados *antes*
// de pasar las geometrías a Turf, que de lo contrario explotaría con un 500.
const positionSchema = z.array(z.number().finite()).min(2).max(3);
const ringSchema = z.array(positionSchema).min(4).refine(
  // RFC 7946 §3.1.6: el primer y último punto del anillo deben coincidir.
  (ring) => {
    const a = ring[0];
    const b = ring[ring.length - 1];
    return a[0] === b[0] && a[1] === b[1];
  },
  { message: "El anillo del polígono debe estar cerrado (primer y último punto iguales)." },
);
const polygonSchema = z.object({
  type: z.literal("Polygon"),
  coordinates: z.array(ringSchema).min(1),
});
const multiPolygonSchema = z.object({
  type: z.literal("MultiPolygon"),
  coordinates: z.array(z.array(ringSchema).min(1)).min(1),
});
const pointSchema = z.object({
  type: z.literal("Point"),
  coordinates: positionSchema,
});
const multiPointSchema = z.object({
  type: z.literal("MultiPoint"),
  coordinates: z.array(positionSchema).min(1),
});
const lineStringSchema = z.object({
  type: z.literal("LineString"),
  coordinates: z.array(positionSchema).min(2),
});
const multiLineStringSchema = z.object({
  type: z.literal("MultiLineString"),
  coordinates: z.array(z.array(positionSchema).min(2)).min(1),
});
const geometrySchema = z.union([
  polygonSchema, multiPolygonSchema,
  pointSchema, multiPointSchema,
  lineStringSchema, multiLineStringSchema,
]);
const featureSchema = z.object({
  type: z.literal("Feature"),
  geometry: geometrySchema.nullable(),
  properties: z.record(z.string(), z.unknown()).nullable().optional(),
  id: z.union([z.string(), z.number()]).optional(),
});

const fromImportSchema = z.object({
  featureCollection: z.object({
    type: z.literal("FeatureCollection"),
    features: z.array(featureSchema).max(5000),
  }),
  mode: z.enum(["polygons", "voronoi", "idw", "samples", "reference"]).default("polygons"),
  originalFileName: z.string().min(1).max(255),
  format: z.enum(["kml", "kmz", "geojson", "shapefile", "csv"]),
  csvMapping: csvMappingSchema,
  warnings: z.array(z.string()).optional(),
  // Para mode = "samples": opcionalmente anexa los puntos a una campaña existente
  // o crea una nueva con la variable indicada y nombre proporcionado.
  samplesTarget: z.object({
    campaignId: z.string().min(1).optional(),
    variableId: z.string().min(1).optional(),
    campaignName: z.string().min(1).max(120).optional(),
  }).optional(),
  // Para mode = "reference": si bufferMeters > 0, las líneas se transforman en
  // polígonos de zona usando turf.buffer (mts → polígono); útil para parcelar
  // por surcos/calles.
  referenceOptions: z.object({
    bufferMeters: z.number().min(0).max(500).optional(),
  }).optional(),
  // Para mode = "idw": opciones de clasificación e interpolación.
  idwOptions: z.object({
    nZones: z.number().int().min(2).max(8).optional(),
    variableCode: z.string().min(1).max(30).optional(),
  }).optional(),
});

const exportFormatSchema = z.enum(["kml", "kmz", "shapefile", "isoxml", "geojson"]);

// ── Structured error classification ──────────────────────────────────────────

/**
 * Classifica un ZodError proveniente de `fromImportSchema.safeParse` y devuelve
 * un objeto con `errorCode`, `zoneIndex` (índice del feature afectado, si se puede
 * determinar) y `message` legible.
 *
 * Códigos definidos:
 *  - `ring_not_closed`   — El anillo de un polígono no está cerrado (primer ≠ último punto).
 *  - `non_finite_coord`  — Una coordenada es Infinity, -Infinity o NaN (o null, que es cómo
 *                          JSON.stringify serializa esos valores no-finitos).
 *  - `validation_error`  — Cualquier otro error de validación.
 */

/**
 * Resultado de clasificar un Zod issue individual (o de sus union errors anidados).
 * `null` significa "este issue no es reconocible como un error específico".
 */
type ClassifiedIssue = {
  errorCode: "ring_not_closed" | "non_finite_coord";
  zoneIndex: number | null;
} | null;

function classifyOneIssue(issue: z.ZodIssue): ClassifiedIssue {
  const path = issue.path;

  // Índice de la feature (zona) en el path, cuando está disponible.
  let zoneIndex: number | null = null;
  if (
    path[0] === "featureCollection" &&
    path[1] === "features" &&
    typeof path[2] === "number"
  ) {
    zoneIndex = path[2];
  }

  // Anillo no cerrado: el refine de ringSchema produce un issue "custom".
  if (issue.code === "custom" && issue.message.includes("cerrado")) {
    return { errorCode: "ring_not_closed", zoneIndex };
  }

  // Coordenada no finita: z.number().finite() → "Number must be finite".
  // Coordenada nula (Infinity serializado por JSON como null) → "Expected number, received null/undefined".
  const isCoordPath =
    path[0] === "featureCollection" &&
    path[1] === "features" &&
    path[3] === "geometry" &&
    path[4] === "coordinates";

  if (
    isCoordPath &&
    (issue.message === "Number must be finite" ||
      (issue.code === "invalid_type" &&
        (issue.message.includes("received null") ||
          issue.message.includes("received undefined"))))
  ) {
    return { errorCode: "non_finite_coord", zoneIndex };
  }

  // Busca recursivamente dentro de invalid_union: Zod wraps union failures
  // en un invalid_union issue que contiene los ZodErrors de cada rama.
  if (issue.code === "invalid_union") {
    for (const unionErr of issue.unionErrors) {
      for (const inner of unionErr.issues) {
        const result = classifyOneIssue(inner);
        if (result) {
          // Preferimos el zoneIndex del outer issue cuando el inner no lo tiene.
          return { ...result, zoneIndex: result.zoneIndex ?? zoneIndex };
        }
      }
    }
  }

  return null;
}

function classifyZodImportError(err: z.ZodError): {
  errorCode: "ring_not_closed" | "non_finite_coord" | "validation_error";
  zoneIndex: number | null;
  message: string;
} {
  const humanMessage = fromZodError(err).message;
  for (const issue of err.issues) {
    const result = classifyOneIssue(issue);
    if (result) return { ...result, message: humanMessage };
  }
  return { errorCode: "validation_error", zoneIndex: null, message: humanMessage };
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function registerImportZoneRoutes(app: Express, deps: ImportZoneDeps, auth: ImportZoneAuth): void {
  const { storage, fetchWithTimeout, geoServiceUrl = process.env.GEO_SERVICE_URL ?? "http://127.0.0.1:8000" } = deps;
  const { isAuthenticated, isActiveUser } = auth;

  // ── Step 1: parse upload, return preview without persisting ─────────────
  app.post(
    "/api/parcels/:id/import-geometry",
    isAuthenticated,
    isActiveUser,
    upload.single("file"),
    async (req: Request, res: ExpressResponse) => {
      try {
        const parcel = await storage.getParcel(paramStr(req.params.id));
        if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
        if (parcel.userId !== getAuthUser(req).id && getAuthUser(req).role !== "admin") return res.status(403).json({ message: "No autorizado" });
        if (!req.file) return res.status(400).json({ message: "Falta el archivo (campo 'file')." });

        // Optional CSV column mapping passed alongside the file (multipart text field).
        let csvMapping: CsvColumnMapping | undefined;
        if (req.body?.csvMapping) {
          try { csvMapping = JSON.parse(req.body.csvMapping); } catch { /* ignore */ }
        }

        let parsed: ParseResult;
        try {
          parsed = await parseGeometryFile(req.file.buffer, req.file.originalname, { csvMapping });
        } catch (e) {
          return res.status(400).json({ message: (e as Error).message });
        }

        // Warn if some features are outside the parcel bounding box.
        let outsideCount = 0;
        if (Array.isArray(parcel.polygonCoordinates) && parcel.polygonCoordinates.length >= 3) {
          for (const f of parsed.featureCollection.features) {
            if (f.geometry && !geometryIntersectsParcel(f.geometry, parcel.polygonCoordinates)) {
              outsideCount++;
            }
          }
        }
        if (outsideCount > 0) {
          parsed.warnings.push(`${outsideCount} feature(s) caen fuera del bbox de la parcela; verifica el sistema de coordenadas.`);
        }

        return res.json({
          format: parsed.format,
          featureCount: parsed.featureCount,
          geometryTypes: parsed.geometryTypes,
          warnings: parsed.warnings,
          csvDetection: parsed.csvDetection,
          featureCollection: parsed.featureCollection,
          originalFileName: req.file.originalname,
          parcelOutsideCount: outsideCount,
        });
      } catch (e) {
        const msg = (e as Error).message ?? "Error de import";
        // Multer-specific error normalization
        if (msg.includes("File too large")) {
          return res.status(413).json({ message: `El archivo excede ${MAX_UPLOAD_MB} MB.` });
        }
        return res.status(500).json({ message: `Error al importar: ${msg}` });
      }
    },
  );

  // ── Step 2: commit a previously-parsed FeatureCollection as zones ───────
  app.post("/api/parcels/:id/zones/from-import", isAuthenticated, isActiveUser, async (req: Request, res: ExpressResponse) => {
    try {
      const parcel = await storage.getParcel(paramStr(req.params.id));
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
      if (parcel.userId !== getAuthUser(req).id && getAuthUser(req).role !== "admin") return res.status(403).json({ message: "No autorizado" });

      const parsed = fromImportSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json(classifyZodImportError(parsed.error));
      }
      const body = parsed.data;
      // Filtra features con geometry: null antes de cualquier procesamiento.
      // GeoJSON permite geometry null (feature sin forma), pero los modos de
      // importación requieren geometría válida; llamadas directas a la API con
      // features nulas producirían 500 sin este guard.
      const rawFc = body.featureCollection as FeatureCollection;
      const validFeatures = rawFc.features.filter(f => f.geometry != null);
      if (validFeatures.length === 0) {
        return res.status(422).json({ message: "El FeatureCollection no contiene features con geometría válida." });
      }
      const nullCount = rawFc.features.length - validFeatures.length;
      const fc: FeatureCollection = { ...rawFc, features: validFeatures };
      const initialWarnings: string[] = nullCount > 0
        ? [`${nullCount} feature(s) sin geometría descartadas.`, ...(body.warnings ?? [])]
        : [...(body.warnings ?? [])];

      const zoneSetId = randomUUID();
      const baseMeta = {
        importedFromFile: body.originalFileName,
        format: body.format,
        mode: body.mode,
        importedAt: new Date().toISOString(),
      };

      let zones: InsertManagementZone[] = [];
      let warnings: string[] = [...initialWarnings];
      let campaignId: string | null = null;
      let pointsCreated = 0;
      let referenceGeojson: FeatureCollection | null = null;

      // Adapter tipado: polygonCoordinates viene de jsonb (unknown en Drizzle).
      // Lo narrowamos a [number, number][] | null para las funciones de zonas.
      const parcelCoords = Array.isArray(parcel.polygonCoordinates)
        ? (parcel.polygonCoordinates as [number, number][])
        : null;
      const parcelForZones = { polygonCoordinates: parcelCoords };

      if (body.mode === "polygons") {
        const r = buildZonesFromPolygons(fc, parcel.id, zoneSetId, baseMeta);
        zones = r.zones; warnings.push(...r.warnings);
      } else if (body.mode === "voronoi") {
        const r = buildZonesFromVoronoi(fc, parcel.id, parcelForZones, zoneSetId, baseMeta);
        zones = r.zones; warnings.push(...r.warnings);
      } else if (body.mode === "samples") {
        // Convertimos los puntos en filas de samplingPoints. Si el cliente nos
        // pasa un campaignId existente, anexamos a esa campaña; si pasa
        // variableId + campaignName, creamos una campaña nueva.
        const points = extractPointsForSampling(fc);
        if (points.length === 0) {
          return res.status(422).json({ message: "El archivo no contiene puntos válidos para muestreo." });
        }
        const target = body.samplesTarget ?? {};
        if (target.campaignId) {
          const camp = await storage.getSamplingCampaign(target.campaignId);
          if (!camp) return res.status(404).json({ message: "Campaña no encontrada." });
          if (camp.parcelId !== parcel.id) return res.status(400).json({ message: "La campaña pertenece a otra parcela." });
          campaignId = camp.id;
        } else if (target.variableId) {
          const variable = await storage.getMasterVariable(target.variableId);
          if (!variable) return res.status(400).json({ message: "Variable de muestreo desconocida." });
          const created = await storage.createSamplingCampaign({
            parcelId: parcel.id,
            userId: parcel.userId,
            variableId: variable.id,
            name: target.campaignName ?? `Importado ${body.originalFileName}`,
            status: "active",
            gridType: "stratified",
            nPointsPlanned: points.length,
            methodUsed: "imported",
          });
          campaignId = created.id;
        } else {
          return res.status(400).json({
            message: "Para modo 'samples' debes indicar samplesTarget.campaignId o samplesTarget.variableId.",
          });
        }
        // Determinar el siguiente pointIndex disponible (para anexado a campañas existentes).
        const existing = await storage.getSamplingPointsByCampaign(campaignId);
        const baseIndex = existing.length;
        const insertPts: InsertSamplingPoint[] = points.map((p, i) => ({
          campaignId: campaignId!,
          pointIndex: baseIndex + i,
          latPlanned: p.lat,
          lonPlanned: p.lon,
          latActual: p.lat,
          lonActual: p.lon,
          value: p.value ?? null,
          notes: p.label ?? null,
        }));
        const inserted = await storage.bulkCreateSamplingPoints(insertPts);
        pointsCreated = inserted.length;
        warnings.push(`Modo 'samples': ${pointsCreated} punto(s) anexado(s) a la campaña ${campaignId}.`);
      } else if (body.mode === "reference") {
        // Capa de referencia: guardamos el FeatureCollection tal cual para
        // mostrarlo como overlay en el mapa. Si bufferMeters > 0, además
        // generamos polígonos de zona buffereando líneas/puntos.
        referenceGeojson = fc;
        const bufferM = body.referenceOptions?.bufferMeters ?? 0;
        if (bufferM > 0) {
          const r = buildZonesFromBuffer(fc, parcel.id, parcelForZones, zoneSetId, baseMeta, bufferM);
          zones = r.zones; warnings.push(...r.warnings);
        } else {
          warnings.push(`Modo 'reference': capa visual guardada (${fc.features.length} entidad/es).`);
        }
      } else if (body.mode === "idw") {
        // Pipeline IDW: extrae puntos con valor numérico, llama al geo-service
        // /interpolate con method="idw", convierte las zonas devueltas en
        // ManagementZone persistibles con clasificación por cuantiles.
        const points = extractPointsForSampling(fc).filter(p => p.value !== null);
        if (points.length < 3) {
          return res.status(422).json({
            message: `IDW requiere al menos 3 puntos con valor numérico (encontrados: ${points.length}).`,
          });
        }
        if (!parcelCoords || parcelCoords.length < 3) {
          return res.status(422).json({
            message: "La parcela no tiene polígono definido. Edítala antes de importar con IDW.",
          });
        }
        // Polígono para el geo-service: [[lon, lat], ...] (cierra el anillo si no está cerrado).
        const geoPolygon = parcelCoords.map(([lat, lon]) => [lon, lat]);
        if (geoPolygon[0][0] !== geoPolygon[geoPolygon.length - 1][0] || geoPolygon[0][1] !== geoPolygon[geoPolygon.length - 1][1]) {
          geoPolygon.push([geoPolygon[0][0], geoPolygon[0][1]]);
        }
        const idwPayload = {
          method: "idw",
          polygon: geoPolygon,
          points: points.map(p => ({ lat: p.lat, lon: p.lon, value: p.value })),
          n_zones: body.idwOptions?.nZones ?? 3,
          variable_code: body.idwOptions?.variableCode ?? "default",
          zone_method: "spatial_kmeans",
        };
        const geoUrl = `${geoServiceUrl}/interpolate`;
        let geoResp: Response;
        try {
          geoResp = await fetchWithTimeout(geoUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(idwPayload),
          }, 45_000);
        } catch (fetchErr) {
          return res.status(503).json({
            message: `Geo-service no disponible para IDW: ${(fetchErr as Error).message}`,
          });
        }
        if (!geoResp.ok) {
          const errText = await geoResp.text().catch(() => "");
          return res.status(502).json({
            message: `Geo-service retornó ${geoResp.status} al interpolar: ${errText.slice(0, 200)}`,
          });
        }
        interface GeoServiceZone {
          zone_index: number;
          zone_label: string;
          value_mean: number;
          value_std?: number;
          value_min?: number;
          value_max?: number;
          area_ha?: number;
          geojson?: Polygon | MultiPolygon;
          color?: string;
        }
        const geoBody = await geoResp.json() as { zones?: GeoServiceZone[]; low_variance_warning?: string };
        const geoZones: GeoServiceZone[] = geoBody.zones ?? [];
        if (geoBody.low_variance_warning) warnings.push(geoBody.low_variance_warning);
        if (geoZones.length === 0) {
          return res.status(422).json({
            message: "El geo-service no generó zonas; revisa la distribución de valores.",
            warnings,
          });
        }
        zones = geoZones
          .filter(gz => gz.geojson)
          .map(gz => ({
            parcelId: parcel.id,
            interpolationId: null,
            source: "imported",
            zoneSetId,
            sourceMetadata: { ...baseMeta, mode: "idw", nInputPoints: points.length },
            zoneIndex: gz.zone_index,
            zoneLabel: gz.zone_label,
            category: "idw",
            areaHa: gz.area_ha ?? 0,
            valueMean: gz.value_mean ?? null,
            valueStd: gz.value_std != null ? String(gz.value_std) : null,
            valueMin: gz.value_min != null ? String(gz.value_min) : null,
            valueMax: gz.value_max != null ? String(gz.value_max) : null,
            polygonGeojson: gz.geojson!,
            colorHex: gz.color ?? pickColor(gz.zone_index, geoZones.length),
            aiInterpretation: null,
          } satisfies InsertManagementZone));
      }

      if (body.mode === "polygons" || body.mode === "voronoi" || body.mode === "idw") {
        if (zones.length === 0) {
          return res.status(422).json({
            message: "No se generó ninguna zona; revisa las advertencias.",
            warnings,
          });
        }
      }

      const created = zones.length > 0 ? await storage.bulkCreateManagementZones(zones) : [];

      const importRow = await storage.createZoneImport({
        parcelId: parcel.id,
        userId: parcel.userId,
        zoneSetId: created.length > 0 ? zoneSetId : null,
        campaignId,
        originalFileName: body.originalFileName,
        format: body.format,
        mode: body.mode,
        featureCount: fc.features.length,
        geometryTypes: Array.from(new Set(fc.features.map(f => f.geometry?.type).filter(Boolean) as string[])),
        referenceGeojson: referenceGeojson,
        warnings: warnings.length > 0 ? warnings : null,
      });

      return res.json({
        zoneImport: importRow,
        zoneSetId: created.length > 0 ? zoneSetId : null,
        zonesCreated: created.length,
        campaignId,
        pointsCreated,
        zones: created,
        warnings,
      });
    } catch (e) {
      return res.status(500).json({ message: `Error al persistir: ${(e as Error).message}` });
    }
  });

  // ── Step 3: list traceability rows for a parcel ─────────────────────────
  app.get("/api/parcels/:id/zone-imports", isAuthenticated, isActiveUser, async (req: Request, res: ExpressResponse) => {
    try {
      const parcel = await storage.getParcel(paramStr(req.params.id));
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
      if (parcel.userId !== getAuthUser(req).id && getAuthUser(req).role !== "admin") return res.status(403).json({ message: "No autorizado" });
      const rows = await storage.getZoneImportsByParcel(parcel.id);
      return res.json({ imports: rows });
    } catch (e) {
      return res.status(500).json({ message: `Error: ${(e as Error).message}` });
    }
  });

  // ── Step 4: machine-format export of a zone-set + its prescriptions ─────
  app.get("/api/zone-sets/:zoneSetId/export-machine", isAuthenticated, isActiveUser, async (req: Request, res: ExpressResponse) => {
    try {
      const formatParse = exportFormatSchema.safeParse(String(req.query.format ?? "geojson").toLowerCase());
      if (!formatParse.success) {
        return res.status(400).json({ message: "format debe ser uno de: kml, kmz, shapefile, isoxml, geojson" });
      }
      const fmt: MachineExportFormat = formatParse.data;
      const zones = await storage.getManagementZonesByZoneSet(paramStr(req.params.zoneSetId));
      if (zones.length === 0) return res.status(404).json({ message: "Zone-set no encontrado" });
      const parcelId = zones[0].parcelId;
      if (!parcelId) return res.status(400).json({ message: "Las zonas no tienen parcela asociada" });
      const parcel = await storage.getParcel(parcelId);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
      if (parcel.userId !== getAuthUser(req).id && getAuthUser(req).role !== "admin") return res.status(403).json({ message: "No autorizado" });

      // Pull zone prescriptions so the export carries the dose. We try all zones in parallel.
      const allPrescs = await Promise.all(zones.map(z => storage.getZonePrescriptionsByZone(z.id)));
      if (fmt !== "geojson" && allPrescs.some(group => group.some(p => p.doseUnit === "kg N"))) {
        return res.status(422).json({
          message: "Estas dosis son kg de N, no kg de producto. Revisa la prescripción en GeoJSON y conviértela a un fertilizante antes de usarla en maquinaria.",
        });
      }
      const prescByZone = new Map<string, ZonePrescription[]>();
      zones.forEach((z, i) => prescByZone.set(z.id, allPrescs[i]));

      const inputs: ExportZoneInput[] = zones.map((z: ManagementZone) => {
        const ps = prescByZone.get(z.id) ?? [];
        const main = ps[0]; // first prescription = primary product
        const geom = z.polygonGeojson as Polygon | MultiPolygon;
        return {
          zoneIndex: z.zoneIndex,
          zoneLabel: z.zoneLabel ?? ZONE_LABELS_FALLBACK[z.zoneIndex] ?? `Zona ${z.zoneIndex + 1}`,
          category: z.category ?? null,
          colorHex: z.colorHex ?? null,
          areaHa: z.areaHa != null ? Number(z.areaHa) : null,
          dosePerHa: main?.dosePerHa != null ? Number(main.dosePerHa) : null,
          doseUnit: main?.doseUnit ?? null,
          amendment: main?.amendment ?? null,
          geometry: geom,
        };
      });

      const out = await exportZones(fmt, inputs, {
        parcelName: parcel.name ?? "parcela",
        baseFilename: `${parcel.name ?? "parcela"}_prescripcion_VRA`,
        notes: `Generado por AgRegen 5.0 — ${new Date().toISOString()}`,
        fieldBoundary: (parcel.polygonCoordinates as [number, number][] | null) ?? undefined,
        productName: inputs[0]?.amendment ?? undefined,
      });
      res.setHeader("Content-Type", out.mime);
      res.setHeader("Content-Disposition", `attachment; filename="${out.filename}"`);
      return res.send(out.buffer);
    } catch (e) {
      return res.status(500).json({ message: `Error de exportación: ${(e as Error).message}` });
    }
  });
}

/**
 * AgRegen — Geometry Import Service (T147)
 *
 * Parses user-uploaded files (KML/KMZ/GeoJSON/Shapefile-zip/CSV) and
 * normalizes the result to a GeoJSON FeatureCollection in EPSG:4326.
 *
 * Public entry point: `parseGeometryFile(buf, filename, opts)`.
 * The result includes a list of warnings (e.g. ".prj missing, assumed WGS84")
 * so the UI can surface them before the user commits the import.
 */
import type { Feature, FeatureCollection, Geometry, Position, Polygon, Point } from "geojson";
import { DOMParser } from "@xmldom/xmldom";
import { kml as kmlToGeoJSON } from "@tmcw/togeojson";
import JSZip from "jszip";
import type * as shpTypes from "shpjs";
import Papa from "papaparse";
import proj4 from "proj4";
import { polygon as turfPolygon, point as turfPoint, feature as turfFeature } from "@turf/helpers";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import booleanIntersects from "@turf/boolean-intersects";

export type GeometryFormat = "kml" | "kmz" | "geojson" | "shapefile" | "csv";

export interface CsvColumnMapping {
  /** Column name (or 0-based index as string) for latitude. */
  latColumn?: string;
  /** Column name (or 0-based index as string) for longitude. */
  lonColumn?: string;
  /** Optional column for the value (used for IDW / Voronoi attribute). */
  valueColumn?: string;
  /** Optional column for the feature label. */
  labelColumn?: string;
}

export interface ParseOptions {
  /** Required only for CSV; if omitted we attempt heuristic detection. */
  csvMapping?: CsvColumnMapping;
  /** Maximum number of features to keep (defensive cap). */
  maxFeatures?: number;
}

export interface ParseResult {
  format: GeometryFormat;
  featureCollection: FeatureCollection;
  featureCount: number;
  geometryTypes: string[];
  warnings: string[];
  /** For CSV: detected/used column names (helpful for the column-mapping UI). */
  csvDetection?: {
    headers: string[];
    delimiter: string;
    decimal: "." | ",";
    suggestedMapping: CsvColumnMapping;
  };
}

const DEFAULT_MAX_FEATURES = 5000;

/**
 * Detect the format from filename + magic bytes.
 * `.shp.zip` and bare `.zip` are both treated as Shapefile (shpjs handles them).
 */
export function detectFormat(filename: string, buf: Buffer): GeometryFormat {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".kml")) return "kml";
  if (lower.endsWith(".kmz")) return "kmz";
  if (lower.endsWith(".geojson") || lower.endsWith(".json")) return "geojson";
  if (lower.endsWith(".csv") || lower.endsWith(".tsv") || lower.endsWith(".txt")) return "csv";
  if (lower.endsWith(".zip") || lower.endsWith(".shp.zip")) return "shapefile";
  // Magic-byte sniffing: PK = zip header
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b) {
    // could be KMZ or Shapefile-zip; KMZ usually contains "doc.kml" — guess by extension priority above
    return "shapefile";
  }
  // Looks like JSON?
  const head = buf.slice(0, 200).toString("utf8").trim();
  if (head.startsWith("{") || head.startsWith("[")) return "geojson";
  if (head.startsWith("<?xml") || head.startsWith("<kml")) return "kml";
  // Fallback: CSV (comma/semicolon present in first line)
  if (head.includes(",") || head.includes(";")) return "csv";
  throw new Error(`Formato no reconocido para "${filename}". Formatos soportados: KML, KMZ, GeoJSON, Shapefile (.zip), CSV.`);
}

// ── Public entry point ────────────────────────────────────────────────────────

export async function parseGeometryFile(
  buf: Buffer,
  filename: string,
  opts: ParseOptions = {},
): Promise<ParseResult> {
  const format = detectFormat(filename, buf);
  const max = opts.maxFeatures ?? DEFAULT_MAX_FEATURES;
  let raw: { fc: FeatureCollection; warnings: string[]; csvDetection?: ParseResult["csvDetection"] };

  switch (format) {
    case "kml":
      raw = parseKml(buf);
      break;
    case "kmz":
      raw = await parseKmz(buf);
      break;
    case "geojson":
      raw = parseGeoJson(buf);
      break;
    case "shapefile":
      raw = await parseShapefileZip(buf);
      break;
    case "csv":
      raw = parseCsv(buf, opts.csvMapping);
      break;
  }

  // Normalize: drop features without geometry, cap to max, collect geometry types.
  const features = (raw.fc.features ?? []).filter(f => f.geometry != null);
  const truncated = features.length > max;
  const kept = truncated ? features.slice(0, max) : features;
  if (truncated) raw.warnings.push(`Archivo truncado a ${max} features (tenía ${features.length}).`);

  const geometryTypes = Array.from(new Set(kept.map(f => f.geometry!.type))).sort();
  const fc: FeatureCollection = { type: "FeatureCollection", features: kept };

  // Final coordinate sanity check: drop features with NaN/Infinity coords.
  let droppedInvalid = 0;
  fc.features = fc.features.filter(f => {
    if (!hasFiniteCoordinates(f.geometry!)) {
      droppedInvalid++;
      return false;
    }
    return true;
  });
  if (droppedInvalid > 0) {
    raw.warnings.push(`Se descartaron ${droppedInvalid} features con coordenadas inválidas.`);
  }

  return {
    format,
    featureCollection: fc,
    featureCount: fc.features.length,
    geometryTypes,
    warnings: raw.warnings,
    csvDetection: raw.csvDetection,
  };
}

// ── KML / KMZ ────────────────────────────────────────────────────────────────

function parseKml(buf: Buffer): { fc: FeatureCollection; warnings: string[] } {
  const warnings: string[] = [];
  const xml = buf.toString("utf8");
  // @xmldom emits warnings via a logger; we silence them so a slightly malformed
  // KML still parses. The result is then validated structurally.
  const parser = new DOMParser({
    onError: (level, msg) => {
      if (level === "error" || level === "fatalError") {
        warnings.push(`KML XML: ${String(msg).slice(0, 200)}`);
      }
    },
  });
  const dom = parser.parseFromString(xml, "text/xml") as unknown as Document;
  if (!dom || !dom.documentElement) {
    throw new Error("KML inválido: documento XML vacío o irreparable.");
  }
  const fc = kmlToGeoJSON(dom);
  return { fc: fc as FeatureCollection, warnings };
}

async function parseKmz(buf: Buffer): Promise<{ fc: FeatureCollection; warnings: string[] }> {
  const warnings: string[] = [];
  const zip = await JSZip.loadAsync(buf);
  // Find the first .kml inside (typically "doc.kml").
  const kmlEntry = Object.values(zip.files).find(f => !f.dir && f.name.toLowerCase().endsWith(".kml"));
  if (!kmlEntry) throw new Error("KMZ inválido: no contiene ningún archivo .kml.");
  const kmlBuf = Buffer.from(await kmlEntry.async("uint8array"));
  const inner = parseKml(kmlBuf);
  inner.warnings.unshift(`KMZ: usando "${kmlEntry.name}" como documento principal.`);
  return { fc: inner.fc, warnings: [...warnings, ...inner.warnings] };
}

// ── GeoJSON ───────────────────────────────────────────────────────────────────

function parseGeoJson(buf: Buffer): { fc: FeatureCollection; warnings: string[] } {
  const warnings: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(buf.toString("utf8"));
  } catch (e) {
    throw new Error(`GeoJSON inválido: ${(e as Error).message}`);
  }
  // Normalize Feature, Geometry, FeatureCollection inputs.
  let fc: FeatureCollection;
  const obj = parsed as { type?: string; features?: Feature[]; geometry?: Geometry };
  if (obj?.type === "FeatureCollection") {
    fc = obj as FeatureCollection;
  } else if (obj?.type === "Feature") {
    fc = { type: "FeatureCollection", features: [obj as Feature] };
  } else if (obj?.type && ["Polygon", "MultiPolygon", "Point", "MultiPoint", "LineString", "MultiLineString"].includes(obj.type)) {
    fc = { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: obj as Geometry }] };
  } else {
    throw new Error("GeoJSON inválido: se esperaba FeatureCollection, Feature, o Geometry.");
  }
  // CRS check — RFC 7946 mandates WGS84/EPSG:4326. Warn if a non-WGS84 CRS is declared.
  const crs = (obj as { crs?: { properties?: { name?: string } } }).crs;
  if (crs?.properties?.name && !/(4326|CRS84|WGS[ _-]?84)/i.test(crs.properties.name)) {
    warnings.push(`GeoJSON declara CRS no estándar (${crs.properties.name}); se asume EPSG:4326 sin reproyectar.`);
  }
  return { fc, warnings };
}

// ── Shapefile (.zip) ──────────────────────────────────────────────────────────

async function parseShapefileZip(buf: Buffer): Promise<{ fc: FeatureCollection; warnings: string[] }> {
  const warnings: string[] = [];
  // Inspect the zip first so we can report .prj presence before delegating to shpjs.
  let hadPrj = false;
  let prjText: string | null = null;
  try {
    const zip = await JSZip.loadAsync(buf);
    const prjEntry = Object.values(zip.files).find(f => !f.dir && f.name.toLowerCase().endsWith(".prj"));
    if (prjEntry) {
      hadPrj = true;
      prjText = (await prjEntry.async("string")).trim();
    }
  } catch {
    // Not a zip? Maybe shpjs can still handle (single-file fetch URL etc.) — let it try.
  }
  if (!hadPrj) warnings.push("Shapefile sin .prj: se asume EPSG:4326 (WGS84).");
  // shpjs returns a single FeatureCollection or an array of them (one per layer).
  // It internally reprojects to WGS84 when a recognized .prj is present.
  // Convert Buffer to ArrayBuffer for shpjs.
  const arr = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  // Dynamic import so shpjs (which references browser global `self`) is only loaded
  // on demand — not at server startup — avoiding a ReferenceError in Node.js.
  const shp = await import("shpjs");
  let result: shpTypes.FeatureCollectionWithFilename | shpTypes.FeatureCollectionWithFilename[];
  try {
    result = await shp.default(arr);
  } catch (e) {
    throw new Error(`Shapefile inválido: ${(e as Error).message}`);
  }
  const collections = Array.isArray(result) ? result : [result];
  const features: Feature[] = [];
  for (const c of collections) {
    features.push(...((c as FeatureCollection).features ?? []));
  }
  if (features.length === 0) warnings.push("Shapefile sin features.");

  // If the .prj is non-WGS84 and shpjs did not reproject (heuristic: coords look projected),
  // fall back to proj4 reprojection.
  if (prjText && !/(WGS[ _-]?84|EPSG[: ]?4326|GCS_WGS_1984)/i.test(prjText)) {
    const looksProjected = features.some(f => coordsExceedLonLatRange(f.geometry as Geometry));
    if (looksProjected) {
      try {
        for (const f of features) {
          if (f.geometry) reprojectGeometryInPlace(f.geometry, prjText, "EPSG:4326");
        }
        warnings.push(`Shapefile reproyectado de "${prjText.slice(0, 60)}..." a EPSG:4326.`);
      } catch (e) {
        warnings.push(`No se pudo reproyectar el .prj declarado (${(e as Error).message}); se mantiene el sistema original.`);
      }
    }
  }
  return { fc: { type: "FeatureCollection", features }, warnings };
}

function coordsExceedLonLatRange(g: Geometry): boolean {
  const flat = flattenCoords(g);
  for (const c of flat) {
    if (Math.abs(c[0]) > 360 || Math.abs(c[1]) > 90) return true;
  }
  return false;
}

function flattenCoords(g: Geometry): Position[] {
  switch (g.type) {
    case "Point": return [g.coordinates];
    case "MultiPoint":
    case "LineString": return g.coordinates;
    case "MultiLineString":
    case "Polygon": return g.coordinates.flat();
    case "MultiPolygon": return g.coordinates.flat(2);
    case "GeometryCollection": return g.geometries.flatMap(flattenCoords);
  }
}

function reprojectGeometryInPlace(g: Geometry, fromProj: string, toProj: string): void {
  const fwd = (c: Position): Position => {
    const [x, y] = proj4(fromProj, toProj, [c[0], c[1]]);
    return c.length > 2 ? [x, y, c[2]] : [x, y];
  };
  const remapRing = (ring: Position[]): Position[] => ring.map(fwd);
  switch (g.type) {
    case "Point": g.coordinates = fwd(g.coordinates); break;
    case "MultiPoint":
    case "LineString": g.coordinates = (g.coordinates as Position[]).map(fwd); break;
    case "MultiLineString":
    case "Polygon": g.coordinates = (g.coordinates as Position[][]).map(remapRing); break;
    case "MultiPolygon": g.coordinates = (g.coordinates as Position[][][]).map(p => p.map(remapRing)); break;
    case "GeometryCollection": g.geometries.forEach(child => reprojectGeometryInPlace(child, fromProj, toProj)); break;
  }
}

// ── CSV ───────────────────────────────────────────────────────────────────────

function parseCsv(buf: Buffer, mapping?: CsvColumnMapping): { fc: FeatureCollection; warnings: string[]; csvDetection?: ParseResult["csvDetection"] } {
  const warnings: string[] = [];
  const text = buf.toString("utf8").replace(/^\uFEFF/, ""); // strip BOM
  // Detect delimiter by counting candidates in the first line.
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const candidates: Array<{ d: string; n: number }> = [
    { d: ",", n: (firstLine.match(/,/g) ?? []).length },
    { d: ";", n: (firstLine.match(/;/g) ?? []).length },
    { d: "\t", n: (firstLine.match(/\t/g) ?? []).length },
    { d: "|", n: (firstLine.match(/\|/g) ?? []).length },
  ];
  candidates.sort((a, b) => b.n - a.n);
  const delimiter = candidates[0].n > 0 ? candidates[0].d : ",";

  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    delimiter,
    skipEmptyLines: true,
    transformHeader: h => String(h ?? "").trim(),
  });
  if (parsed.errors.length > 0) {
    warnings.push(`CSV: ${parsed.errors.length} fila(s) con errores menores (se omitieron las inválidas).`);
  }
  const rows = parsed.data ?? [];
  const headers = parsed.meta.fields ?? [];
  if (headers.length === 0 || rows.length === 0) {
    throw new Error("CSV vacío o sin encabezados.");
  }

  // Decimal detection: if commas appear as decimal separator inside a column value
  // and the delimiter is not a comma, treat decimal as comma.
  const sampleVals = rows.slice(0, 10).flatMap(r => Object.values(r));
  const looksCommaDecimal = delimiter !== "," && sampleVals.some(v =>
    typeof v === "string" && /^-?\d+,\d+$/.test(v.trim()));
  const decimal: "." | "," = looksCommaDecimal ? "," : ".";

  // Suggest column mapping (used when no explicit mapping was passed).
  const suggested: CsvColumnMapping = {
    latColumn: pickColumn(headers, ["lat", "latitude", "latitud", "y"]),
    lonColumn: pickColumn(headers, ["lon", "lng", "longitude", "longitud", "x"]),
    valueColumn: pickColumn(headers, ["value", "valor", "z", "yield", "rendimiento", "ndvi", "n", "p", "k", "ph", "moo"]),
    labelColumn: pickColumn(headers, ["label", "etiqueta", "name", "nombre", "id"]),
  };
  const used: CsvColumnMapping = { ...suggested, ...(mapping ?? {}) };
  if (!used.latColumn || !used.lonColumn) {
    return {
      fc: { type: "FeatureCollection", features: [] },
      warnings: [...warnings, "CSV: no se detectaron columnas lat/lon — usa el mapeo manual antes de continuar."],
      csvDetection: { headers, delimiter, decimal, suggestedMapping: suggested },
    };
  }

  const features: Feature[] = [];
  let invalidRows = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const lat = parseNum(row[used.latColumn], decimal);
    const lon = parseNum(row[used.lonColumn], decimal);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      invalidRows++;
      continue;
    }
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      invalidRows++;
      continue;
    }
    const props: Record<string, unknown> = { ...row };
    if (used.valueColumn && row[used.valueColumn] != null) {
      const v = parseNum(row[used.valueColumn], decimal);
      if (Number.isFinite(v)) props.value = v;
    }
    if (used.labelColumn && row[used.labelColumn]) {
      props.label = row[used.labelColumn];
    }
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: props,
    });
  }
  if (invalidRows > 0) warnings.push(`CSV: ${invalidRows} fila(s) descartada(s) por coordenadas inválidas.`);
  return {
    fc: { type: "FeatureCollection", features },
    warnings,
    csvDetection: { headers, delimiter, decimal, suggestedMapping: suggested },
  };
}

function pickColumn(headers: string[], candidates: string[]): string | undefined {
  for (const cand of candidates) {
    const hit = headers.find(h => h.toLowerCase() === cand);
    if (hit) return hit;
  }
  // Substring fallback.
  for (const cand of candidates) {
    const hit = headers.find(h => h.toLowerCase().includes(cand));
    if (hit) return hit;
  }
  return undefined;
}

function parseNum(v: unknown, decimal: "." | ","): number {
  if (v == null) return NaN;
  let s = String(v).trim();
  if (!s) return NaN;
  if (decimal === ",") {
    // Remove thousand-separator dots, then convert decimal comma.
    s = s.replace(/\./g, "").replace(",", ".");
  }
  return Number(s);
}

// ── Coordinate sanity ────────────────────────────────────────────────────────

function hasFiniteCoordinates(g: Geometry): boolean {
  for (const c of flattenCoords(g)) {
    if (!Number.isFinite(c[0]) || !Number.isFinite(c[1])) return false;
  }
  return true;
}

/**
 * Returns true when geometry `g` intersects (or is contained by) the parcel polygon.
 *
 * Uses a two-stage check:
 *   1. Fast bounding-box pre-filter to skip geometries clearly outside the parcel.
 *   2. True polygon containment test via @turf/boolean-point-in-polygon for any
 *      coordinate of `g`, ensuring concave parcels do not over-report points
 *      that fall in the bbox but outside the actual ring.
 *
 * `parcelPolygon` is a closed ring of [lat, lon] pairs (the format used in
 * `parcels.polygonCoordinates`).
 */
export function geometryIntersectsParcel(g: Geometry, parcelLatLng: [number, number][]): boolean {
  if (parcelLatLng.length < 3) return true; // no parcel polygon → no check
  const ring: Position[] = parcelLatLng.map(([lat, lon]) => [lon, lat]);
  // Cierra el anillo si no está cerrado (turf lo exige).
  if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
    ring.push([ring[0][0], ring[0][1]]);
  }
  // Stage 1: bbox pre-filter (rápido, descarta el 99% de los casos lejanos).
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  let anyInBbox = false;
  for (const [lon, lat] of flattenCoords(g)) {
    if (lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat) { anyInBbox = true; break; }
  }
  if (!anyInBbox) return false;
  // Stage 2: intersección geométrica real (cubre también casos donde la geometría
  // cruza el borde de la parcela sin tener vértices interiores, como líneas que
  // atraviesan el contorno).
  const parcelPoly = turfPolygon([ring]);
  try {
    return booleanIntersects(turfFeature(g), parcelPoly);
  } catch {
    // Si booleanIntersects no soporta el tipo de geometría (ej. GeometryCollection),
    // caemos al check vertex-by-vertex como respaldo.
    for (const [lon, lat] of flattenCoords(g)) {
      if (booleanPointInPolygon(turfPoint([lon, lat]), parcelPoly)) return true;
    }
    return false;
  }
}

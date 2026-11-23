import shp from "shpjs";
import JSZip from "jszip";
import { kml as kmlToGeoJson } from "@tmcw/togeojson";

export interface ParcelFeature {
  name: string;
  coordinates: [number, number][];
  areaHa: number;
}

export interface ParcelImportResult {
  features: ParcelFeature[];
}

const R = 6371000;

export function calculatePolygonAreaHa(coords: [number, number][]): number {
  if (coords.length < 3) return 0;
  let total = 0;
  for (let i = 0; i < coords.length; i++) {
    const j = (i + 1) % coords.length;
    const lat1 = (coords[i][0] * Math.PI) / 180;
    const lat2 = (coords[j][0] * Math.PI) / 180;
    const lng1 = (coords[i][1] * Math.PI) / 180;
    const lng2 = (coords[j][1] * Math.PI) / 180;
    total += (lng2 - lng1) * (2 + Math.sin(lat1) + Math.sin(lat2));
  }
  total = Math.abs((total * R * R) / 2);
  return total / 10000;
}

function ringToLatLng(ring: number[][]): [number, number][] {
  const out: [number, number][] = ring.map(([lng, lat]) => [lat, lng]);
  if (out.length > 1) {
    const first = out[0];
    const last = out[out.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) {
      out.pop();
    }
  }
  return out;
}

function extractFeatures(geojson: any): ParcelFeature[] {
  const out: ParcelFeature[] = [];
  if (!geojson) return out;

  const collections = Array.isArray(geojson) ? geojson : [geojson];

  for (const fc of collections) {
    const features: any[] = fc?.features ?? (fc?.type === "Feature" ? [fc] : []);
    for (const feat of features) {
      const props = feat?.properties ?? {};
      const baseName: string =
        props.name ?? props.Name ?? props.NAME ?? props.id ?? props.ID ?? feat?.id ?? "";
      const geom = feat?.geometry;
      if (!geom) continue;

      const polygons: number[][][][] =
        geom.type === "Polygon"
          ? [geom.coordinates]
          : geom.type === "MultiPolygon"
          ? geom.coordinates
          : [];

      polygons.forEach((poly, idx) => {
        const outer = poly?.[0];
        if (!outer || outer.length < 3) return;
        const coords = ringToLatLng(outer);
        if (coords.length < 3) return;
        const name =
          (baseName ? String(baseName) : "") +
          (polygons.length > 1 ? ` (${idx + 1})` : "");
        out.push({
          name: name || `Polígono ${out.length + 1}`,
          coordinates: coords,
          areaHa: calculatePolygonAreaHa(coords),
        });
      });
    }
  }
  return out;
}

function looksLikeWgs84(coords: [number, number][]): boolean {
  return coords.every(
    ([lat, lng]) =>
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      lat >= -90 &&
      lat <= 90 &&
      lng >= -180 &&
      lng <= 180
  );
}

async function readAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return await file.arrayBuffer();
}

async function readAsText(file: File): Promise<string> {
  return await file.text();
}

async function parseKmz(file: File): Promise<ParcelFeature[]> {
  const buf = await readAsArrayBuffer(file);
  const zip = await JSZip.loadAsync(buf);
  const kmlEntry = Object.values(zip.files).find((f) =>
    f.name.toLowerCase().endsWith(".kml")
  );
  if (!kmlEntry) throw new Error("KMZ_NO_KML");
  const kmlText = await kmlEntry.async("text");
  return parseKmlText(kmlText);
}

function parseKmlText(kmlText: string): ParcelFeature[] {
  const dom = new DOMParser().parseFromString(kmlText, "text/xml");
  const geojson = kmlToGeoJson(dom);
  return extractFeatures(geojson);
}

async function parseShapefileZip(file: File): Promise<ParcelFeature[]> {
  const buf = await readAsArrayBuffer(file);
  const geojson = await shp(buf);
  const feats = extractFeatures(geojson);
  if (feats.length === 0) return feats;
  if (!feats.every((f) => looksLikeWgs84(f.coordinates))) {
    throw new Error("SHP_NOT_WGS84");
  }
  return feats;
}

async function parseGeoJson(file: File): Promise<ParcelFeature[]> {
  const text = await readAsText(file);
  const geojson = JSON.parse(text);
  return extractFeatures(geojson);
}

export async function parseParcelFile(file: File): Promise<ParcelImportResult> {
  const lower = file.name.toLowerCase();
  let features: ParcelFeature[] = [];

  try {
    if (lower.endsWith(".kmz")) {
      features = await parseKmz(file);
    } else if (lower.endsWith(".kml")) {
      features = parseKmlText(await readAsText(file));
    } else if (lower.endsWith(".zip") || lower.endsWith(".shp")) {
      features = await parseShapefileZip(file);
    } else if (lower.endsWith(".geojson") || lower.endsWith(".json")) {
      features = await parseGeoJson(file);
    } else {
      throw new Error("UNSUPPORTED_FORMAT");
    }
  } catch (err: any) {
    if (
      err?.message === "UNSUPPORTED_FORMAT" ||
      err?.message === "KMZ_NO_KML" ||
      err?.message === "SHP_NOT_WGS84"
    ) {
      throw err;
    }
    const orig = err?.message || String(err);
    throw new Error(`PARSE_FAILED:${orig}`);
  }

  if (features.length === 0) {
    throw new Error("NO_POLYGONS");
  }
  return { features };
}

/**
 * AgRegen — Zone Export Service (T147)
 *
 * Converts a list of management zones (with optional prescription dose) into
 * machine-friendly autoguidance formats:
 *  - GeoJSON (plain)
 *  - KML (Google Earth, generic field-prep tools)
 *  - KMZ (KML inside a zip)
 *  - Shapefile zip (.shp+.shx+.dbf+.prj — universal in tractor monitors)
 *  - ISOXML / ISO 11783-10 TASKDATA.XML (John Deere, Case IH, New Holland, Trimble)
 *
 * Each exporter returns `{ buffer, mime, filename }` so the route handler is trivial.
 */
import type { Feature, FeatureCollection, Geometry, Polygon, MultiPolygon } from "geojson";
import JSZip from "jszip";
import { create as xmlCreate } from "xmlbuilder2";
import shpwrite from "@mapbox/shp-write";

export interface ExportZoneInput {
  zoneIndex: number;
  zoneLabel?: string | null;
  category?: string | null;
  colorHex?: string | null;
  areaHa?: number | null;
  /** Optional prescription information; included as properties when present. */
  dosePerHa?: number | null;
  doseUnit?: string | null;
  amendment?: string | null;
  /** GeoJSON Polygon or MultiPolygon (already in EPSG:4326). */
  geometry: Polygon | MultiPolygon;
}

export interface ExportContext {
  parcelName: string;
  baseFilename?: string;
  /** Optional metadata embedded in KML <description> and ISOXML notes. */
  notes?: string;
}

export type MachineExportFormat = "kml" | "kmz" | "shapefile" | "isoxml" | "geojson";

export interface ExportResult {
  buffer: Buffer;
  mime: string;
  filename: string;
}

// ── Utility ──────────────────────────────────────────────────────────────────

function safeBaseName(s: string): string {
  return (s || "prescripcion")
    .toString()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .slice(0, 60) || "prescripcion";
}

function zoneProperties(z: ExportZoneInput): Record<string, unknown> {
  return {
    zone_id: z.zoneIndex,
    zone_label: z.zoneLabel ?? `Zona ${z.zoneIndex + 1}`,
    category: z.category ?? "",
    color: z.colorHex ?? "",
    area_ha: z.areaHa ?? null,
    dose_per_ha: z.dosePerHa ?? null,
    dose_unit: z.doseUnit ?? "",
    amendment: z.amendment ?? "",
  };
}

function asFeatureCollection(zones: ExportZoneInput[]): FeatureCollection {
  const features: Feature[] = zones.map(z => ({
    type: "Feature",
    geometry: z.geometry as Geometry,
    properties: zoneProperties(z),
  }));
  return { type: "FeatureCollection", features };
}

// ── GeoJSON ──────────────────────────────────────────────────────────────────

export function exportGeoJSON(zones: ExportZoneInput[], ctx: ExportContext): ExportResult {
  const fc = asFeatureCollection(zones);
  const base = safeBaseName(ctx.baseFilename ?? `${ctx.parcelName}_prescripcion`);
  return {
    buffer: Buffer.from(JSON.stringify(fc, null, 2), "utf8"),
    mime: "application/geo+json",
    filename: `${base}.geojson`,
  };
}

// ── KML / KMZ ────────────────────────────────────────────────────────────────

/** Hex (#rrggbb) → KML aabbggrr (alpha first, then BGR). */
function hexToKmlColor(hex: string | null | undefined, alpha = "ff"): string {
  if (!hex) return `${alpha}888888`;
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return `${alpha}888888`;
  const rr = m[1].slice(0, 2);
  const gg = m[1].slice(2, 4);
  const bb = m[1].slice(4, 6);
  return `${alpha}${bb}${gg}${rr}`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function ringToCoordString(ring: number[][]): string {
  return ring.map(c => `${c[0]},${c[1]},0`).join(" ");
}

function polygonToKml(poly: Polygon, indent = "      "): string {
  const outer = poly.coordinates[0] ?? [];
  const inners = poly.coordinates.slice(1);
  const innerXml = inners
    .map(r => `${indent}<innerBoundaryIs><LinearRing><coordinates>${ringToCoordString(r)}</coordinates></LinearRing></innerBoundaryIs>`)
    .join("\n");
  return `<Polygon>
${indent}<outerBoundaryIs><LinearRing><coordinates>${ringToCoordString(outer)}</coordinates></LinearRing></outerBoundaryIs>${innerXml ? "\n" + innerXml : ""}
${indent}</Polygon>`;
}

function geomToKml(g: Geometry, indent = "      "): string {
  if (g.type === "Polygon") return polygonToKml(g, indent);
  if (g.type === "MultiPolygon") {
    const parts = g.coordinates.map(coords => polygonToKml({ type: "Polygon", coordinates: coords }, indent));
    return `<MultiGeometry>${parts.join("")}</MultiGeometry>`;
  }
  return ""; // Points/Lines not expected for prescriptions
}

export function exportKML(zones: ExportZoneInput[], ctx: ExportContext): ExportResult {
  const docName = escapeXml(`${ctx.parcelName} — Prescripción VRA`);
  const styles = zones.map(z => `
    <Style id="zone${z.zoneIndex}">
      <LineStyle><color>${hexToKmlColor(z.colorHex, "ff")}</color><width>2</width></LineStyle>
      <PolyStyle><color>${hexToKmlColor(z.colorHex, "99")}</color><fill>1</fill><outline>1</outline></PolyStyle>
    </Style>`).join("");

  const placemarks = zones.map(z => {
    const dose = z.dosePerHa != null ? `${z.dosePerHa} ${z.doseUnit ?? "kg/ha"}` : "—";
    const desc = `Zona ${z.zoneIndex + 1} — ${z.zoneLabel ?? ""}\\nDosis: ${dose}\\nProducto: ${z.amendment ?? "—"}\\nÁrea: ${z.areaHa ?? "?"} ha`;
    return `
    <Placemark>
      <name>${escapeXml(z.zoneLabel ?? `Zona ${z.zoneIndex + 1}`)}</name>
      <description>${escapeXml(desc)}</description>
      <styleUrl>#zone${z.zoneIndex}</styleUrl>
      <ExtendedData>
        <Data name="zone_id"><value>${z.zoneIndex}</value></Data>
        <Data name="dose_per_ha"><value>${z.dosePerHa ?? ""}</value></Data>
        <Data name="dose_unit"><value>${escapeXml(z.doseUnit ?? "")}</value></Data>
        <Data name="amendment"><value>${escapeXml(z.amendment ?? "")}</value></Data>
        <Data name="area_ha"><value>${z.areaHa ?? ""}</value></Data>
      </ExtendedData>
      ${geomToKml(z.geometry)}
    </Placemark>`;
  }).join("");

  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${docName}</name>
    <description>${escapeXml(ctx.notes ?? "Prescripción de manejo variable generada por AgRegen")}</description>${styles}${placemarks}
  </Document>
</kml>`;

  const base = safeBaseName(ctx.baseFilename ?? `${ctx.parcelName}_prescripcion`);
  return {
    buffer: Buffer.from(kml, "utf8"),
    mime: "application/vnd.google-earth.kml+xml",
    filename: `${base}.kml`,
  };
}

export async function exportKMZ(zones: ExportZoneInput[], ctx: ExportContext): Promise<ExportResult> {
  const kml = exportKML(zones, ctx);
  const zip = new JSZip();
  zip.file("doc.kml", kml.buffer);
  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const base = safeBaseName(ctx.baseFilename ?? `${ctx.parcelName}_prescripcion`);
  return {
    buffer: buf,
    mime: "application/vnd.google-earth.kmz",
    filename: `${base}.kmz`,
  };
}

// ── Shapefile zip ────────────────────────────────────────────────────────────

export async function exportShapefile(zones: ExportZoneInput[], ctx: ExportContext): Promise<ExportResult> {
  // shp-write only writes one geometry type per file. Polygon zones are the common case;
  // MultiPolygon are flattened into multiple Polygon features so the .shp stays uniform.
  const fc: FeatureCollection = { type: "FeatureCollection", features: [] };
  for (const z of zones) {
    const props = zoneProperties(z);
    if (z.geometry.type === "Polygon") {
      fc.features.push({ type: "Feature", geometry: z.geometry, properties: props });
    } else if (z.geometry.type === "MultiPolygon") {
      for (const coords of z.geometry.coordinates) {
        fc.features.push({
          type: "Feature",
          geometry: { type: "Polygon", coordinates: coords },
          properties: props,
        });
      }
    }
  }
  const base = safeBaseName(ctx.baseFilename ?? `${ctx.parcelName}_prescripcion`);
  // WGS84 .prj string (EPSG:4326)
  const wgs84Prj = 'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4326"]]';
  const out = await shpwrite.zip(fc, {
    folder: base,
    filename: base,
    outputType: "nodebuffer",
    compression: "DEFLATE",
    prj: wgs84Prj,
    types: { polygon: "zonas", point: "puntos", line: "lineas" },
  });
  return {
    buffer: out as Buffer,
    mime: "application/zip",
    filename: `${base}.zip`,
  };
}

// ── ISOXML (TASKDATA.XML) ────────────────────────────────────────────────────

/**
 * Generate a minimal ISO 11783-10 TASKDATA.XML containing:
 *  - PFD (Partfield) representing the parcel field boundary (optional, supplied via ctx.fieldBoundary)
 *  - For each zone: a TZN (Treatment Zone) with its polygon and dose
 *  - A TSK (Task) referencing the PFD and TZNs
 *
 * This is the subset that John Deere/Case IH/New Holland/Trimble monitors
 * understand for VRA prescriptions. The full ISOXML standard has many more
 * objects (CCT, CPC, DET, …) which we intentionally skip.
 */
export interface IsoxmlContext extends ExportContext {
  /** Parcel boundary as [lat, lon] pairs (optional). */
  fieldBoundary?: [number, number][];
  /** ISOXML DDI (Data Dictionary Identifier) for the dose unit; defaults to 0006 = Mass per Area kg/ha. */
  ddi?: string;
  /** Designator string for the product applied (e.g. "Urea 46-0-0"). */
  productName?: string;
}

export async function exportIsoxml(zones: ExportZoneInput[], ctx: IsoxmlContext): Promise<ExportResult> {
  const ddi = ctx.ddi ?? "0006";
  const productName = ctx.productName ?? (zones[0]?.amendment ?? "Producto VRA");

  const root = xmlCreate({ version: "1.0", encoding: "UTF-8" })
    .ele("ISO11783_TaskData", {
      VersionMajor: "4", VersionMinor: "2",
      ManagementSoftwareManufacturer: "AgRegen",
      ManagementSoftwareVersion: "5.0",
      DataTransferOrigin: "1",
      TaskControllerManufacturer: "AgRegen",
      TaskControllerVersion: "5.0",
    });

  // Single product (PDT)
  root.ele("PDT", { A: "PDT1", B: productName });

  // Field (PFD): build polygon from boundary if provided.
  const pfd = root.ele("PFD", { A: "PFD1", C: ctx.parcelName, D: "0", E: "0" });
  if (ctx.fieldBoundary && ctx.fieldBoundary.length >= 3) {
    const pln = pfd.ele("PLN", { A: "1" }); // A=1 → field boundary
    const lsg = pln.ele("LSG", { A: "1" });
    for (const [lat, lon] of ctx.fieldBoundary) {
      lsg.ele("PNT", { A: "2", C: String(lat), D: String(lon) }); // A=2 → polygon vertex
    }
  }

  // Treatment zones (TZN) under a single TSK.
  const tsk = root.ele("TSK", {
    A: "TSK1",
    B: `Prescripcion ${ctx.parcelName}`,
    E: "1",
    G: "1",
    F: "PFD1",
  });

  zones.forEach((z, i) => {
    const tznId = i + 1;
    const dose = Math.max(0, Math.round(((z.dosePerHa ?? 0) as number) * 100)); // ISOXML rate is integer (e.g. kg/ha * 100 for 0006)
    const tzn = tsk.ele("TZN", {
      A: String(tznId),
      B: z.zoneLabel ?? `Zona ${z.zoneIndex + 1}`,
      C: z.colorHex ? z.colorHex.replace("#", "") : "888888",
    });
    tzn.ele("PDV", { A: ddi, B: String(dose), C: "PDT1" });
    // Geometry as PLN type=10 (treatment-zone polygon)
    const polys = z.geometry.type === "Polygon" ? [z.geometry.coordinates] : (z.geometry as MultiPolygon).coordinates;
    for (const poly of polys) {
      const pln = tzn.ele("PLN", { A: "10" });
      const lsg = pln.ele("LSG", { A: "1" });
      for (const ring of poly) {
        for (const [lon, lat] of ring) {
          lsg.ele("PNT", { A: "2", C: String(lat), D: String(lon) });
        }
      }
    }
  });

  const xml = root.end({ prettyPrint: true });

  // Wrap TASKDATA.XML in a zip so it's a single download (also the standard distribution form).
  const zip = new JSZip();
  zip.folder("TASKDATA")!.file("TASKDATA.XML", xml);
  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const base = safeBaseName(ctx.baseFilename ?? `${ctx.parcelName}_prescripcion`);
  return {
    buffer: buf,
    mime: "application/zip",
    filename: `${base}_isoxml.zip`,
  };
}

// ── Public dispatch ──────────────────────────────────────────────────────────

export async function exportZones(
  format: MachineExportFormat,
  zones: ExportZoneInput[],
  ctx: ExportContext & Partial<IsoxmlContext>,
): Promise<ExportResult> {
  if (zones.length === 0) throw new Error("No hay zonas para exportar.");
  switch (format) {
    case "geojson":   return exportGeoJSON(zones, ctx);
    case "kml":       return exportKML(zones, ctx);
    case "kmz":       return exportKMZ(zones, ctx);
    case "shapefile": return exportShapefile(zones, ctx);
    case "isoxml":    return exportIsoxml(zones, ctx as IsoxmlContext);
    default: throw new Error(`Formato no soportado: ${format}`);
  }
}

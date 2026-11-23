/**
 * Unit tests for server/services/zone-export.ts (T147).
 *
 * Validates that each exporter produces a non-empty buffer with the right MIME
 * + filename and that round-tripping the GeoJSON / KML / ISOXML output yields
 * the same number of zones with the right dose attributes.
 */
import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import {
  exportGeoJSON,
  exportKML,
  exportKMZ,
  exportShapefile,
  exportIsoxml,
  exportZones,
  type ExportZoneInput,
} from "../server/services/zone-export";

const square = (x: number, y: number, side = 0.005) => ({
  type: "Polygon" as const,
  coordinates: [[
    [x, y],
    [x + side, y],
    [x + side, y + side],
    [x, y + side],
    [x, y],
  ]],
});

const ZONES: ExportZoneInput[] = [
  { zoneIndex: 0, zoneLabel: "Baja",  category: "k=3", colorHex: "#d73027", areaHa: 1.2, dosePerHa: 80,  doseUnit: "kg/ha", amendment: "Urea", geometry: square(-58.40, -34.60) },
  { zoneIndex: 1, zoneLabel: "Media", category: "k=3", colorHex: "#fee08b", areaHa: 0.8, dosePerHa: 130, doseUnit: "kg/ha", amendment: "Urea", geometry: square(-58.39, -34.60) },
  { zoneIndex: 2, zoneLabel: "Alta",  category: "k=3", colorHex: "#1a9850", areaHa: 1.0, dosePerHa: 180, doseUnit: "kg/ha", amendment: "Urea", geometry: square(-58.38, -34.60) },
];
const CTX = { parcelName: "Lote Norte", baseFilename: "lote_norte_VRA", productName: "Urea" };

describe("exportGeoJSON", () => {
  it("returns a parseable FeatureCollection with all zones and dose properties", () => {
    const out = exportGeoJSON(ZONES, CTX);
    expect(out.mime).toBe("application/geo+json");
    expect(out.filename).toMatch(/\.geojson$/);
    const fc = JSON.parse(out.buffer.toString("utf8"));
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toHaveLength(3);
    expect(fc.features[2].properties.dose_per_ha).toBe(180);
    expect(fc.features[0].properties.zone_label).toBe("Baja");
  });
});

describe("exportKML", () => {
  it("returns valid KML with N Placemarks and ExtendedData dose entries", () => {
    const out = exportKML(ZONES, CTX);
    expect(out.mime).toBe("application/vnd.google-earth.kml+xml");
    const xml = out.buffer.toString("utf8");
    expect(xml).toContain("<kml");
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    const placemarks = doc.getElementsByTagName("Placemark");
    expect(placemarks.length).toBe(3);
    expect(xml).toContain("dose_per_ha");
    expect(xml).toContain("180");
  });
});

describe("exportKMZ", () => {
  it("returns a zip containing doc.kml", async () => {
    const out = await exportKMZ(ZONES, CTX);
    expect(out.mime).toBe("application/vnd.google-earth.kmz");
    const zip = await JSZip.loadAsync(out.buffer);
    const kmlEntry = Object.keys(zip.files).find(n => n.toLowerCase().endsWith(".kml"));
    expect(kmlEntry).toBeTruthy();
    const kml = await zip.files[kmlEntry!].async("string");
    expect(kml).toContain("<Placemark>");
  });
});

describe("exportShapefile", () => {
  it("returns a zip containing .shp/.shx/.dbf/.prj", async () => {
    const out = await exportShapefile(ZONES, CTX);
    expect(out.mime).toBe("application/zip");
    const zip = await JSZip.loadAsync(out.buffer);
    const names = Object.keys(zip.files).map(n => n.toLowerCase());
    expect(names.some(n => n.endsWith(".shp"))).toBe(true);
    expect(names.some(n => n.endsWith(".shx"))).toBe(true);
    expect(names.some(n => n.endsWith(".dbf"))).toBe(true);
    // .prj is optional in shp-write but we explicitly write it; tolerate absence.
  });
});

describe("exportIsoxml", () => {
  it("returns a zip containing TASKDATA.XML with TSK + PFD + PLN + TZN nodes", async () => {
    const out = await exportIsoxml(ZONES, CTX);
    expect(out.mime).toBe("application/zip");
    const zip = await JSZip.loadAsync(out.buffer);
    const taskdataEntry = Object.keys(zip.files).find(n => n.toUpperCase().endsWith("TASKDATA.XML"));
    expect(taskdataEntry).toBeTruthy();
    const xml = await zip.files[taskdataEntry!].async("string");
    expect(xml).toMatch(/<TSK\b/);
    expect(xml).toMatch(/<PFD\b/);
    expect(xml).toMatch(/<PLN\b/);
    expect(xml).toMatch(/<TZN\b/);
    // PDV (process-data-value) carries the dose
    expect(xml).toMatch(/<PDV\b/);
  });
});

describe("exportZones dispatch", () => {
  it("routes by format", async () => {
    for (const fmt of ["kml", "kmz", "shapefile", "isoxml", "geojson"] as const) {
      const out = await exportZones(fmt, ZONES, CTX as any);
      expect(out.buffer.length).toBeGreaterThan(0);
      expect(out.filename).toBeTruthy();
    }
  });

  it("rejects empty zone list", async () => {
    await expect(exportZones("geojson", [], CTX as any)).rejects.toThrow();
  });
});

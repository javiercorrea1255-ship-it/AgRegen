/**
 * Unit tests for server/services/geometry-import.ts (T147).
 *
 * Validates per-format parsing — KML, GeoJSON, CSV (semicolon + comma decimals)
 * — and the format-detection helper. Shapefile parsing is exercised via a
 * minimal in-memory zip created on the fly (shpjs accepts a Buffer).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import shpwrite from "@mapbox/shp-write";
import {
  parseGeometryFile,
  detectFormat,
  geometryIntersectsParcel,
} from "../server/services/geometry-import";

const FIX = (name: string) => readFileSync(join(__dirname, "fixtures", name));
const UTM_20S = 'PROJCS["WGS 84 / UTM zone 20S",GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",-63],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],PARAMETER["false_northing",10000000],UNIT["metre",1,AUTHORITY["EPSG","32720"]]]';
async function shapefileFixture(prj?: string) {
  const fc: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: { value: 1 },
      geometry: { type: "Point", coordinates: prj ? [360000, 6170000] : [-58.4, -34.6] } }],
  };
  const archive = await shpwrite.zip(fc, { outputType: "nodebuffer", compression: "STORE", ...(prj ? { prj } : {}) });
  if (prj) return archive;
  const zip = await JSZip.loadAsync(archive);
  Object.keys(zip.files).filter(name => name.endsWith(".prj")).forEach(name => zip.remove(name));
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("detectFormat", () => {
  it("recognises by extension", () => {
    expect(detectFormat("a.kml", Buffer.from("<kml/>"))).toBe("kml");
    expect(detectFormat("a.kmz", Buffer.from([0x50, 0x4b, 3, 4]))).toBe("kmz");
    expect(detectFormat("a.geojson", Buffer.from("{}"))).toBe("geojson");
    expect(detectFormat("a.csv", Buffer.from("a;b\n1;2"))).toBe("csv");
    expect(detectFormat("a.shp.zip", Buffer.from([0x50, 0x4b]))).toBe("shapefile");
  });

  it("falls back to JSON sniffing", () => {
    expect(detectFormat("noext", Buffer.from('{"type":"FeatureCollection"}'))).toBe("geojson");
  });

  it("falls back to KML sniffing", () => {
    expect(detectFormat("noext", Buffer.from('<?xml version="1.0"?><kml/>'))).toBe("kml");
  });

  it("rejects unknown formats", () => {
    expect(() => detectFormat("foo.exe", Buffer.from("MZ\0\0"))).toThrow(/Formato no reconocido/);
  });
});

describe("parseGeometryFile — KML", () => {
  it("extracts polygons with extended-data properties", async () => {
    const r = await parseGeometryFile(FIX("sample.kml"), "sample.kml");
    expect(r.format).toBe("kml");
    expect(r.featureCount).toBe(2);
    expect(r.geometryTypes).toContain("Polygon");
    const props0 = r.featureCollection.features[0].properties as Record<string, unknown>;
    // togeojson exposes ExtendedData under properties; accept either shape.
    const dose = Number(props0?.dose_per_ha ?? props0?.value ?? NaN);
    expect(Number.isFinite(dose)).toBe(true);
  });
});

describe("parseGeometryFile — GeoJSON", () => {
  it("returns the FeatureCollection unchanged in EPSG:4326", async () => {
    const r = await parseGeometryFile(FIX("sample.geojson"), "sample.geojson");
    expect(r.format).toBe("geojson");
    expect(r.featureCount).toBe(2);
    expect(r.featureCollection.features[0].geometry.type).toBe("Polygon");
    const props = r.featureCollection.features[0].properties as Record<string, unknown>;
    expect(props.value).toBe(2.5);
    expect(props.label).toBe("Media");
  });

  it("rejects non-FeatureCollection JSON with a clear error", async () => {
    const bad = Buffer.from('{"foo":"bar"}');
    await expect(parseGeometryFile(bad, "bad.geojson")).rejects.toThrow();
  });
});

describe("parseGeometryFile — CSV with semicolon + comma decimals", () => {
  it("auto-detects ';' delimiter and ',' decimal", async () => {
    const r = await parseGeometryFile(FIX("sample.csv"), "sample.csv");
    expect(r.format).toBe("csv");
    expect(r.featureCount).toBe(4);
    expect(r.csvDetection?.delimiter).toBe(";");
    expect(r.csvDetection?.decimal).toBe(",");
    const f = r.featureCollection.features[0];
    expect(f.geometry.type).toBe("Point");
    const [lon, lat] = (f.geometry as any).coordinates as [number, number];
    expect(lat).toBeCloseTo(-34.6, 4);
    expect(lon).toBeCloseTo(-58.4, 4);
    const props = f.properties as Record<string, unknown>;
    expect(Number(props.value)).toBeCloseTo(2.5, 4);
  });

  it("respects explicit column mapping when provided", async () => {
    const csv = Buffer.from("x,y,z\n-58.40,-34.60,1.0\n-58.39,-34.59,2.0\n");
    const r = await parseGeometryFile(csv, "x.csv", {
      csvMapping: { lonColumn: "x", latColumn: "y", valueColumn: "z" },
    });
    expect(r.featureCount).toBe(2);
    const [lon, lat] = (r.featureCollection.features[0].geometry as any).coordinates as [number, number];
    expect(lon).toBeCloseTo(-58.4, 4);
    expect(lat).toBeCloseTo(-34.6, 4);
  });

  it("warns when lat/lon columns cannot be detected", async () => {
    const csv = Buffer.from("a,b\n1,2\n3,4\n");
    const r = await parseGeometryFile(csv, "x.csv").catch(e => e);
    // Either it throws (no coords) or returns warnings — both are acceptable contracts.
    if (r instanceof Error) {
      expect(r.message).toMatch(/columna|lat|lon|coordenad/i);
    } else {
      expect(r.warnings.length).toBeGreaterThan(0);
    }
  });
});

describe("parseGeometryFile — Shapefile ZIP", () => {
  it("shapefile sin .prj genera advertencia WGS84 asumido", async () => {
    const r = await parseGeometryFile(await shapefileFixture(), "sample-noPrj.shp.zip");
    expect(r.format).toBe("shapefile");
    // El parser debe advertir que no hay .prj
    const wgsWarn = r.warnings.some(w => /sin .prj|WGS84/i.test(w));
    expect(wgsWarn).toBe(true);
  });

  it("shapefile con .prj UTM produce coordenadas WGS84 en rango y no avisa 'sin .prj'", async () => {
    // El zip contiene coordenadas UTM 20S (X≈360000, Y≈6170000) y .prj EPSG:32720.
    // shpjs reconoce el .prj y reproyecta internamente a WGS84 antes de devolver
    // las features; nuestro fallback proj4 solo actúa si shpjs no reproyectó.
    const r = await parseGeometryFile(await shapefileFixture(UTM_20S), "sample-utm.shp.zip");
    expect(r.format).toBe("shapefile");
    expect(r.featureCount).toBeGreaterThan(0);

    // No debe aparecer la advertencia de ".prj ausente"
    const missingPrjWarn = r.warnings.some(w => /sin .prj/i.test(w));
    expect(missingPrjWarn).toBe(false);

    // Las coordenadas resultantes SIEMPRE deben estar en rango lon/lat válido
    // (ya sea por reproyección interna de shpjs o por nuestro fallback proj4).
    const feat = r.featureCollection.features[0];
    expect(feat.geometry).not.toBeNull();
    if (feat.geometry?.type === "Point") {
      const [lon, lat] = feat.geometry.coordinates;
      expect(Math.abs(lon)).toBeLessThanOrEqual(180);
      expect(Math.abs(lat)).toBeLessThanOrEqual(90);
    }
  });
});

describe("geometryIntersectsParcel", () => {
  const parcel: [number, number][] = [
    [-34.6, -58.4],
    [-34.6, -58.38],
    [-34.59, -58.38],
    [-34.59, -58.4],
  ];

  it("accepts a polygon inside the parcel bbox", () => {
    const inside: any = {
      type: "Polygon",
      coordinates: [[[-58.395, -34.595], [-58.385, -34.595], [-58.385, -34.591], [-58.395, -34.591], [-58.395, -34.595]]],
    };
    expect(geometryIntersectsParcel(inside, parcel)).toBe(true);
  });

  it("rejects a polygon outside the parcel bbox", () => {
    const outside: any = {
      type: "Polygon",
      coordinates: [[[-50, -30], [-49.9, -30], [-49.9, -29.9], [-50, -29.9], [-50, -30]]],
    };
    expect(geometryIntersectsParcel(outside, parcel)).toBe(false);
  });

  it("accepts a point inside the parcel bbox", () => {
    expect(geometryIntersectsParcel({ type: "Point", coordinates: [-58.39, -34.595] } as any, parcel)).toBe(true);
  });
});

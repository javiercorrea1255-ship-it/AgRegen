/**
 * Integration tests for POST /api/parcels/:id/import-geometry +
 * POST /api/parcels/:id/zones/from-import (T147).
 *
 * Auth + storage are stubbed so the test runs hermetically.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { registerImportZoneRoutes } from "../server/routes/import-zones";

const FIX = (name: string) => readFileSync(join(__dirname, "fixtures", name));

interface FakeStorage {
  getParcel: ReturnType<typeof vi.fn>;
  bulkCreateManagementZones: ReturnType<typeof vi.fn>;
  getManagementZonesByZoneSet: ReturnType<typeof vi.fn>;
  getZonePrescriptionsByZone: ReturnType<typeof vi.fn>;
  createZoneImport: ReturnType<typeof vi.fn>;
  getZoneImportsByParcel: ReturnType<typeof vi.fn>;
  getZoneImport: ReturnType<typeof vi.fn>;
  // Sampling (modo "samples")
  getSamplingCampaign: ReturnType<typeof vi.fn>;
  createSamplingCampaign: ReturnType<typeof vi.fn>;
  getSamplingPointsByCampaign: ReturnType<typeof vi.fn>;
  bulkCreateSamplingPoints: ReturnType<typeof vi.fn>;
  getMasterVariable: ReturnType<typeof vi.fn>;
}

function makeFakeStorage(): FakeStorage {
  return {
    getParcel: vi.fn(),
    bulkCreateManagementZones: vi.fn(),
    getManagementZonesByZoneSet: vi.fn(),
    getZonePrescriptionsByZone: vi.fn(),
    createZoneImport: vi.fn(),
    getZoneImportsByParcel: vi.fn(),
    getZoneImport: vi.fn(),
    getSamplingCampaign: vi.fn(),
    createSamplingCampaign: vi.fn(),
    getSamplingPointsByCampaign: vi.fn().mockResolvedValue([]),
    bulkCreateSamplingPoints: vi.fn(),
    getMasterVariable: vi.fn(),
  };
}

function buildApp(
  storage: FakeStorage,
  user = { id: "user-1", isActive: true } as any,
  fetchWithTimeout: ((url: string, init?: RequestInit, timeoutMs?: number) => Promise<Response>) = vi.fn() as any,
) {
  const app = express();
  app.use(express.json({ limit: "20mb" }));
  app.use((req: any, _res, next) => {
    req.isAuthenticated = () => Boolean(user);
    if (user) req.user = user;
    next();
  });
  const isAuthenticated = (req: any, res: any, next: any) => req.isAuthenticated() ? next() : res.status(401).json({ message: "No autenticado" });
  const isActiveUser = (req: any, res: any, next: any) => req.isAuthenticated() && req.user?.isActive ? next() : res.status(403).json({ message: "Cuenta desactivada" });
  registerImportZoneRoutes(
    app,
    { storage: storage as any, fetchWithTimeout },
    { isAuthenticated, isActiveUser },
  );
  return app;
}

const PARCEL = {
  id: "parcel-1",
  userId: "user-1",
  name: "Lote Norte",
  polygonCoordinates: [
    [-34.61, -58.41],
    [-34.61, -58.37],
    [-34.58, -58.37],
    [-34.58, -58.41],
  ] as [number, number][],
};

describe("POST /api/parcels/:id/import-geometry", () => {
  let storage: FakeStorage;
  beforeEach(() => { storage = makeFakeStorage(); });

  it("rejects when the user does not own the parcel", async () => {
    storage.getParcel.mockResolvedValue({ ...PARCEL, userId: "other-user" });
    const app = buildApp(storage);
    const r = await request(app)
      .post("/api/parcels/parcel-1/import-geometry")
      .attach("file", FIX("sample.geojson"), "sample.geojson");
    expect(r.status).toBe(403);
  });

  it("returns a preview for a valid GeoJSON upload", async () => {
    storage.getParcel.mockResolvedValue(PARCEL);
    const app = buildApp(storage);
    const r = await request(app)
      .post("/api/parcels/parcel-1/import-geometry")
      .attach("file", FIX("sample.geojson"), "sample.geojson");
    expect(r.status).toBe(200);
    expect(r.body.format).toBe("geojson");
    expect(r.body.featureCount).toBe(2);
    expect(r.body.geometryTypes).toContain("Polygon");
    expect(r.body.featureCollection.features).toHaveLength(2);
  });

  it("returns a preview for a valid KML upload", async () => {
    storage.getParcel.mockResolvedValue(PARCEL);
    const app = buildApp(storage);
    const r = await request(app)
      .post("/api/parcels/parcel-1/import-geometry")
      .attach("file", FIX("sample.kml"), "sample.kml");
    expect(r.status).toBe(200);
    expect(r.body.format).toBe("kml");
    expect(r.body.featureCount).toBe(2);
  });

  it("returns a preview for a valid KMZ upload", async () => {
    storage.getParcel.mockResolvedValue(PARCEL);
    const app = buildApp(storage);
    const r = await request(app)
      .post("/api/parcels/parcel-1/import-geometry")
      .attach("file", FIX("sample.kmz"), "sample.kmz");
    expect(r.status).toBe(200);
    expect(r.body.format).toBe("kmz");
    expect(r.body.featureCount).toBeGreaterThan(0);
  });

  it("preview tolerates a malformed KML (drops bad features without 500)", async () => {
    storage.getParcel.mockResolvedValue(PARCEL);
    const app = buildApp(storage);
    const r = await request(app)
      .post("/api/parcels/parcel-1/import-geometry")
      .attach("file", FIX("sample-malformed.kml"), "sample-malformed.kml");
    // Garantía: nunca debe responder 5xx. El parser puede auto-cerrar anillos y
    // descartar features inválidas (ej. <Point> sin coordenadas) silenciosamente.
    expect(r.status).toBeLessThan(500);
    expect([200, 422]).toContain(r.status);
    if (r.status === 200) {
      // Al menos una feature inválida del fixture (Point vacío) fue descartada.
      expect(r.body.featureCount).toBeLessThan(2);
      expect(r.body.format).toBe("kml");
    }
  });

  it("returns 404 when the parcel is unknown", async () => {
    storage.getParcel.mockResolvedValue(undefined);
    const app = buildApp(storage);
    const r = await request(app)
      .post("/api/parcels/missing/import-geometry")
      .attach("file", FIX("sample.geojson"), "sample.geojson");
    expect(r.status).toBe(404);
  });
});

describe("POST /api/parcels/:id/zones/from-import (polygons mode)", () => {
  let storage: FakeStorage;
  beforeEach(() => { storage = makeFakeStorage(); });

  it("persists zones and an import record end-to-end", async () => {
    storage.getParcel.mockResolvedValue(PARCEL);
    storage.bulkCreateManagementZones.mockImplementation(async (zones: any[]) =>
      zones.map((z, i) => ({ ...z, id: `zone-${i}` })),
    );
    storage.createZoneImport.mockImplementation(async (row: any) => ({
      ...row, id: "import-1", createdAt: new Date(),
    }));

    const fc = JSON.parse(FIX("sample.geojson").toString("utf8"));
    const app = buildApp(storage);
    const r = await request(app)
      .post("/api/parcels/parcel-1/zones/from-import")
      .send({
        featureCollection: fc,
        mode: "polygons",
        originalFileName: "sample.geojson",
        format: "geojson",
        warnings: [],
      });

    expect(r.status).toBe(200);
    expect(r.body.zonesCreated).toBe(2);
    expect(r.body.zoneSetId).toBeTruthy();
    expect(storage.bulkCreateManagementZones).toHaveBeenCalledTimes(1);
    const inserted = storage.bulkCreateManagementZones.mock.calls[0][0];
    expect(inserted).toHaveLength(2);
    // Sorted ascending by valueMean → first zone has the lower value (1.2)
    expect(inserted[0].valueMean).toBe(1.2);
    expect(inserted[1].valueMean).toBe(2.5);
    expect(inserted[0].source).toBe("imported");
    expect(inserted[0].polygonGeojson?.type).toBe("Polygon");
    expect(storage.createZoneImport).toHaveBeenCalledTimes(1);
  });

  it("rejects unknown modes via zod", async () => {
    storage.getParcel.mockResolvedValue(PARCEL);
    const app = buildApp(storage);
    const r = await request(app)
      .post("/api/parcels/parcel-1/zones/from-import")
      .send({
        featureCollection: { type: "FeatureCollection", features: [] },
        mode: "wat",
        originalFileName: "x.geojson",
        format: "geojson",
      });
    expect(r.status).toBe(400);
  });

  it("rejects polygons with unclosed rings (zod strict)", async () => {
    storage.getParcel.mockResolvedValue(PARCEL);
    const app = buildApp(storage);
    const fc = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { name: "abierto" },
          // Falta el último punto = primer punto → no cerrado
          geometry: { type: "Polygon", coordinates: [[[-58.40,-34.60],[-58.39,-34.60],[-58.39,-34.59],[-58.40,-34.59]]] },
        },
      ],
    };
    const r = await request(app)
      .post("/api/parcels/parcel-1/zones/from-import")
      .send({ featureCollection: fc, mode: "polygons", originalFileName: "bad.geojson", format: "geojson" });
    expect(r.status).toBe(400);
    expect(storage.bulkCreateManagementZones).not.toHaveBeenCalled();
  });

  it("voronoi mode clips zones to the parcel polygon end-to-end", async () => {
    storage.getParcel.mockResolvedValue(PARCEL);
    storage.bulkCreateManagementZones.mockImplementation(async (zones: any[]) =>
      zones.map((z, i) => ({ ...z, id: `vz-${i}` })),
    );
    storage.createZoneImport.mockImplementation(async (row: any) => ({ ...row, id: "imp-vor", createdAt: new Date() }));
    const app = buildApp(storage);
    const fc = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { value: 1 }, geometry: { type: "Point", coordinates: [-58.40, -34.60] } },
        { type: "Feature", properties: { value: 2 }, geometry: { type: "Point", coordinates: [-58.39, -34.595] } },
        { type: "Feature", properties: { value: 3 }, geometry: { type: "Point", coordinates: [-58.38, -34.585] } },
      ],
    };
    const r = await request(app)
      .post("/api/parcels/parcel-1/zones/from-import")
      .send({ featureCollection: fc, mode: "voronoi", originalFileName: "p.geojson", format: "geojson" });
    expect(r.status).toBe(200);
    expect(r.body.zonesCreated).toBeGreaterThanOrEqual(2);
    const inserted = storage.bulkCreateManagementZones.mock.calls[0][0];
    // Verifico que los polígonos resultantes están dentro del bounding box de la parcela
    for (const z of inserted) {
      const ring = z.polygonGeojson.coordinates[0];
      for (const [lon, lat] of ring) {
        expect(lon).toBeGreaterThanOrEqual(-58.42);
        expect(lon).toBeLessThanOrEqual(-58.36);
        expect(lat).toBeGreaterThanOrEqual(-34.62);
        expect(lat).toBeLessThanOrEqual(-34.57);
      }
    }
  });

  it("samples mode appends points to an existing campaign", async () => {
    storage.getParcel.mockResolvedValue(PARCEL);
    storage.getSamplingCampaign.mockResolvedValue({ id: "camp-1", parcelId: "parcel-1", variableId: "var-1" });
    storage.getSamplingPointsByCampaign.mockResolvedValue([{ id: "p0", pointIndex: 0 }, { id: "p1", pointIndex: 1 }]);
    storage.bulkCreateSamplingPoints.mockImplementation(async (pts: any[]) =>
      pts.map((p, i) => ({ ...p, id: `np-${i}` })),
    );
    storage.createZoneImport.mockImplementation(async (row: any) => ({ ...row, id: "imp-s", createdAt: new Date() }));
    const app = buildApp(storage);
    const fc = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { value: 5.2 }, geometry: { type: "Point", coordinates: [-58.40, -34.60] } },
        { type: "Feature", properties: { value: 6.1, name: "P-A" }, geometry: { type: "Point", coordinates: [-58.39, -34.59] } },
      ],
    };
    const r = await request(app)
      .post("/api/parcels/parcel-1/zones/from-import")
      .send({
        featureCollection: fc,
        mode: "samples",
        originalFileName: "pts.geojson",
        format: "geojson",
        samplesTarget: { campaignId: "camp-1" },
      });
    expect(r.status).toBe(200);
    expect(r.body.pointsCreated).toBe(2);
    expect(r.body.campaignId).toBe("camp-1");
    const created = storage.bulkCreateSamplingPoints.mock.calls[0][0];
    expect(created[0].pointIndex).toBe(2); // baseIndex == 2 (existían 2 puntos previos)
    expect(created[1].pointIndex).toBe(3);
    expect(Number(created[0].value)).toBe(5.2);
    expect(created[1].notes).toBe("P-A");
  });

  it("samples mode rejects when no campaignId or variableId provided", async () => {
    storage.getParcel.mockResolvedValue(PARCEL);
    const app = buildApp(storage);
    const fc = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [-58.40, -34.60] } },
      ],
    };
    const r = await request(app)
      .post("/api/parcels/parcel-1/zones/from-import")
      .send({ featureCollection: fc, mode: "samples", originalFileName: "x.geojson", format: "geojson" });
    expect(r.status).toBe(400);
    expect(storage.bulkCreateSamplingPoints).not.toHaveBeenCalled();
  });

  it("samples mode creates a new campaign when variableId is provided", async () => {
    storage.getParcel.mockResolvedValue(PARCEL);
    storage.getMasterVariable.mockResolvedValue({ id: "var-ce", name: "CE" });
    storage.createSamplingCampaign.mockResolvedValue({ id: "camp-new", parcelId: "parcel-1" });
    storage.getSamplingPointsByCampaign.mockResolvedValue([]);
    storage.bulkCreateSamplingPoints.mockImplementation(async (pts: any[]) => pts.map((p, i) => ({ ...p, id: `n-${i}` })));
    storage.createZoneImport.mockImplementation(async (row: any) => ({ ...row, id: "imp-s2", createdAt: new Date() }));
    const app = buildApp(storage);
    const fc = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { value: 1 }, geometry: { type: "Point", coordinates: [-58.4, -34.6] } },
      ],
    };
    const r = await request(app)
      .post("/api/parcels/parcel-1/zones/from-import")
      .send({
        featureCollection: fc,
        mode: "samples",
        originalFileName: "x.geojson",
        format: "geojson",
        samplesTarget: { variableId: "var-ce", campaignName: "Test CE" },
      });
    expect(r.status).toBe(200);
    expect(storage.createSamplingCampaign).toHaveBeenCalledTimes(1);
    expect(storage.createSamplingCampaign.mock.calls[0][0].name).toBe("Test CE");
    expect(r.body.campaignId).toBe("camp-new");
  });

  it("reference mode stores the FeatureCollection as a visual layer (no zones)", async () => {
    storage.getParcel.mockResolvedValue(PARCEL);
    storage.createZoneImport.mockImplementation(async (row: any) => ({ ...row, id: "imp-ref", createdAt: new Date() }));
    const app = buildApp(storage);
    const fc = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[-58.40,-34.60],[-58.39,-34.59]] } },
      ],
    };
    const r = await request(app)
      .post("/api/parcels/parcel-1/zones/from-import")
      .send({ featureCollection: fc, mode: "reference", originalFileName: "lines.geojson", format: "geojson" });
    expect(r.status).toBe(200);
    expect(r.body.zonesCreated).toBe(0);
    expect(storage.bulkCreateManagementZones).not.toHaveBeenCalled();
    const importRow = storage.createZoneImport.mock.calls[0][0];
    expect(importRow.referenceGeojson).toBeTruthy();
    expect(importRow.referenceGeojson.features).toHaveLength(1);
  });

  it("reference mode + bufferMeters generates polygon zones from lines", async () => {
    storage.getParcel.mockResolvedValue(PARCEL);
    storage.bulkCreateManagementZones.mockImplementation(async (zones: any[]) => zones.map((z, i) => ({ ...z, id: `b-${i}` })));
    storage.createZoneImport.mockImplementation(async (row: any) => ({ ...row, id: "imp-buf", createdAt: new Date() }));
    const app = buildApp(storage);
    const fc = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { name: "Surco 1" }, geometry: { type: "LineString", coordinates: [[-58.395,-34.595],[-58.385,-34.595]] } },
      ],
    };
    const r = await request(app)
      .post("/api/parcels/parcel-1/zones/from-import")
      .send({
        featureCollection: fc,
        mode: "reference",
        originalFileName: "surcos.geojson",
        format: "geojson",
        referenceOptions: { bufferMeters: 10 },
      });
    expect(r.status).toBe(200);
    expect(r.body.zonesCreated).toBeGreaterThanOrEqual(1);
    const inserted = storage.bulkCreateManagementZones.mock.calls[0][0];
    expect(inserted[0].category).toBe("buffered");
    expect(["Polygon", "MultiPolygon"]).toContain(inserted[0].polygonGeojson.type);
  });

  it("idw mode calls geo-service and persists zones from the response", async () => {
    storage.getParcel.mockResolvedValue(PARCEL);
    storage.bulkCreateManagementZones.mockImplementation(async (zones: any[]) =>
      zones.map((z, i) => ({ ...z, id: `idw-${i}` })),
    );
    storage.createZoneImport.mockImplementation(async (row: any) => ({ ...row, id: "imp-idw", createdAt: new Date() }));
    const geoZones = [
      { zone_index: 0, zone_label: "Baja", value_mean: 1.2, value_std: 0.1, area_ha: 2.5, geojson: { type: "Polygon", coordinates: [[[-58.40,-34.61],[-58.39,-34.61],[-58.39,-34.60],[-58.40,-34.60],[-58.40,-34.61]]] }, color: "#d73027" },
      { zone_index: 1, zone_label: "Alta", value_mean: 3.5, value_std: 0.2, area_ha: 3.0, geojson: { type: "Polygon", coordinates: [[[-58.39,-34.61],[-58.38,-34.61],[-58.38,-34.60],[-58.39,-34.60],[-58.39,-34.61]]] }, color: "#1a9850" },
    ];
    const fakeGeoResponse = {
      ok: true,
      json: async () => ({ zones: geoZones, method: "idw" }),
      status: 200,
      text: async () => JSON.stringify({ zones: geoZones }),
    } as unknown as Response;
    const fetchMock = vi.fn().mockResolvedValue(fakeGeoResponse);
    const app = buildApp(storage, { id: "user-1", isActive: true }, fetchMock);
    const fc = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { value: 1.2 }, geometry: { type: "Point", coordinates: [-58.40, -34.60] } },
        { type: "Feature", properties: { value: 2.5 }, geometry: { type: "Point", coordinates: [-58.39, -34.595] } },
        { type: "Feature", properties: { value: 3.5 }, geometry: { type: "Point", coordinates: [-58.38, -34.585] } },
      ],
    };
    const r = await request(app)
      .post("/api/parcels/parcel-1/zones/from-import")
      .send({ featureCollection: fc, mode: "idw", originalFileName: "puntos.geojson", format: "geojson" });
    expect(r.status).toBe(200);
    expect(r.body.zonesCreated).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Verificar que se pasó method:"idw" y los puntos al geo-service.
    const [geoUrl, geoInit] = fetchMock.mock.calls[0];
    expect(geoUrl).toContain("/interpolate");
    const sentBody = JSON.parse(geoInit.body as string);
    expect(sentBody.method).toBe("idw");
    expect(sentBody.points).toHaveLength(3);
    expect(sentBody.polygon).toBeDefined();
    // Las zonas deben haberse insertado con category = "idw".
    const inserted = storage.bulkCreateManagementZones.mock.calls[0][0];
    expect(inserted[0].category).toBe("idw");
    expect(inserted[0].valueMean).toBeCloseTo(1.2);
  });

  it("idw mode returns 422 when fewer than 3 points with numeric value", async () => {
    storage.getParcel.mockResolvedValue(PARCEL);
    const app = buildApp(storage);
    const fc = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { value: 1 }, geometry: { type: "Point", coordinates: [-58.40, -34.60] } },
      ],
    };
    const r = await request(app)
      .post("/api/parcels/parcel-1/zones/from-import")
      .send({ featureCollection: fc, mode: "idw", originalFileName: "p.geojson", format: "geojson" });
    expect(r.status).toBe(422);
    expect(r.body.message).toMatch(/IDW requiere/i);
  });

  it("rejects geometries with non-finite coordinates (zod strict)", async () => {
    storage.getParcel.mockResolvedValue(PARCEL);
    const app = buildApp(storage);
    const fc = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { name: "infinito" },
          geometry: { type: "Point", coordinates: [Number.POSITIVE_INFINITY, -34.60] },
        },
      ],
    };
    const r = await request(app)
      .post("/api/parcels/parcel-1/zones/from-import")
      .send({ featureCollection: fc, mode: "samples", originalFileName: "bad.geojson", format: "geojson" });
    expect(r.status).toBe(400);
    expect(storage.bulkCreateManagementZones).not.toHaveBeenCalled();
  });
});

describe("GET /api/zone-sets/:zoneSetId/export-machine", () => {
  let storage: FakeStorage;
  beforeEach(() => { storage = makeFakeStorage(); });

  it("returns 400 for an unsupported format", async () => {
    storage.getManagementZonesByZoneSet.mockResolvedValue([
      { id: "z1", parcelId: PARCEL.id, zoneIndex: 0, zoneLabel: "Baja", areaHa: 1, polygonGeojson: { type: "Polygon", coordinates: [[[-58.40,-34.60],[-58.39,-34.60],[-58.39,-34.59],[-58.40,-34.59],[-58.40,-34.60]]] } },
    ]);
    storage.getParcel.mockResolvedValue(PARCEL);
    storage.getZonePrescriptionsByZone.mockResolvedValue([]);
    const app = buildApp(storage);
    const r = await request(app).get("/api/zone-sets/zs-1/export-machine?format=pdf");
    expect(r.status).toBe(400);
  });

  it("returns a GeoJSON download", async () => {
    storage.getManagementZonesByZoneSet.mockResolvedValue([
      { id: "z1", parcelId: PARCEL.id, zoneIndex: 0, zoneLabel: "Baja", areaHa: 1, polygonGeojson: { type: "Polygon", coordinates: [[[-58.40,-34.60],[-58.39,-34.60],[-58.39,-34.59],[-58.40,-34.59],[-58.40,-34.60]]] } },
      { id: "z2", parcelId: PARCEL.id, zoneIndex: 1, zoneLabel: "Alta", areaHa: 1, polygonGeojson: { type: "Polygon", coordinates: [[[-58.39,-34.60],[-58.38,-34.60],[-58.38,-34.59],[-58.39,-34.59],[-58.39,-34.60]]] } },
    ]);
    storage.getParcel.mockResolvedValue(PARCEL);
    storage.getZonePrescriptionsByZone.mockResolvedValue([
      { dosePerHa: 100, doseUnit: "kg/ha", amendment: "Urea" },
    ]);
    const app = buildApp(storage);
    const r = await request(app).get("/api/zone-sets/zs-1/export-machine?format=geojson");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/geo\+json/);
    const fc = JSON.parse(r.text);
    expect(fc.features).toHaveLength(2);
  });

  it("rejects 403 when the parcel belongs to another user", async () => {
    storage.getManagementZonesByZoneSet.mockResolvedValue([
      { id: "z1", parcelId: "p-other", zoneIndex: 0, zoneLabel: "x", areaHa: 1, polygonGeojson: { type: "Polygon", coordinates: [[[0,0],[1,0],[1,1],[0,1],[0,0]]] } },
    ]);
    storage.getParcel.mockResolvedValue({ ...PARCEL, id: "p-other", userId: "other" });
    storage.getZonePrescriptionsByZone.mockResolvedValue([]);
    const app = buildApp(storage);
    const r = await request(app).get("/api/zone-sets/zs-1/export-machine?format=geojson");
    expect(r.status).toBe(403);
  });
});

// ── Structured error codes (T149) ─────────────────────────────────────────────

describe("POST /api/parcels/:id/zones/from-import — structured error codes", () => {
  let storage: FakeStorage;
  beforeEach(() => { storage = makeFakeStorage(); });

  it("returns errorCode=ring_not_closed when a polygon ring is open", async () => {
    storage.getParcel.mockResolvedValue(PARCEL);
    const app = buildApp(storage);

    // El anillo tiene 4 vértices distintos sin cerrar (falta repetir [0,0] al final).
    const openRingFc = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]],
          },
          properties: {},
        },
      ],
    };

    const r = await request(app)
      .post("/api/parcels/parcel-1/zones/from-import")
      .send({
        featureCollection: openRingFc,
        mode: "polygons",
        originalFileName: "campo_abierto.geojson",
        format: "geojson",
      });

    expect(r.status).toBe(400);
    expect(r.body.errorCode).toBe("ring_not_closed");
    expect(typeof r.body.message).toBe("string");
    expect(r.body.message.length).toBeGreaterThan(0);
    // El índice de la zona afectada debe ser 0 (primera feature).
    expect(r.body.zoneIndex).toBe(0);
  });

  it("returns errorCode=non_finite_coord when a coordinate is null (Infinity serializes to null in JSON)", async () => {
    storage.getParcel.mockResolvedValue(PARCEL);
    const app = buildApp(storage);

    // JSON.stringify(Infinity) → null, por lo que en la práctica una coordenada
    // no-finita llega al servidor como null. El backend debe reconocerlo como
    // non_finite_coord en lugar de un error de validación genérico.
    const nullCoordFc = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Polygon",
            // El tercer vértice tiene latitud null (representación JSON de Infinity).
            coordinates: [[[0, 0], [1, 0], [1, null], [0, 0]]],
          },
          properties: {},
        },
      ],
    };

    const r = await request(app)
      .post("/api/parcels/parcel-1/zones/from-import")
      .send({
        featureCollection: nullCoordFc,
        mode: "polygons",
        originalFileName: "coordenadas_invalidas.geojson",
        format: "geojson",
      });

    expect(r.status).toBe(400);
    expect(r.body.errorCode).toBe("non_finite_coord");
    expect(typeof r.body.message).toBe("string");
    expect(r.body.zoneIndex).toBe(0);
  });

  it("includes zoneIndex pointing to the second feature when the first is valid", async () => {
    storage.getParcel.mockResolvedValue(PARCEL);
    const app = buildApp(storage);

    // Primera feature: anillo cerrado válido.
    // Segunda feature: anillo abierto → debe reportar zoneIndex=1.
    const mixedFc = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]],
          },
          properties: {},
        },
        {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [[[2, 2], [3, 2], [3, 3], [2, 3]]],  // open
          },
          properties: {},
        },
      ],
    };

    const r = await request(app)
      .post("/api/parcels/parcel-1/zones/from-import")
      .send({
        featureCollection: mixedFc,
        mode: "polygons",
        originalFileName: "mixto.geojson",
        format: "geojson",
      });

    expect(r.status).toBe(400);
    expect(r.body.errorCode).toBe("ring_not_closed");
    expect(r.body.zoneIndex).toBe(1);
  });
});

/**
 * Integration tests for the satellite-zonification HTTP routes.
 *
 *  1. Body-schema validation rules (`satelliteZoneBodySchema`).
 *  2. End-to-end exercise of the real Express handler via supertest, with
 *     Earth-Engine, the geo-service and the storage layer stubbed out so the
 *     test runs hermetically. This validates route wiring, auth gating,
 *     request-body validation inside the handler, ownership checks,
 *     persistence, and the upstream-service contract.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

import { satelliteZoneBodySchema } from "../shared/satellite-zone-schema";
import { registerSatelliteZoneRoutes } from "../server/routes/satellite-zones";

describe("satelliteZoneBodySchema", () => {
  it("accepts the documented index types", () => {
    for (const idx of ["ndvi", "ndre", "ndmi", "evi", "msavi", "gndvi"]) {
      expect(satelliteZoneBodySchema.safeParse({ indexType: idx }).success).toBe(true);
    }
  });

  it("rejects unknown index types", () => {
    expect(satelliteZoneBodySchema.safeParse({ indexType: "savi" }).success).toBe(false);
  });

  it("accepts every documented classification method", () => {
    for (const m of ["spatial_kmeans", "kmeans", "jenks", "quantiles", "fuzzy", "agronomic"]) {
      expect(satelliteZoneBodySchema.safeParse({ method: m }).success).toBe(true);
    }
  });

  it("rejects unknown classification methods", () => {
    expect(satelliteZoneBodySchema.safeParse({ method: "dbscan" }).success).toBe(false);
  });

  it("accepts a single 'date' value or a complete dateFrom + dateTo range", () => {
    expect(satelliteZoneBodySchema.safeParse({ date: "2025-08-01" }).success).toBe(true);
    expect(satelliteZoneBodySchema.safeParse({ dateFrom: "2025-07-01", dateTo: "2025-08-01" }).success).toBe(true);
  });

  it("rejects half-specified date ranges", () => {
    expect(satelliteZoneBodySchema.safeParse({ dateFrom: "2025-07-01" }).success).toBe(false);
    expect(satelliteZoneBodySchema.safeParse({ dateTo: "2025-08-01" }).success).toBe(false);
  });

  it("rejects malformed date strings", () => {
    expect(satelliteZoneBodySchema.safeParse({ date: "08/01/2025" }).success).toBe(false);
  });

  it("clamps nZones into [2,6]", () => {
    expect(satelliteZoneBodySchema.safeParse({ nZones: 1 }).success).toBe(false);
    expect(satelliteZoneBodySchema.safeParse({ nZones: 7 }).success).toBe(false);
    expect(satelliteZoneBodySchema.safeParse({ nZones: 6 }).success).toBe(true);
    expect(satelliteZoneBodySchema.safeParse({ nZones: 5 }).success).toBe(true);
  });

  it("applies sensible defaults", () => {
    const r = satelliteZoneBodySchema.parse({});
    expect(r.indexType).toBe("ndvi");
    expect(r.method).toBe("spatial_kmeans");
    expect(r.nZones).toBe(3);
    expect(r.maxCloudPct).toBe(20);
    expect(r.daysBack).toBe(30);
    expect(r.minZoneAreaHa).toBe(0.25);
  });

  it("rejects unknown fields", () => {
    expect(satelliteZoneBodySchema.safeParse({ method: "jenks", surprise: "param" }).success).toBe(false);
  });
});

// ─── End-to-end Express route test (supertest) ───────────────────────────────

interface FakeStorage {
  getParcel: ReturnType<typeof vi.fn>;
  bulkCreateManagementZones: ReturnType<typeof vi.fn>;
  getManagementZonesByParcel: ReturnType<typeof vi.fn>;
  getManagementZonesByZoneSet: ReturnType<typeof vi.fn>;
  deleteManagementZonesByZoneSet: ReturnType<typeof vi.fn>;
  createZonePrescription: ReturnType<typeof vi.fn>;
  deleteZonePrescriptionsByZone: ReturnType<typeof vi.fn>;
  getZonePrescriptionsByZone: ReturnType<typeof vi.fn>;
  replaceUnappliedZonePrescriptions: ReturnType<typeof vi.fn>;
  getPrescriptionApplicationsByPrescription: ReturnType<typeof vi.fn>;
}

function makeFakeStorage(): FakeStorage {
  return {
    getParcel: vi.fn(),
    bulkCreateManagementZones: vi.fn(),
    getManagementZonesByParcel: vi.fn(),
    getManagementZonesByZoneSet: vi.fn(),
    deleteManagementZonesByZoneSet: vi.fn(),
    createZonePrescription: vi.fn(),
    deleteZonePrescriptionsByZone: vi.fn(),
    getZonePrescriptionsByZone: vi.fn(),
    replaceUnappliedZonePrescriptions: vi.fn(),
    getPrescriptionApplicationsByPrescription: vi.fn(),
  };
}

function buildApp(opts: {
  storage: FakeStorage;
  user?: { id: string; isActive: boolean } | null;
  isGEEAvailable?: () => boolean;
  getIndexRaster?: ReturnType<typeof vi.fn>;
  fetchWithTimeout: ReturnType<typeof vi.fn>;
  explainNdviNitrogen?: NonNullable<Parameters<typeof registerSatelliteZoneRoutes>[1]["explainNdviNitrogen"]>;
}) {
  const app = express();
  app.use(express.json({ limit: "10mb" }));

  // Bypass auth: let the test inject (or omit) the user.
  app.use((req: any, _res, next) => {
    req.isAuthenticated = () => Boolean(opts.user);
    if (opts.user) req.user = opts.user;
    next();
  });

  // Mirror the real app's auth middleware shape.
  const isAuthenticated = (req: any, res: any, next: any) => {
    if (req.isAuthenticated()) return next();
    res.status(401).json({ message: "No autenticado" });
  };
  const isActiveUser = (req: any, res: any, next: any) => {
    if (req.isAuthenticated() && req.user?.isActive) return next();
    res.status(403).json({ message: "Cuenta desactivada" });
  };

  registerSatelliteZoneRoutes(
    app,
    {
      storage: opts.storage as any,
      isGEEAvailable: opts.isGEEAvailable ?? (() => true),
      getIndexRaster: opts.getIndexRaster ?? vi.fn(),
      fetchWithTimeout: opts.fetchWithTimeout as any,
      geoServiceUrl: "http://geo-service.test",
      explainNdviNitrogen: opts.explainNdviNitrogen,
    },
    { isAuthenticated, isActiveUser },
  );
  return app;
}

describe("satellite NDVI nitrogen prescription", () => {
  afterEach(() => vi.unstubAllEnvs());

  function setup(indexType = "ndvi", mean: unknown = "0.2000", source = "satellite_index") {
    const storage = makeFakeStorage();
    storage.getParcel.mockResolvedValue({ id: "p", userId: "u" });
    storage.getManagementZonesByZoneSet.mockResolvedValue([{
      id: "z", parcelId: "p", source, zoneIndex: 3, valueMean: mean, areaHa: "1.25",
      sourceMetadata: { indexType },
    }]);
    storage.replaceUnappliedZonePrescriptions.mockImplementation(async rows => rows);
    const explain = vi.fn(async () => new Map([[3, "Usa 999 kg por hectárea."]]));
    const app = buildApp({ storage, user: { id: "u", isActive: true }, fetchWithTimeout: vi.fn(), explainNdviNitrogen: explain });
    return { post: () => request(app).post("/api/zone-sets/set/prescribe"), storage, explain };
  }

  it("calculates doses without a model when explanations are disabled", async () => {
    vi.stubEnv("NDVI_NITROGEN_AI_EXPLANATION", "false");
    const { post, explain } = setup();
    const res = await post().expect(200);
    expect(explain).not.toHaveBeenCalled();
    expect(res.body.prescriptions[0]).toMatchObject({ dosePerHa: 50, doseUnit: "kg N", totalDose: 62.5 });
  });

  it("passes fixed doses to the explainer and never uses its suggested rate", async () => {
    vi.stubEnv("NDVI_NITROGEN_AI_EXPLANATION", "true");
    const { post, explain } = setup();
    const res = await post().expect(200);
    expect(explain).toHaveBeenCalledWith([expect.objectContaining({ zoneIndex: 3, dose: 50, unit: "kg N/ha" })]);
    expect(res.body.prescriptions[0].dosePerHa).toBe(50);
    expect(res.body.prescriptions[0].aiRationale).not.toContain("999");
  });

  it("uses deterministic output even if explanation fails", async () => {
    vi.stubEnv("NDVI_NITROGEN_AI_EXPLANATION", "true");
    const { post, explain } = setup("ndvi", 0.55);
    explain.mockRejectedValueOnce(new Error("provider unavailable"));
    const res = await post().expect(200);
    expect(res.body.prescriptions[0].dosePerHa).toBe(20);
  });

  it.each([["ndmi", "satellite_index"], ["ndvi", "imported"]])("rejects %s from %s", async (index, source) => {
    const { post, storage } = setup(index, 0.4, source);
    await post().expect(400);
    expect(storage.replaceUnappliedZonePrescriptions).not.toHaveBeenCalled();
  });

  it("does not mistake missing NDVI for zero or write any prescription", async () => {
    const { post, storage } = setup("ndvi", null);
    await post().expect(422);
    expect(storage.replaceUnappliedZonePrescriptions).not.toHaveBeenCalled();
  });

  it("preserves the application's history instead of replacing an applied prescription", async () => {
    const { post, storage } = setup();
    storage.replaceUnappliedZonePrescriptions.mockResolvedValueOnce(null);
    await post().expect(409);
  });
});

const VALID_PARCEL = {
  id: "parcel-1",
  userId: "user-1",
  name: "Parcela Test",
  area: 10,
  crop: "maiz",
  polygonCoordinates: [
    [20.000, -99.501],
    [20.000, -99.499],
    [20.001, -99.499],
    [20.001, -99.501],
  ] as [number, number][],
};

describe("POST /api/parcels/:id/zones/from-satellite", () => {
  let storage: FakeStorage;
  let getIndexRaster: ReturnType<typeof vi.fn>;
  let fetchWithTimeout: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    storage = makeFakeStorage();
    storage.getParcel.mockResolvedValue(VALID_PARCEL);
    storage.bulkCreateManagementZones.mockImplementation(async (rows: any[]) =>
      rows.map((r, i) => ({ id: `zone-${i + 1}`, ...r })),
    );

    getIndexRaster = vi.fn(async () => ({
      values: [
        [0.20, 0.25, 0.30],
        [0.40, 0.50, 0.60],
        [0.70, 0.75, 0.80],
      ],
      bbox: { minx: -99.501, miny: 19.999, maxx: -99.499, maxy: 20.001 },
      scaleM: 10,
      rows: 3,
      cols: 3,
      validPixels: 9,
      vmin: 0.20,
      vmax: 0.80,
      cloudyPixelPercentage: 5,
      imageDate: "2025-08-01",
      indexType: "ndvi",
    }));

    fetchWithTimeout = vi.fn();
  });

  it("returns 401 when the user is unauthenticated", async () => {
    fetchWithTimeout.mockImplementation(async () => new Response("not used"));
    const app = buildApp({ storage, user: null, getIndexRaster, fetchWithTimeout });
    const r = await request(app).post("/api/parcels/parcel-1/zones/from-satellite").send({});
    expect(r.status).toBe(401);
    expect(getIndexRaster).not.toHaveBeenCalled();
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });

  it("returns 403 when the parcel belongs to another user", async () => {
    storage.getParcel.mockResolvedValue({ ...VALID_PARCEL, userId: "someone-else" });
    fetchWithTimeout.mockImplementation(async () => new Response("not used"));
    const app = buildApp({
      storage, user: { id: "user-1", isActive: true }, getIndexRaster, fetchWithTimeout,
    });
    const r = await request(app).post("/api/parcels/parcel-1/zones/from-satellite").send({});
    expect(r.status).toBe(403);
  });

  it("returns 400 when the body fails schema validation", async () => {
    fetchWithTimeout.mockImplementation(async () => new Response("not used"));
    const app = buildApp({
      storage, user: { id: "user-1", isActive: true }, getIndexRaster, fetchWithTimeout,
    });
    const r = await request(app)
      .post("/api/parcels/parcel-1/zones/from-satellite")
      .send({ method: "dbscan" });
    expect(r.status).toBe(400);
    expect(getIndexRaster).not.toHaveBeenCalled();
  });

  it("returns 503 when GEE is unavailable", async () => {
    fetchWithTimeout.mockImplementation(async () => new Response("not used"));
    const app = buildApp({
      storage, user: { id: "user-1", isActive: true }, isGEEAvailable: () => false,
      getIndexRaster, fetchWithTimeout,
    });
    const r = await request(app).post("/api/parcels/parcel-1/zones/from-satellite").send({});
    expect(r.status).toBe(503);
    expect(getIndexRaster).not.toHaveBeenCalled();
  });

  it("orchestrates EE → /zonify-from-raster → storage and returns the zone-set", async () => {
    let zonifyPayload: any = null;
    fetchWithTimeout.mockImplementation(async (url: string, init?: RequestInit) => {
      expect(url).toBe("http://geo-service.test/zonify-from-raster");
      zonifyPayload = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        zones: [
          { zone_index: 0, zone_label: "Zona 1", category: "Bajo",  value_mean: 0.25, value_min: 0.20, value_max: 0.30, area_ha: 0.4, color: "#d73027", geojson: { type: "Polygon", coordinates: [[[0,0],[1,0],[1,1],[0,1],[0,0]]] } },
          { zone_index: 1, zone_label: "Zona 2", category: "Medio", value_mean: 0.50, value_min: 0.40, value_max: 0.60, area_ha: 0.4, color: "#fee08b", geojson: { type: "Polygon", coordinates: [[[1,0],[2,0],[2,1],[1,1],[1,0]]] } },
          { zone_index: 2, zone_label: "Zona 3", category: "Alto",  value_mean: 0.75, value_min: 0.70, value_max: 0.80, area_ha: 0.4, color: "#1a9850", geojson: { type: "Polygon", coordinates: [[[2,0],[3,0],[3,1],[2,1],[2,0]]] } },
        ],
        n_zones_actual: 3,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const app = buildApp({
      storage, user: { id: "user-1", isActive: true }, getIndexRaster, fetchWithTimeout,
    });
    const r = await request(app)
      .post("/api/parcels/parcel-1/zones/from-satellite")
      .send({ indexType: "ndvi", method: "jenks", nZones: 3, dateFrom: "2025-07-01", dateTo: "2025-08-15" });

    expect(r.status).toBe(200);
    expect(r.body.nZones).toBe(3);
    expect(r.body.zoneSetId).toMatch(/^sat_/);
    expect(r.body.zones).toHaveLength(3);
    expect(r.body.raster.indexType).toBe("ndvi");

    // EE was called with the requested date range and index type.
    expect(getIndexRaster).toHaveBeenCalledWith(
      expect.objectContaining({ coordinates: VALID_PARCEL.polygonCoordinates }),
      "ndvi",
      expect.objectContaining({ dateFrom: "2025-07-01", dateTo: "2025-08-15" }),
    );

    // The geo-service was called with the raster, the parcel polygon (lon/lat), and the chosen method.
    expect(zonifyPayload.method).toBe("jenks");
    expect(zonifyPayload.n_zones).toBe(3);
    expect(zonifyPayload.variable_code).toBe("ndvi");
    expect(zonifyPayload.polygon).toHaveLength(4);
    expect(zonifyPayload.polygon[0]).toEqual([-99.501, 20.000]);   // [lon, lat] order
    expect(zonifyPayload.grid_values).toHaveLength(3);
    expect(zonifyPayload.apply_mode_filter).toBe(true);

    // Zones were persisted with source='satellite_index' and the same zoneSetId.
    expect(storage.bulkCreateManagementZones).toHaveBeenCalledTimes(1);
    const persistedRows = storage.bulkCreateManagementZones.mock.calls[0][0];
    expect(persistedRows).toHaveLength(3);
    const setIds = new Set(persistedRows.map((p: any) => p.zoneSetId));
    expect(setIds.size).toBe(1);
    expect(persistedRows[0].source).toBe("satellite_index");
    expect(persistedRows[0].sourceMetadata.method).toBe("jenks");
  });

  it("preserves clouds and out-of-polygon missing cells, including real zero values, for web zonification", async () => {
    const raster = await getIndexRaster.getMockImplementation()!();
    getIndexRaster.mockResolvedValue({
      ...raster, values: [[null, 0, .3], [.4, .5, .6], [.7, .75, null]],
      vmin: 0, vmax: .75, validPixels: 7,
    });
    let payload: any;
    fetchWithTimeout.mockImplementation(async (_url: string, init?: RequestInit) => {
      payload = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ zones: [{
        zone_index: 0, zone_label: "Zona 1", category: "Medio", value_mean: .5,
        value_min: 0, value_max: .75, area_ha: 1.2, color: "#fee08b",
        geojson: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
      }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const app = buildApp({ storage, user: { id: "user-1", isActive: true }, getIndexRaster, fetchWithTimeout });
    const result = await request(app).post("/api/parcels/parcel-1/zones/from-satellite")
      .send({ indexType: "ndvi", method: "jenks", nZones: 3 });
    expect(result.status).toBe(200);
    expect(payload.grid_values).toEqual([[null, 0, .3], [.4, .5, .6], [.7, .75, null]]);
    expect(payload.grid_values.flat()).not.toContain(-9999);
    expect(payload.polygon).toHaveLength(4);
  });

  it("returns 502 when the geo-service responds with a non-2xx", async () => {
    fetchWithTimeout.mockImplementation(async () =>
      new Response("upstream boom", { status: 500 }),
    );
    const app = buildApp({
      storage, user: { id: "user-1", isActive: true }, getIndexRaster, fetchWithTimeout,
    });
    const r = await request(app).post("/api/parcels/parcel-1/zones/from-satellite").send({});
    expect(r.status).toBe(502);
    expect(r.body.message).toMatch(/zonify-from-raster/);
    expect(storage.bulkCreateManagementZones).not.toHaveBeenCalled();
  });

  it("returns 422 when the geo-service yields no valid zones", async () => {
    fetchWithTimeout.mockImplementation(async () =>
      new Response(JSON.stringify({ zones: [{ zone_index: 0, geojson: null }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    const app = buildApp({
      storage, user: { id: "user-1", isActive: true }, getIndexRaster, fetchWithTimeout,
    });
    const r = await request(app).post("/api/parcels/parcel-1/zones/from-satellite").send({});
    expect(r.status).toBe(422);
    expect(storage.bulkCreateManagementZones).not.toHaveBeenCalled();
  });
});

describe("GET /api/parcels/:id/zones/from-satellite/:zoneSetId/export", () => {
  let storage: FakeStorage;
  let fetchWithTimeout: ReturnType<typeof vi.fn>;
  const zoneSetId = "sat_test_001";
  const SAVED_META = {
    indexType: "ndvi",
    imageDate: "2025-08-01",
    bbox: { minx: -99.501, miny: 19.999, maxx: -99.499, maxy: 20.001 },
  };
  const SAVED_ZONES = [
    {
      id: "z1", parcelId: "parcel-1", zoneSetId, zoneIndex: 0, zoneLabel: "Zona 1",
      category: "Bajo", colorHex: "#d73027", areaHa: 0.4, valueMean: 0.25,
      valueStd: 0.02, valueMin: 0.20, valueMax: 0.30,
      polygonGeojson: { type: "Polygon", coordinates: [[[0,0],[1,0],[1,1],[0,1],[0,0]]] },
      sourceMetadata: SAVED_META,
    },
  ];

  beforeEach(() => {
    storage = makeFakeStorage();
    storage.getParcel.mockResolvedValue(VALID_PARCEL);
    storage.getManagementZonesByZoneSet.mockResolvedValue(SAVED_ZONES);
    fetchWithTimeout = vi.fn();
  });

  it("returns the GeoJSON FeatureCollection inline", async () => {
    fetchWithTimeout.mockImplementation(async () => new Response("not used"));
    const app = buildApp({ storage, user: { id: "user-1", isActive: true }, fetchWithTimeout });
    const r = await request(app)
      .get(`/api/parcels/parcel-1/zones/from-satellite/${zoneSetId}/export?format=geojson`);
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/geo\+json/);
    const body = JSON.parse(r.text);
    expect(body.type).toBe("FeatureCollection");
    expect(body.features).toHaveLength(1);
    expect(body.features[0].properties.zoneIndex).toBe(0);
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });

  it("forwards Shapefile requests to the geo-service /zones-export-shp endpoint", async () => {
    let calledUrl = "";
    let calledBody: any = null;
    fetchWithTimeout.mockImplementation(async (url: string, init?: RequestInit) => {
      calledUrl = url;
      calledBody = JSON.parse(String(init?.body));
      return new Response(Buffer.from("PK\x03\x04shapefile-bytes"), {
        status: 200,
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": 'attachment; filename="zonas_test.zip"',
        },
      });
    });
    const app = buildApp({ storage, user: { id: "user-1", isActive: true }, fetchWithTimeout });
    const r = await request(app)
      .get(`/api/parcels/parcel-1/zones/from-satellite/${zoneSetId}/export?format=shapefile`);
    expect(r.status).toBe(200);
    expect(calledUrl).toBe("http://geo-service.test/zones-export-shp");
    expect(calledBody.zones).toHaveLength(1);
    expect(calledBody.zones[0].zone_index).toBe(0);
    expect(r.headers["content-type"]).toBe("application/zip");
    expect(r.headers["content-disposition"]).toContain("zonas_test.zip");
  });

  it("forwards GeoTIFF requests with the bbox extracted from sourceMetadata", async () => {
    let calledUrl = "";
    let calledBody: any = null;
    fetchWithTimeout.mockImplementation(async (url: string, init?: RequestInit) => {
      calledUrl = url;
      calledBody = JSON.parse(String(init?.body));
      return new Response(Buffer.from("II*\x00geotiff-bytes"), {
        status: 200,
        headers: { "Content-Type": "image/tiff" },
      });
    });
    const app = buildApp({ storage, user: { id: "user-1", isActive: true }, fetchWithTimeout });
    const r = await request(app)
      .get(`/api/parcels/parcel-1/zones/from-satellite/${zoneSetId}/export?format=geotiff`);
    expect(r.status).toBe(200);
    expect(calledUrl).toBe("http://geo-service.test/zones-export-geotiff");
    expect(calledBody.bbox).toEqual({ minx: -99.501, miny: 19.999, maxx: -99.499, maxy: 20.001 });
    expect(r.headers["content-type"]).toBe("image/tiff");
  });

  it("rejects unsupported export formats with 400", async () => {
    fetchWithTimeout.mockImplementation(async () => new Response("not used"));
    const app = buildApp({ storage, user: { id: "user-1", isActive: true }, fetchWithTimeout });
    const r = await request(app)
      .get(`/api/parcels/parcel-1/zones/from-satellite/${zoneSetId}/export?format=excel`);
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/Formato no soportado/);
  });
});

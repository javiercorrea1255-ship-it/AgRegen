import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  available: vi.fn(), catalogue: vi.fn(), raster: vi.fn(), save: vi.fn(), download: vi.fn(),
}));
vi.mock("../server/services/earth-engine", () => ({
  isGEEAvailable: mocks.available, getAvailableSentinelImages: mocks.catalogue, getIndexRaster: mocks.raster,
}));
vi.mock("../server/replit_integrations/object_storage/objectStorage", () => ({
  ObjectStorageService: class {
    savePrivateBuffer = mocks.save;
    getObjectEntityFile = vi.fn(async () => ({ download: mocks.download }));
  },
}));
import { prepareWhatsappSatelliteMap, clearSatelliteCatalogueCache, renderSatellitePng,
  recordSentSatelliteMap, satelliteCaption } from "../server/services/whatsapp-satellite";
import { analyzeSatelliteRaster } from "../server/services/whatsapp-satellite-math";
import { getWhatsappMetricsSnapshot, resetWhatsappMetricsForTests } from "../server/services/whatsapp-metrics";
import { fieldLogOrigin } from "../shared/field-log-policy";
import { clearWhatsappSatelliteRefresh, scheduleWhatsappSatelliteRefresh, waitForWhatsappSatelliteRefresh } from "../server/services/whatsapp-satellite-refresh";

const coordinates: [number, number][] = [[20, -103], [20.003, -103], [20.003, -102.997], [20, -102.997]];
const parcel = { id: "p", userId: "u", name: "Lote de prueba", latitude: "20", polygonCoordinates: coordinates } as any;
const now = new Date("2026-11-17T12:00:00Z");
function raster(date = "2026-11-16", values = [[.2, .2, .2], [.5, .5, .5], [.8, .8, .8]]) {
  return { values, bbox: { minx: -103, miny: 20, maxx: -102.997, maxy: 20.003 }, rows: 3, cols: 3,
    imageDate: date, imageId: date === "2026-11-11" ? "scene-before" : "scene-latest",
    indexType: "ndvi", scaleM: 100, validPixels: 9, vmin: .2, vmax: .8, cloudyPixelPercentage: 0 };
}
function options(request: any = { index: "ndvi", date: null, compare: false }) {
  return { storage: { getWhatsappMapArtifact: vi.fn().mockResolvedValue(undefined) } as any,
    parcel, request, now, onIntent: vi.fn().mockResolvedValue(undefined),
    render: vi.fn().mockResolvedValue(Buffer.from("png")) };
}
beforeEach(() => {
  vi.clearAllMocks(); clearSatelliteCatalogueCache(); resetWhatsappMetricsForTests();
  clearWhatsappSatelliteRefresh();
  mocks.available.mockReturnValue(true);
  mocks.catalogue.mockResolvedValue([
    { date: "2026-11-16", id: "scene-latest", cloudPercentage: 0 },
    { date: "2026-11-11", id: "scene-before", cloudPercentage: 0 },
  ]);
  mocks.raster.mockImplementation(async (_b, index, o) => ({
    ...raster(o.previous || o.imageId === "scene-before" ? "2026-11-11" : "2026-11-16"), indexType: index,
  }));
  mocks.save.mockResolvedValue("/objects/whatsapp-satellite/map.png");
  mocks.download.mockResolvedValue([Buffer.from("cached PNG")]);
});
describe("Real-only satellite maps", () => {
  it("compares the two requested dates rather than a neighbor of the historical date", async () => {
    mocks.catalogue.mockResolvedValue([
      { id: "november", date: "2026-11-16" }, { id: "september", date: "2026-09-16" },
    ]);
    mocks.raster.mockImplementation(async (_bounds, indexType, opts) => {
      const historical = opts.candidateImageIds[0] === "september";
      return { ...raster(historical ? "2026-09-16" : "2026-11-16",
        Array.from({ length: 3 }, () => Array(3).fill(historical ? .3 : .5))),
        imageId: historical ? "september" : "november", indexType };
    });
    const map = await prepareWhatsappSatelliteMap(options({ index: "ndvi", date: null,
      comparisonDate: "2026-09-17", compare: true }));
    expect(map.summary.imageDate).toBe("2026-11-16");
    expect(map.summary.previousDate).toBe("2026-09-16");
    expect(map.summary.change?.meanDelta).toBeCloseTo(.2);
    expect(mocks.catalogue).toHaveBeenCalledTimes(1);
    expect(mocks.raster).toHaveBeenCalledTimes(2);
    expect(mocks.raster.mock.calls.every(call => call[2].previous === false)).toBe(true);
    expect(satelliteCaption(map, "", false, now)).toContain("Desde 2026-09-16");
  });
  it("prepares an observable map for a small, slanted four-vertex parcel", async () => {
    const coordinates = [[20, -103], [20.0004, -102.9999], [20.0004, -102.9996], [20, -102.9997]];
    const o = options();
    o.parcel = { ...o.parcel, polygonCoordinates: coordinates };
    mocks.catalogue.mockResolvedValue([{ id: "small-parcel", date: "2026-11-16" }]);
    const values: (number | null)[][] = Array.from({ length: 5 }, () => Array(5).fill(.5));
    for (const [row, col] of [[0, 0], [1, 0], [3, 4], [4, 4], [2, 2]]) values[row][col] = null;
    mocks.raster.mockResolvedValue({
      ...raster(), imageId: "small-parcel", values, rows: 5, cols: 5, validPixels: 20,
      bbox: { minx: -103, miny: 20, maxx: -102.9996, maxy: 20.0004 },
    });
    const map = await prepareWhatsappSatelliteMap(o);
    expect(map.summary.mean).toBe(.5);
    expect(map.summary.areaHa).toBeGreaterThan(.09);
    expect(map.summary.areaHa).toBeLessThan(.2);
    expect(map.summary.percentages.unseen).toBeGreaterThan(0);
    expect(o.render).toHaveBeenCalledWith(expect.objectContaining({
      coordinates, raster: expect.objectContaining({ values }),
    }));
  });
  it("does not substitute a clear image older than thirty days for a cloudy recent scene", async () => {
    mocks.catalogue.mockResolvedValue([
      { id: "cloudy", date: "2026-11-16" }, { id: "too-old", date: "2026-10-01" },
    ]);
    mocks.raster.mockRejectedValue(new Error("Todos los píxeles son inválidos (nubes/sombras)"));
    await expect(prepareWhatsappSatelliteMap(options())).rejects.toThrow(/nubes|sombras/);
    expect(mocks.raster).toHaveBeenCalledTimes(1);
    expect(mocks.raster.mock.calls[0][2].candidateImageIds).toEqual(["cloudy"]);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("sends candidates once and uses the observable image selected on Earth Engine", async () => {
    mocks.catalogue.mockResolvedValue([
      { date: "2026-11-16", id: "masked-error" },
      { date: "2026-11-11", id: "all-clouds" },
      { date: "2026-11-05", id: "clear" },
    ]);
    mocks.raster.mockResolvedValue({ ...raster("2026-11-05"), imageId: "clear" });
    const map = await prepareWhatsappSatelliteMap(options());
    expect(map.imageId).toBe("clear");
    expect(map.summary.imageDate).toBe("2026-11-05");
    expect(mocks.raster).toHaveBeenCalledTimes(1);
    expect(mocks.raster.mock.calls[0][2].candidateImageIds).toEqual(["masked-error", "all-clouds", "clear"]);
    expect(map.summary.mean).toBe(.5);
  });
  it("reports clouds when every recent image is masked instead of sending filler data", async () => {
    mocks.raster.mockImplementation(async (_b, _index, o) => ({
      ...raster(o.imageId === "scene-before" ? "2026-11-11" : "2026-11-16"), validPixels: 0,
      values: [[null, null, null], [null, null, null], [null, null, null]],
      cloudMask: [[1, 1, 1], [1, 1, 1], [1, 1, 1]],
    }));
    await expect(prepareWhatsappSatelliteMap(options())).rejects.toThrow(/nubes|sombras/);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("does not blame clouds for insufficient boundary coverage without a cloud mask signal", async () => {
    mocks.raster.mockResolvedValue({ ...raster(), validPixels: 8,
      cloudMask: [[0, 0, 0], [0, 0, 0], [0, 0, 0]] });
    await expect(prepareWhatsappSatelliteMap(options())).rejects.toThrow("borde o la resolución");
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it.each([
    ["No hay imágenes Sentinel-2 disponibles", /No hay una imagen satelital reciente/],
    ["El servicio satelital agotó el tiempo de espera.", /tardó demasiado/],
    ["ECONNRESET", /servicio satelital no está disponible/],
    ["Imagen no verificable.", /imagen que no se pudo verificar/],
  ])("explains the concrete failure category for %s", async (error, expected) => {
    mocks.catalogue.mockRejectedValue(new Error(error));
    await expect(prepareWhatsappSatelliteMap(options())).rejects.toThrow(expected);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("does not hide opposing local changes behind a stable parcel average", () => {
    const before = raster("2026-11-11", [[.5, .5, .5], [.5, .5, .5], [.5, .5, .5]]);
    const after = raster("2026-11-16", [[.7, .7, .3], [.7, .5, .3], [.7, .3, .3]]);
    const summary = analyzeSatelliteRaster(after, coordinates, "ndvi", before);
    expect(summary.change?.direction).toBe("se mantuvo");
    expect(summary.change?.improvedLocations.length).toBeGreaterThan(0);
    expect(summary.change?.declinedLocations.length).toBeGreaterThan(0);
    const caption = satelliteCaption({ summary } as any, "", false, now);
    expect(caption).toContain("en conjunto se mantuvo");
    expect(caption).toContain("mejoró en");
    expect(caption).toContain("bajó en");
  });
  it("identifies a uniformly weak parcel as widespread, not just one arbitrary corner", () => {
    expect(analyzeSatelliteRaster(raster("2026-11-16", [[.1, .1, .1], [.1, .1, .1], [.1, .1, .1]]),
      coordinates, "ndvi").weakLocations).toEqual(["casi toda la parcela"]);
  });
  it("loads a verified scene from exact candidate IDs without computing an unsolicited comparison", async () => {
    const o = options();
    const map = await prepareWhatsappSatelliteMap(o);
    expect(mocks.catalogue).toHaveBeenCalledWith({ coordinates }, 1, expect.objectContaining({ allowSynthetic: false }));
    expect(mocks.raster).toHaveBeenCalledWith({ coordinates }, "ndvi",
      expect.objectContaining({ candidateImageIds: ["scene-latest", "scene-before"], previous: false, northUpGrid: true }));
    expect(mocks.raster).toHaveBeenCalledTimes(1);
    expect(map.summary.mean).toBeCloseTo(.5, 2);
    expect(map.summary.percentages.low).toBeCloseTo(33.3, 1);
    expect(map.summary.lowHa).toBeGreaterThan(3);
    expect(o.render.mock.calls[0][0]).toMatchObject({ raster: { imageDate: map.summary.imageDate }, summary: map.summary });
    expect(o.onIntent.mock.invocationCallOrder[0]).toBeLessThan(mocks.save.mock.invocationCallOrder[0]);
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ ownerId: "u", contentType: "image/png" }));
    expect(getWhatsappMetricsSnapshot().stages.map).toMatchObject({ count: 1, successRate: 1 });
  });
  it("does not query a provider or fabricate a polygon if the parcel has none", async () => {
    await expect(prepareWhatsappSatelliteMap({ ...options(), parcel: { ...parcel, polygonCoordinates: null } }))
      .rejects.toThrow("no tiene un contorno");
    expect(mocks.catalogue).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("fails explicitly when satellite service is unavailable, without generating replacement values", async () => {
    mocks.available.mockReturnValue(false);
    await expect(prepareWhatsappSatelliteMap(options())).rejects.toThrow("no usaré datos simulados");
    expect(mocks.catalogue).not.toHaveBeenCalled();
    expect(mocks.raster).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("rejects a simulated or empty catalogue rather than treating it as observed imagery", async () => {
    mocks.catalogue.mockResolvedValue([{ id: "mock_2026-11-16", date: "2026-11-16" }]);
    await expect(prepareWhatsappSatelliteMap(options())).rejects.toThrow("últimos 30 días");
    expect(mocks.raster).not.toHaveBeenCalled();
  });
  it("does not send an old image as a recent one", async () => {
    mocks.catalogue.mockResolvedValue([{ id: "old", date: "2026-09-01" }]);
    await expect(prepareWhatsappSatelliteMap(options())).rejects.toThrow("últimos 30 días");
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("reports clouded surface and its actual location without making it green", async () => {
    const o = options();
    const matrix = [[.2, .5, .5, null], [.5, .5, .5, .5], [.8, .8, .8, .8]];
    mocks.catalogue.mockResolvedValue([{ date: "2026-11-16", id: "partial" }]);
    mocks.raster.mockResolvedValue({ ...raster(), imageId: "partial", values: matrix, cols: 4, validPixels: 11 });
    const map = await prepareWhatsappSatelliteMap(o);
    expect(map.summary.percentages.unseen).toBeCloseTo(8.3, 1);
    expect(map.summary.unseenLocations).toContain("esquina noreste");
    const caption = satelliteCaption(map, "", false, now);
    expect(caption).toContain("Sin ver 8.3%");
    expect(caption).toContain("esquina noreste");
    const pct = map.summary.percentages;
    expect(pct.low + pct.medium + pct.high + pct.unseen).toBeCloseTo(100, 0);
  });
  it("uses only jointly observed pixels for a change map and warns about partial overlap", async () => {
    const o = options({ index: "ndvi", date: null, compare: true });
    mocks.raster.mockImplementation(async (_b, _index, opts) => {
      if (opts.previous) return {
        ...raster("2026-11-11"), rows: 4, cols: 4, validPixels: 15,
        values: [[null, .3, .3, .3], [.3, .3, .3, .3], [.3, .3, .3, .3], [.3, .3, .3, .3]],
      };
      return { ...raster(), rows: 4, cols: 4, validPixels: 16, values: Array.from({ length: 4 }, () => [.5, .5, .5, .5]) };
    });
    const map = await prepareWhatsappSatelliteMap(o);
    expect(map.summary.change?.direction).toBe("mejoró");
    expect(map.summary.change?.comparedPct).toBeCloseTo(93.8, 1);
    expect(o.render.mock.calls[0][0]).toMatchObject({ compare: true, previous: { imageDate: "2026-11-11" } });
    expect(satelliteCaption(map, "", false, now)).toContain("visible en ambas fechas");
  });
  it("delivers the current map when a requested previous image does not exist", async () => {
    mocks.catalogue.mockResolvedValue([{ id: "scene-latest", date: "2026-11-16" }]);
    const map = await prepareWhatsappSatelliteMap(options({ index: "ndvi", date: null, compare: true }));
    expect(map.imageId).toBe("scene-latest");
    expect(map.compare).toBe(false);
    expect(map.summary.change).toBeNull();
    expect(mocks.save).toHaveBeenCalledOnce();
  });
  it("uses a ledger summary as a reference without pretending it is a pixel comparison", async () => {
    const o = options();
    o.storage.getActiveFieldLogs = vi.fn().mockResolvedValue([{
      structuredData: { source: "satellite", satellite: { imageDate: "2026-11-10", index: "ndvi", mean: .35 } },
    }]);
    const map = await prepareWhatsappSatelliteMap(o);
    expect(mocks.raster).toHaveBeenCalledOnce();
    expect(map.summary.change).toBeNull();
    expect(map.summary.reference).toEqual({
      imageDate: "2026-11-10", mean: .35, source: "ledger", spatialComparison: false,
    });
    expect(satelliteCaption(map, "", false, now)).toContain("Antecedente de bitácora del 2026-11-10");
    expect(satelliteCaption(map, "", false, now)).toContain("Sin comparación por zonas");
  });
  it("starts the requested current and previous raster evaluations in parallel", async () => {
    let finishCurrent!: (value: any) => void, finishPrevious!: (value: any) => void;
    const current = new Promise(resolve => { finishCurrent = resolve; });
    const previous = new Promise(resolve => { finishPrevious = resolve; });
    mocks.raster.mockImplementation((_b, _index, opts) => opts.previous ? previous : current);
    const pending = prepareWhatsappSatelliteMap(options({ index: "ndvi", date: null, compare: true }));
    try {
      await vi.waitFor(() => expect(mocks.raster).toHaveBeenCalledTimes(2));
      expect(mocks.raster.mock.calls.map(call => call[2].previous)).toEqual([false, true]);
    } finally {
      finishCurrent(raster()); finishPrevious(raster("2026-11-11"));
    }
    expect((await pending).compare).toBe(true);
  });
  it("delivers the current PNG instead of failing when optional comparison times out", async () => {
    vi.useFakeTimers();
    const logger = vi.spyOn(console, "info").mockImplementation(() => {});
    let release!: (value: any) => void;
    mocks.raster.mockImplementation(async (_b, _index, opts) =>
      opts.previous ? new Promise(resolve => { release = resolve; }) : raster());
    try {
      const o = options({ index: "ndvi", date: null, compare: true });
      const pending = prepareWhatsappSatelliteMap(o);
      await vi.advanceTimersByTimeAsync(15_001);
      const map = await pending;
      expect(map.compare).toBe(false);
      expect(map.summary.change).toBeNull();
      expect(map.imageId).toBe("scene-latest");
      expect(o.render).toHaveBeenCalledWith(expect.objectContaining({ previous: null, compare: false }));
      expect(logger).toHaveBeenCalledWith("[whatsapp] map stage",
        expect.objectContaining({ stage: "previous", durationMs: 15_000, success: false }));
    } finally {
      release?.(raster("2026-11-11"));
      await Promise.resolve();
      vi.useRealTimers();
      logger.mockRestore();
    }
  });
  it("shares catalogue and current raster cache with the background series refresh", async () => {
    const o = options();
    o.storage.saveWhatsappSatelliteSeries = vi.fn().mockResolvedValue(undefined);
    await prepareWhatsappSatelliteMap(o);
    expect(mocks.catalogue).toHaveBeenCalledOnce();
    expect(mocks.raster).toHaveBeenCalledOnce();
    scheduleWhatsappSatelliteRefresh(o.storage, parcel, [], now);
    await waitForWhatsappSatelliteRefresh();
    expect(mocks.catalogue).toHaveBeenCalledOnce();
    // Current scene is reused; only the second historical scene needs a request.
    expect(mocks.raster).toHaveBeenCalledTimes(2);
    expect(mocks.raster.mock.calls[1][2].imageId).toBe("scene-before");
    expect(o.storage.saveWhatsappSatelliteSeries).toHaveBeenCalledOnce();
  });
  it("does not launch a refresh during a map and does not consume its future refresh slot", async () => {
    let release!: (value: any) => void;
    mocks.catalogue.mockReturnValue(new Promise(resolve => { release = resolve; }));
    const o = options();
    o.storage.saveWhatsappSatelliteSeries = vi.fn().mockResolvedValue(undefined);
    const pending = prepareWhatsappSatelliteMap(o);
    await vi.waitFor(() => expect(mocks.catalogue).toHaveBeenCalledOnce());
    scheduleWhatsappSatelliteRefresh(o.storage, parcel, [], now);
    expect(mocks.raster).not.toHaveBeenCalled();
    release([{ id: "scene-latest", date: "2026-11-16" }]);
    await pending;
    scheduleWhatsappSatelliteRefresh(o.storage, parcel, [], now);
    await waitForWhatsappSatelliteRefresh();
    expect(mocks.catalogue).toHaveBeenCalledOnce();
    expect(mocks.raster).toHaveBeenCalledOnce();
    expect(o.storage.saveWhatsappSatelliteSeries).toHaveBeenCalledOnce();
  });
  it("deduplicates simultaneous map catalogue and raster requests", async () => {
    await Promise.all([prepareWhatsappSatelliteMap(options()), prepareWhatsappSatelliteMap(options())]);
    expect(mocks.catalogue).toHaveBeenCalledOnce();
    expect(mocks.raster).toHaveBeenCalledOnce();
  });
  it("logs correlated durations for catalogue, raster, skipped comparison and PNG", async () => {
    const logger = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      await prepareWhatsappSatelliteMap({ ...options(), requestId: "opaque-request" });
      const stages = logger.mock.calls.filter(call => call[0] === "[whatsapp] map stage").map(call => call[1]);
      expect(stages.map(s => s.stage)).toEqual(expect.arrayContaining(["catalogue", "raster", "previous", "png"]));
      expect(stages).toEqual(expect.arrayContaining([
        expect.objectContaining({ requestId: "opaque-request", stage: "previous", skipped: true }),
      ]));
      expect(stages.every(s => s.requestId === "opaque-request" && s.durationMs >= 0)).toBe(true);
    } finally { logger.mockRestore(); }
  });
  it("selects the nearest real historical image and warns when it is over ten days old", async () => {
    mocks.catalogue.mockResolvedValue([
      { id: "oct15", date: "2026-10-15" }, { id: "oct20", date: "2026-10-20" },
    ]);
    mocks.raster.mockResolvedValue({ ...raster("2026-10-15"), imageId: "oct15" });
    const map = await prepareWhatsappSatelliteMap(options({ index: "ndvi", date: "2026-10-17", compare: false }));
    expect(map.summary.imageDate).toBe("2026-10-15");
    expect(satelliteCaption(map, "", false, now)).toContain("más de 10 días");
    expect(satelliteCaption(map, "Revisa la uniformidad en campo.", false, now))
      .toContain("los hechos posteriores no explican el estado de esa imagen");
  });
  it("reuses the private PNG and statistics on the same selection without requesting another raster", async () => {
    const o = options(), artifact = await prepareWhatsappSatelliteMap(o);
    o.storage.getWhatsappMapArtifact.mockResolvedValue(artifact);
    mocks.raster.mockClear(); o.render.mockClear(); mocks.save.mockClear();
    expect(await prepareWhatsappSatelliteMap(o)).toEqual(artifact);
    expect(mocks.download).toHaveBeenCalled();
    expect(mocks.raster).not.toHaveBeenCalled();
    expect(o.render).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("reuses the same image when a repeat names its exact date instead of saying latest", async () => {
    const o = options(), artifact = await prepareWhatsappSatelliteMap(o);
    o.storage.getWhatsappMapArtifact.mockImplementation(async (_u: string, _p: string, key: string) =>
      key === artifact.renderKey ? artifact : undefined);
    mocks.raster.mockClear(); o.render.mockClear();
    const again = await prepareWhatsappSatelliteMap({ ...o, request: { index: "ndvi", date: "2026-11-16", compare: false } });
    expect(again.objectPath).toBe(artifact.objectPath);
    expect(mocks.raster).not.toHaveBeenCalled();
    expect(o.render).not.toHaveBeenCalled();
  });
  it("persists a satellite-origin observation with the exact numerical summary and private evidence", async () => {
    const artifact = await prepareWhatsappSatelliteMap(options());
    const storage = { saveAutomaticFieldLog: vi.fn().mockResolvedValue({}) } as any;
    await recordSentSatelliteMap(storage, "u", "p", "incoming-1", artifact);
    const entry = storage.saveAutomaticFieldLog.mock.calls[0][0];
    expect(entry).toMatchObject({ sourceProviderMessageId: "incoming-1:satellite",
      structuredData: { source: "satellite", satellite: artifact.summary },
      evidence: [{ path: artifact.objectPath, mimeType: "image/png" }] });
    expect(entry.occurredAt.toISOString()).toContain(artifact.summary.imageDate);
    expect(fieldLogOrigin({ status: "confirmed", structuredData: entry.structuredData })).toBe("satellite");
  });
  it("refuses parcels with fewer than nine native NDMI pixels", async () => {
    const small = coordinates.map(([lat, lon]) => [20 + (lat - 20) * .15, -103 + (lon + 103) * .15]);
    await expect(prepareWhatsappSatelliteMap({ ...options({ index: "ndmi", date: null, compare: false }),
      parcel: { ...parcel, polygonCoordinates: small } })).rejects.toThrow("demasiado pequeña");
    expect(mocks.raster).not.toHaveBeenCalled();
  });
  it("does not send the preparing message for a fast generation", async () => {
    const onSlow = vi.fn();
    await prepareWhatsappSatelliteMap({ ...options(), onSlow });
    expect(onSlow).not.toHaveBeenCalled();
  });
  it("sends the preparing message only once after four seconds while an actual map is pending", async () => {
    vi.useFakeTimers();
    try {
      const o = options(), onSlow = vi.fn().mockResolvedValue(undefined);
      let finish!: (value: any) => void;
      mocks.catalogue.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
      const pending = prepareWhatsappSatelliteMap({ ...o, onSlow });
      await vi.advanceTimersByTimeAsync(3999);
      expect(onSlow).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2);
      expect(onSlow).toHaveBeenCalledTimes(1);
      finish([{ id: "scene-latest", date: "2026-11-16" }]);
      await pending;
    } finally { vi.useRealTimers(); }
  });
  it("renders a real static phone-sized PNG from the exact supplied grid and polygon", async () => {
    const r = raster(), summary = analyzeSatelliteRaster(r, coordinates, "ndvi");
    const png = await renderSatellitePng({ raster: r, summary, coordinates, compare: false, name: "PRUEBA SINTÉTICA · NO ENVIAR" });
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.readUInt32BE(16)).toBe(1000);
    expect(png.readUInt32BE(20)).toBe(1100);
  }, 20000);
});

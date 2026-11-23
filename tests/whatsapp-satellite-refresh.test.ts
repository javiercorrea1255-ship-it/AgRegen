import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../server/services/parcel-climatology", () => ({ getParcelClimatology: vi.fn().mockResolvedValue(null) }));

const mocks = vi.hoisted(() => ({
  available: vi.fn(), catalogue: vi.fn(), raster: vi.fn(),
}));
vi.mock("../server/services/earth-engine", () => ({
  isGEEAvailable: mocks.available,
  getAvailableSentinelImages: mocks.catalogue,
  getIndexRaster: mocks.raster,
}));
vi.mock("../server/services/weather", () => ({
  getFullWeatherData: vi.fn().mockResolvedValue({ current: null, forecast: [] }),
  getRecentObservedWeather: vi.fn().mockResolvedValue(null),
}));
vi.mock("../server/services/market-prices", () => ({
  getSniimPrice: vi.fn().mockResolvedValue(null),
}));

import { buildWhatsappParcelCard, clearWhatsappWeatherCache } from "../server/services/whatsapp-context";
import { clearWhatsappSatelliteRefresh, waitForWhatsappSatelliteRefresh } from "../server/services/whatsapp-satellite-refresh";

const now = new Date("2026-11-17T12:00:00Z");
const coordinates = [[20, -103], [20.003, -103], [20.003, -102.997], [20, -102.997]];
const parcel = { id: "p", userId: "u", name: "Refresh test", crop: "maíz", area: "10.46",
  latitude: "20", longitude: "-103", polygonCoordinates: coordinates } as any;
const scenes = [{ id: "real-scene", date: "2026-11-16", cloudPercentage: 0 }];
function fixture(date = "2026-11-01T12:00:00Z") {
  const observations = [{ date: new Date(date), ndvi: "0.2" }];
  const storage = {
    getLatestCropCycleDetail: vi.fn().mockResolvedValue(null),
    getAlertsByParcel: vi.fn().mockResolvedValue([]),
    getLatestSoilAnalysis: vi.fn().mockResolvedValue(null),
    getWaterAnalysisByParcel: vi.fn().mockResolvedValue([]),
    getPlantTissueAnalysisByParcel: vi.fn().mockResolvedValue([]),
    getParcelData: vi.fn(async () => [...observations].sort((a, b) => b.date.getTime() - a.date.getTime())),
    getActiveFieldLogs: vi.fn().mockResolvedValue([]),
    getProductionCostsByParcel: vi.fn().mockResolvedValue([]),
    saveWhatsappSatelliteSeries: vi.fn(async (_user: string, _parcel: string, _coordinates: unknown,
      fresh: { date: string; ndvi: number; imageId: string }[]) => {
      observations.push(...fresh.map(p => ({ date: new Date(`${p.date}T12:00:00Z`), ndvi: String(p.ndvi) })));
    }),
  };
  const card = () => buildWhatsappParcelCard(storage as any, parcel, "u", "¿Cómo va mi cultivo?", []);
  return { storage, observations, card };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  vi.clearAllMocks();
  clearWhatsappWeatherCache();
  clearWhatsappSatelliteRefresh();
  mocks.available.mockReturnValue(true);
  mocks.catalogue.mockResolvedValue(scenes);
  mocks.raster.mockResolvedValue({
    values: [[.7, .7, .7], [.7, .7, .7], [.7, .7, .7]],
    bbox: { minx: -103, miny: 20, maxx: -102.997, maxy: 20.003 },
    imageDate: "2026-11-16", indexType: "ndvi", rows: 3, cols: 3, validPixels: 9,
  });
});
afterEach(async () => {
  await waitForWhatsappSatelliteRefresh();
  clearWhatsappSatelliteRefresh();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Background refresh of the WhatsApp satellite series", () => {
  it("returns the current card while a stale-series refresh is blocked, then updates the next query", async () => {
    const f = fixture();
    let release!: (value: typeof scenes) => void;
    mocks.catalogue.mockReturnValue(new Promise<typeof scenes>(resolve => { release = resolve; }));
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const current = await Promise.race([
        f.card(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error("Current response waited for satellite refresh")), 1000);
        }),
      ]);
      // The provider is still unresolved: the response cannot have waited for it.
      expect(current.text).toContain('"ndvi":"0.2"');
      expect(f.storage.saveWhatsappSatelliteSeries).not.toHaveBeenCalled();
      expect(mocks.catalogue).toHaveBeenCalledWith({ coordinates }, 1, {
        allowSynthetic: false, dateFrom: "2026-10-18T12:00:00.000Z", dateTo: now.toISOString(),
      });
      await f.card();
      expect(mocks.catalogue).toHaveBeenCalledTimes(1); // Deduplicate the in-flight job.
      release(scenes);
      await waitForWhatsappSatelliteRefresh();
      expect(f.storage.saveWhatsappSatelliteSeries).toHaveBeenCalledWith("u", "p", coordinates, [
        { date: "2026-11-16", ndvi: .7, imageId: "real-scene" },
      ]);
      expect(mocks.raster).toHaveBeenCalledWith({ coordinates }, "ndvi", {
        imageId: "real-scene", northUpGrid: true, targetMaxPixels: 2500,
      });
      const next = await f.card();
      expect(next.text).toContain('"ndvi":"0.7"');
      expect(next.text).toContain("2026-11-16");
      expect(mocks.catalogue).toHaveBeenCalledTimes(1);
    } finally {
      clearTimeout(timeout);
      release(scenes);
      await waitForWhatsappSatelliteRefresh();
    }
  });

  it.each(["2026-11-16T12:00:00Z", "2026-11-07T12:00:00Z"])(
    "does not refresh an observation no older than ten days: %s", async date => {
      const f = fixture(date);
      await f.card();
      await waitForWhatsappSatelliteRefresh();
      expect(mocks.catalogue).not.toHaveBeenCalled();
      expect(mocks.raster).not.toHaveBeenCalled();
      expect(f.storage.saveWhatsappSatelliteSeries).not.toHaveBeenCalled();
    });

  it.each(["unavailable", "catalogue-error", "raster-error", "empty-catalogue", "synthetic-scene", "cloud-only"])(
    "retains the stored observation without saving filler data when %s", async failure => {
      const f = fixture();
      vi.spyOn(console, "warn").mockImplementation(() => {});
      if (failure === "unavailable") mocks.available.mockReturnValue(false);
      if (failure === "catalogue-error") mocks.catalogue.mockRejectedValue(new Error("provider unavailable"));
      if (failure === "raster-error") mocks.raster.mockRejectedValue(new Error("provider unavailable"));
      if (failure === "empty-catalogue") mocks.catalogue.mockResolvedValue([]);
      if (failure === "synthetic-scene") mocks.catalogue.mockResolvedValue([{ ...scenes[0], id: "mock_scene" }]);
      if (failure === "cloud-only") mocks.raster.mockResolvedValue({
        values: [[null]], validPixels: 0, imageDate: scenes[0].date, indexType: "ndvi",
      });
      const current = await f.card();
      await waitForWhatsappSatelliteRefresh();
      expect(current.text).toContain('"ndvi":"0.2"');
      expect(f.observations).toHaveLength(1);
      expect(f.storage.saveWhatsappSatelliteSeries).not.toHaveBeenCalled();
      if (failure === "unavailable") expect(mocks.catalogue).not.toHaveBeenCalled();
      if (failure === "synthetic-scene") expect(mocks.raster).not.toHaveBeenCalled();
    });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ weather: vi.fn(), market: vi.fn(), recent: vi.fn() }));
vi.mock("../server/services/weather", () => ({ getFullWeatherData: mocks.weather, getRecentObservedWeather: mocks.recent }));
vi.mock("../server/services/market-prices", () => ({ getSniimPrice: mocks.market }));
import { buildWhatsappParcelCard, clearWhatsappWeatherCache } from "../server/services/whatsapp-context";
import { recordSentSatelliteMap } from "../server/services/whatsapp-satellite";

const parcel = { id: "p", crop: "maíz", latitude: "20", longitude: "-103", name: "Lote", area: "9" } as any;
function storage() {
  return {
    getLatestCropCycleDetail: vi.fn().mockResolvedValue({ id: "cycle", cycleYear: 2026,
      cycleSeason: "primavera-verano", totalPlannedCost: "1000" }),
    getAlertsByParcel: vi.fn().mockResolvedValue([{ title: "Helada", severity: "high", description: "Riesgo" }]),
    getLatestSoilAnalysis: vi.fn().mockResolvedValue({ ph: "6" }),
    getWaterAnalysisByParcel: vi.fn().mockResolvedValue([]),
    getPlantTissueAnalysisByParcel: vi.fn().mockResolvedValue([]),
    getParcelData: vi.fn().mockResolvedValue([
      { date: "2026-06-02", ndvi: "0.8", evi: "0.4" },
      { date: "2026-06-01", ndvi: "0.6", evi: "0.5" },
    ]),
    getActiveFieldLogs: vi.fn().mockResolvedValue([]),
    getProductionCostsByParcel: vi.fn().mockResolvedValue([]),
  } as any;
}
beforeEach(() => {
  vi.clearAllMocks(); clearWhatsappWeatherCache();
  mocks.weather.mockResolvedValue({ current: { temperature: 25 }, forecast: [] });
  mocks.recent.mockResolvedValue({ from: "2026-05-26", to: "2026-06-01", rainMm: 12, tempMean: 25 });
  mocks.market.mockResolvedValue(null);
});
describe("Universal compact parcel card", () => {
  it("reuses external context and skips unused thermal history while reflecting fresh soil edits", async () => {
    const s = storage();
    await buildWhatsappParcelCard(s, parcel, "u", "¿Cómo está el cultivo?", []);
    s.getLatestSoilAnalysis.mockResolvedValue({ ph: "7.15", organicMatter: ".87" });
    const fresh = await buildWhatsappParcelCard(s, parcel, "u", "Resume mi suelo", []);
    expect(mocks.weather).toHaveBeenCalledTimes(1);
    expect(mocks.market).toHaveBeenCalledTimes(1);
    expect(mocks.weather.mock.calls[0][4]).toMatchObject({ includeThermal: false });
    expect(fresh.text).toContain("7.15");
    expect(s.getLatestSoilAnalysis).toHaveBeenCalledTimes(2);
  });
  it("keeps the newest image summary after a recent map is delivered and then a historical map", async () => {
    const s = storage();
    const logs: any[] = [];
    // Deliberately return delivery order, with the last request first. Selection
    // must use satellite.imageDate rather than relying on storage ordering.
    s.saveAutomaticFieldLog = vi.fn(async (entry: any) => {
      logs.unshift({ ...entry, status: "confirmed" });
      return entry;
    });
    s.getActiveFieldLogs.mockImplementation(async () => logs);
    const artifact = (imageDate: string, mean: number, weakLocation: string) => ({
      objectPath: "/objects/test-map.png", byteLength: 100, compare: false,
      summary: { index: "ndvi", imageDate, mean, level: mean > .6 ? "alto" : "bajo",
        percentages: { low: 10, medium: 20, high: 70, unseen: 0 }, lowHa: .9,
        weakLocations: [weakLocation], unseenLocations: [], change: null },
    }) as any;
    const satelliteBlock = (text: string) => JSON.parse(
      text.split("(d) Satélite: últimas seis observaciones\n")[1].split("\n\n(e)")[0],
    ).latestSentMap;
    await recordSentSatelliteMap(s, "u", "p", "recent-map", artifact("2026-11-16", .82, "esquina noreste"));
    expect(satelliteBlock((await buildWhatsappParcelCard(s, parcel, "u", "MAPA", [])).text))
      .toMatchObject({ imageDate: "2026-11-16", mean: .82 });
    await recordSentSatelliteMap(s, "u", "p", "historical-map", artifact("2026-10-01", .23, "orilla sur"));
    expect(logs[0].structuredData.satellite.imageDate).toBe("2026-10-01");
    expect(logs).toHaveLength(2); // Keep both observations in the ledger.
    const card = await buildWhatsappParcelCard(s, parcel, "u", "¿Cómo está mi parcela?", []);
    expect(satelliteBlock(card.text)).toMatchObject({
      imageDate: "2026-11-16", mean: .82, weakLocations: ["esquina noreste"], mapMode: "index",
    });
    expect(s.saveAutomaticFieldLog).toHaveBeenCalledTimes(2);
  });
  it("includes the last sent satellite summary even if it is older than the fifteen recent reports", async () => {
    const s = storage();
    s.getActiveFieldLogs.mockResolvedValue([
      ...Array.from({ length: 16 }, (_, i) => ({ id: `l${i}`, activityType: "labor", structuredData: {} })),
      { id: "map", activityType: "observación satelital", structuredData: {
        source: "satellite", satellite: { imageDate: "2026-05-30", mean: .41, weakLocations: ["esquina noreste"] },
      } },
    ]);
    const card = await buildWhatsappParcelCard(s, parcel, "u", "¿ya mejoró esa esquina?", []);
    expect(card.text).toContain('"latestSentMap"');
    expect(card.text).toContain('"mean":0.41');
    expect(card.text).toContain("esquina noreste");
  });
  it.each(["¿Lloverá?", "¿Cuánto llevo gastado?", "¿Cómo está la humedad del suelo?"])(
    "retains all seven blocks for %s", async query => {
      const s = storage();
      const card = await buildWhatsappParcelCard(s, parcel, "u", query, []);
      const labels = ["(a)", "(b)", "(c)", "(d)", "(e)", "(f)", "(g)"];
      let prior = -1;
      for (const label of labels) {
        const index = card.text.indexOf(label);
        expect(index).toBeGreaterThan(prior); prior = index;
      }
      expect(card.text).toContain("Helada");
      expect(card.text).toContain('"trendNDVI":"sube"');
      expect(card.text).toContain('"trendEVI":"baja"');
      expect(s.getActiveFieldLogs).toHaveBeenCalledWith("u", "p");
    },
  );
  it("caches weather for 30 minutes per parcel", async () => {
    const s = storage();
    await buildWhatsappParcelCard(s, parcel, "u", "clima", []);
    await buildWhatsappParcelCard(s, parcel, "u", "riego", []);
    expect(mocks.weather).toHaveBeenCalledTimes(1);
    await buildWhatsappParcelCard(s, { ...parcel, id: "another" }, "u", "riego", []);
    expect(mocks.weather).toHaveBeenCalledTimes(2);
  });
  it("includes 15 recent reports plus older question-relevant reports", async () => {
    const s = storage();
    s.getActiveFieldLogs.mockResolvedValue(Array.from({ length: 20 }, (_, i) => ({
      id: `event-${i}`, occurredAt: new Date("2026-06-01"), createdAt: new Date("2026-06-01"),
      activityType: "labranza", status: "confirmed",
      structuredData: { observations: i === 19 ? "urea histórica" : "sin observaciones", items: [] },
    })));
    const card = await buildWhatsappParcelCard(s, parcel, "u", "urea", []);
    for (let i = 0; i < 15; i++) expect(card.text).toContain(`"id":"event-${i}"`);
    expect(card.text).toContain('"id":"event-19"');
    expect(card.text).not.toContain('"id":"event-18"');
  });
  it("keeps missing-data blocks and the six latest messages inside the fixed budget", async () => {
    const history = Array.from({ length: 10 }, (_, i) => ({ role: "user", content: `msg${i} ${"x".repeat(5000)}` }));
    const card = await buildWhatsappParcelCard(storage(), parcel, "u", "consulta", history);
    expect(card.text.length).toBeLessThan(19500);
    expect(card.text).not.toContain("msg3 ");
    expect(card.text).toContain("msg4 ");
    expect(card.text).toContain("msg9 ");
    expect(card.text).toContain('"market":null');
  });
  it("always includes full current/prior soil, real lab microbiology, drought, cycle and combined costs for fertilizer questions", async () => {
    const s = storage();
    const current = { id: "s1", analysisDate: "2026-02-13", nitrogenTotal: "0.000", ph: "7.18",
      organicMatter: ".87", phosphorus: "16.74", potassium: "93.08", calcium: "832.24", magnesium: "68.78",
      sulfur: "7.04", iron: "9.92", zinc: "9.92", manganese: "2.11", copper: ".13", boron: "5.73",
      cec: "5.02", sand: "78.36", silt: "9.28", clay: "12.36", electricConductivity: ".21",
      notes: "N inorgánico 20.08 mg/kg. Boro muy alto." };
    s.getSoilAnalysisByParcel = vi.fn().mockResolvedValue([current, { ...current, id: "duplicate" },
      { ...current, id: "previous", analysisDate: "2025-02-13", ph: "6.8" }]);
    s.getSoilBiologyByParcel = vi.fn().mockResolvedValue([{ sampleDate: "2026-02-14", dataSource: "lab",
      trichodermaCfu: "1000", fusariumCfu: "100", bacillusCfu: "500", microbiologyMethod: "Conteo en placa",
      nitrogenFixersStatus: "not_analyzed" }]);
    s.getAlertsByParcel.mockResolvedValue([{ title: "Sequía activa", description: "Déficit de lluvia", severity: "high" }]);
    s.getLatestCropCycleDetail.mockResolvedValue({ id: "cycle", totalPlannedCost: "1500", expectedYieldTon: "8",
      targetPricePerTon: "6000", estimatedHarvestDate: "2026-12-15" });
    s.getProductionCostsByParcel.mockResolvedValue([{ id: "c", category: "labor", name: "Labor", totalCost: "100", cycleDetailId: "cycle" }]);
    s.getActiveFieldLogs.mockResolvedValue([{ id: "f", userId: "u", parcelId: "p", cycleDetailId: "cycle",
      status: "confirmed", occurredAt: new Date(), structuredData: { registration: "automatic", items: [
        { category: "input", name: "urea", quantity: 50, unit: "kg", cost: 900, currency: "MXN" }] } }]);
    const card = await buildWhatsappParcelCard(s, parcel, "u", "¿Qué fertilización necesita el maíz?", []);
    const lab = JSON.parse(card.text.split("(c) Análisis recientes\n")[1].split("\n\n(d)")[0]);
    expect(lab.soil).toMatchObject({ ph: 7.18, nitrogenInorganic: 20.08, nitrogenTotal: null, sulfur: 7.04,
      iron: 9.92, zinc: 9.92, manganese: 2.11, copper: .13, boron: 5.73, cec: 5.02, sand: 78.36 });
    expect(lab.previousSoil.ph).toBe(6.8);
    expect(lab.microbiology).toMatchObject({ trichodermaFusariumRatio: 10, method: "Conteo en placa" });
    expect(card.text).toContain("Sequía activa"); expect(card.text).toContain("2026-12-15");
    expect(card.economy).toMatchObject({ byCurrency: { MXN: { total: 1000 } }, plannedMXN: 1500, differenceMXN: -500 });
  });
  it("bounds long observations without losing the measured nutrient fields or plate report", async () => {
    const s = storage();
    s.getSoilAnalysisByParcel = vi.fn().mockResolvedValue([
      { analysisDate: "2026-02-13", boron: "5.73", sand: "78.36", notes: "x".repeat(30000) },
      { analysisDate: "2025-02-13", boron: "4", notes: "y".repeat(30000) }]);
    s.getSoilBiologyByParcel = vi.fn().mockResolvedValue([{ sampleDate: "2026-02-14", dataSource: "lab",
      bacillusCfu: "500", notes: "z".repeat(30000) }]);
    const card = await buildWhatsappParcelCard(s, parcel, "u", "abonos", []);
    const lab = JSON.parse(card.text.split("(c) Análisis recientes\n")[1].split("\n\n(d)")[0]);
    expect(lab.soil).toMatchObject({ boron: 5.73, sand: 78.36, notesLimited: true });
    expect(lab.previousSoil.notesLimited).toBe(true); expect(lab.microbiology.bacillusCfu).toBe(500);
    expect(card.text.length).toBeLessThan(30000);
  });
});

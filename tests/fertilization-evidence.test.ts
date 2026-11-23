import { describe, expect, it } from "vitest";
import { insertSoilAnalysisSchema, insertSoilBiologySchema } from "../shared/schema";
import { distinctSoilAnalyses, soilEvidence, microbiologyEvidence, latestLabMicrobiology,
  nutritionResponseSafety, validAgronomicAlerts, MICROBIOLOGY_CAVEAT } from "../shared/agronomic-evidence";
import { buildContextPrompt } from "../server/services/ai-assistant";

const soil = { id: "soil", analysisDate: new Date("2026-02-13"), labName: "Laboratorio",
  organicMatter: ".87", nitrogenTotal: "0.000", nitrogenInorganic: null, phosphorus: "16.74",
  potassium: "93.08", calcium: "832.24", magnesium: "68.78", sulfur: "7.04",
  iron: "9.92", zinc: "9.92", manganese: "2.11", copper: ".13", boron: "5.73",
  ph: "7.18", electricConductivity: ".21", cec: "5.02", sand: "78.36", silt: "9.28", clay: "12.36",
  notes: "N inorgánico 20.08 mg/kg (KCl 2N; medio). Boro muy alto. No es N total." };

describe("soil and plate culture evidence", () => {
  it("keeps two decimal pH/texture and separates inorganic mg/kg from total percent", () => {
    const parsed = insertSoilAnalysisSchema.parse({ parcelId: "p", analysisDate: "2026-02-13",
      ph: "7.18", sand: "78.36", silt: "9.28", clay: "12.36", nitrogenInorganic: "20.08", nitrogenTotal: "" });
    expect(parsed).toMatchObject({ ph: 7.18, sand: 78.36, silt: 9.28, clay: 12.36, nitrogenInorganic: 20.08, nitrogenTotal: null });
  });
  it("interprets the inorganic result in the report without inventing total N or changing the row", () => {
    expect(soilEvidence(soil)).toMatchObject({ nitrogenTotal: null, nitrogenInorganic: 20.08,
      nitrogenTotalCaveat: expect.stringContaining("no implica ausencia"), inorganicSource: expect.stringContaining("observaciones") });
    expect(soil.nitrogenTotal).toBe("0.000");
    expect(soil.nitrogenInorganic).toBeNull();
    expect(soilEvidence({ ...soil, nitrogenInorganic: "22.12" })?.nitrogenInorganic).toBe(22.12);
  });
  it("deduplicates dates/numeric values, including report-derived N, preserving notes and input rows", () => {
    const duplicate = { ...soil, id: "copy", ph: "7.1800", nitrogenInorganic: "20.08", notes: "Otra observación" };
    const previous = { ...soil, id: "prior", analysisDate: new Date("2025-02-13"), ph: "6.8" };
    const result = distinctSoilAnalyses([previous, soil, duplicate]);
    expect(result).toHaveLength(2); expect(result[0].notes).toContain("Otra observación");
    expect(result[1].id).toBe("prior"); expect(soil.notes).not.toContain("Otra observación");
  });
  it("accepts a complete optional plate report and preserves undetected versus unanalysed", () => {
    expect(insertSoilBiologySchema.parse({ parcelId: "p", userId: "u", sampleDate: "2026-02-13",
      labFolio: "F-1", labName: "Laboratorio", microbiologyMethod: "Conteo en placa",
      trichodermaCfu: "2000", fusariumCfu: "100", bacillusCfu: "500000",
      metarhiziumStatus: "not_detected", beauveriaStatus: "not_analyzed",
      nitrogenFixersStatus: "detected" })).toMatchObject({ trichodermaCfu: 2000, fusariumCfu: 100, bacillusCfu: 500000,
        metarhiziumStatus: "not_detected", beauveriaStatus: "not_analyzed", nitrogenFixersStatus: "detected" });
  });
  it.each(["detected", "not_detected", "not_analyzed"])("accepts N fixer state %s", status => {
    expect(insertSoilBiologySchema.parse({ parcelId: "p", userId: "u", sampleDate: "2026-02-13",
      nitrogenFixersStatus: status }).nitrogenFixersStatus).toBe(status);
  });
  it.each(["metarhizium", "beauveria"])("validates counted and missing/contradictory %s results", name => {
    const base = { parcelId: "p", userId: "u", sampleDate: "2026-02-13" };
    expect(insertSoilBiologySchema.safeParse({ ...base, [`${name}Status`]: "counted" }).success).toBe(false);
    expect(insertSoilBiologySchema.safeParse({ ...base, [`${name}Status`]: "not_detected", [`${name}Cfu`]: 1 }).success).toBe(false);
    expect(insertSoilBiologySchema.safeParse({ ...base, [`${name}Status`]: "counted", [`${name}Cfu`]: 0 }).success).toBe(true);
  });
  it("does not present satellite estimates, negative or non-numeric counts as lab plate results", () => {
    const base = { parcelId: "p", userId: "u", sampleDate: "2026-02-13" };
    for (const invalid of [{ trichodermaCfu: -1 }, { bacillusCfu: "desconocido" },
      { dataSource: "satellite", trichodermaCfu: 3 }])
      expect(insertSoilBiologySchema.safeParse({ ...base, ...invalid }).success).toBe(false);
    expect(insertSoilBiologySchema.parse(base).trichodermaCfu).toBeUndefined();
  });
  it.each([[200, 100, 2], [0, 100, 0], [100, 0, null], [null, 10, null], [100, null, null]])(
    "calculates ratio for %s / %s as %s", (trichodermaCfu, fusariumCfu, ratio) => {
      expect(microbiologyEvidence({ trichodermaCfu, fusariumCfu })?.trichodermaFusariumRatio).toBe(ratio);
      expect(MICROBIOLOGY_CAVEAT).toContain("no identifican patógenos ni miden fijación");
    });
  it("keeps the most recent plate report even when newer satellite/biomass records exist", () => {
    const report = { dataSource: "lab", sampleDate: "2026-02-13", trichodermaCfu: "20" };
    expect(latestLabMicrobiology([report, { dataSource: "satellite", sampleDate: "2026-03-15" },
      { dataSource: "lab", sampleDate: "2026-03-16", nitrogenFixersStatus: "not_analyzed" }])).toBe(report);
  });
  it("does not pass legacy zero-N alerts as measured nitrogen deficiency", () => {
    const drought = { title: "Sequía", description: "Sin lluvias" };
    expect(validAgronomicAlerts([drought, { title: "Nitrógeno total bajo", description: "N total (0%)" }], soil)).toEqual([drought]);
  });
  it("includes complete latest/prior evidence, microbiology, climate, drought, cycle, costs and price in web context", () => {
    const prompt = buildContextPrompt({ parcel: { name: "Ensayo", crop: "Maíz", area: "1", location: "Puebla" } as any,
      parcelData: [], soilAnalysis: soil as any, soilHistory: [soil, { ...soil, id: "dup" },
        { ...soil, analysisDate: new Date("2025-01-17"), ph: "6.80" }] as any,
      labMicrobiology: { sampleDate: new Date(), dataSource: "lab", bacillusCfu: "100", microbiologyMethod: "Placa" } as any,
      tillagePractices: [], cropRotation: [], animalIntegration: null, livelihood: null,
      weatherData: { currentTemp: 24, humidity: 50, precipitation: 0, forecast: [
        { date: "2026-11-18", tempMin: 10, tempMax: 25, precipitation: 0, windSpeed: 8 }] },
      alerts: [{ title: "Sequía activa", description: "Déficit de lluvia", severity: "high" }],
      cycleDetail: { expectedYieldTon: "8", targetPricePerTon: "6000", estimatedHarvestDate: "2026-12-10" } as any,
      economy: { total: 900 }, marketPrice: { price: 6200 },
      operationalLog: { period: { from: "2026-01-01", to: "2026-12-31" }, limited: false, totalConfirmedInPeriod: 1,
        events: [{ citation: "FL:urea", occurredAt: "2026-11-17", activityType: "fertilización",
          items: [{ name: "urea", cost: 900 }], observations: null, confirmedAt: null, revision: 1, channel: "Web" }] },
    }, []);
    for (const word of ["20.08", "7.18", "6.8", "sulfur", "iron", "zinc", "manganese", "copper", "boron",
      "cec", "sand", "silt", "clay", "Placa", "Sequía activa", "Pronóstico", "900", "6200", "2026-12-10",
      "fraccion", "testigo", "NO recomendar", "sin superficie y meta"]) expect(prompt).toContain(word);
  });
  it("blocks boron/closed formulas on missing targets but not historical fertilizer costs", () => {
    const unsafe = nutritionResponseSafety("Aplica 2 kg/ha de ácido bórico. Aplica 150 kg de urea por ha.",
      { soil, area: "1", yieldTarget: null });
    expect(unsafe).not.toContain("150 kg"); expect(unsafe).not.toContain("2 kg");
    expect(unsafe).toContain("No añadas boro"); expect(unsafe).toContain("meta de rendimiento");
    const past = "Aplicaste 50 kg de urea y gastaste $900.";
    expect(nutritionResponseSafety(past, { soil, area: "1", yieldTarget: null })).toBe(past);
  });
  it("adds split application and a trial with control to new bioinput advice on sandy soils", () => {
    const result = nutritionResponseSafety("Recomiendo usar Bacillus como bioinsumo.",
      { soil, area: "1", yieldTarget: "8" });
    expect(result).toContain("fracciona"); expect(result).toContain("franja con testigo");
  });
});

import { describe, expect, it } from "vitest";
import { hasSoilBiologyIndicator, sameSoilBiologyInput } from "../shared/soil-biology-input";
import { getParcelSetupCompletion } from "../shared/parcel-setup-progress";
import { costAreaEvidence } from "../server/services/cost-area-evidence";
import { chooseBasePlan, fertilizationFingerprint, renderBasePlan } from "../server/services/fertilization-plan-memory";
import { renderSinglePlanCosting } from "../server/services/parcel-economy";
import { rainfedResponse } from "../server/services/whatsapp-answer-policy";
import { analyzeSatelliteRaster, satelliteCropAlert } from "../server/services/whatsapp-satellite-math";
import { satelliteCaption } from "../server/services/whatsapp-satellite";
import { fieldLogTurnSchema } from "../server/services/field-log-turn";
import { insertSoilBiologySchema } from "../shared/schema";

const sabino = { crop: "Maíz", area: ".93", plantingDate: "2026-05-01", phenologicalStage: "crecimiento" };
describe("Pilot parcel configuration and answer regressions", () => {
  it("recognizes plate counts and negative lab results, but not metadata or an empty form", () => {
    expect(hasSoilBiologyIndicator({ labName: "FIRA", labFolio: "146", notes: "Informe" })).toBe(false);
    expect(hasSoilBiologyIndicator({ mbc: "" })).toBe(false);
    expect(hasSoilBiologyIndicator({ trichodermaCfu: "6600", fusariumCfu: "4650", bacillusCfu: "30000" })).toBe(true);
    expect(hasSoilBiologyIndicator({ nitrogenFixersStatus: "not_detected" })).toBe(true);
    expect(hasSoilBiologyIndicator({ mbc: 0 })).toBe(true);
    const empty = insertSoilBiologySchema.parse({ parcelId: "p", userId: "u", sampleDate: "2025-01-15",
      mbc: "", mr: " ", bg: "", nag: "", dnaYield: "", trichodermaCfu: " " });
    expect(empty.mbc).toBeNull();
    expect(empty.trichodermaCfu).toBeNull();
    expect(hasSoilBiologyIndicator(empty)).toBe(false);
  });
  it("detects identical biology submissions despite database decimal/date serialization", () => {
    const lab = { sampleDate: "2025-01-15", depthCm: 20, labFolio: "146", trichodermaCfu: 6600 };
    expect(sameSoilBiologyInput(lab, { ...lab, sampleDate: new Date("2025-01-15"), trichodermaCfu: "6600.00" })).toBe(true);
    expect(sameSoilBiologyInput(lab, { ...lab, trichodermaCfu: "6601" })).toBe(false);
  });
  it("shows the same 4/7 and microbiology checkmark from both setup shapes", () => {
    const flags = { stepCycle: true, stepSoil: true, stepPractices: true, stepSoilBio: true };
    expect(getParcelSetupCompletion(flags).percentage).toBe(57);
    expect(getParcelSetupCompletion({ progress: flags })).toEqual(getParcelSetupCompletion(flags));
    expect(getParcelSetupCompletion(flags).flags.stepSoilBio).toBe(true);
  });
  it("separates partly covered boundary pixels from SCL-confirmed clouds", () => {
    const raster: any = { rows: 2, cols: 2, bbox: { minx: 0, miny: 0, maxx: .002, maxy: .002 },
      values: [[null, .5], [.2, null]], cloudMask: [[0, 0], [0, 1]], imageDate: "2026-09-16", scaleM: 10 };
    const coordinates: [number, number][] = [[0, 0], [0, .002], [.002, .002], [.0005, 0]];
    const s = analyzeSatelliteRaster(raster, coordinates, "ndvi");
    expect(s.coverage!.edgePct).toBeGreaterThan(0);
    expect(s.coverage!.cloudPct).toBeGreaterThan(0);
    expect(s.coverage!.noDataPct).toBe(0);
    const caption = satelliteCaption({ summary: s } as any, "", false, new Date("2026-09-18"));
    expect(caption).toContain("Borde sin lectura");
    expect(caption).toContain("no son nubes");
    expect(caption).toContain("Nubes/sombras verificadas");
    expect(caption).toContain("2026-09-16");
    expect(caption).not.toContain("15/09");
  });
  it("warns about NDVI .243 at the actual September stage rather than assuming adequate vigor", () => {
    expect(satelliteCropAlert(sabino, { index: "ndvi", imageDate: "2026-09-16", mean: .243 } as any)).toMatch(/Alerta.*bajo/);
    expect(satelliteCropAlert({ ...sabino, phenologicalStage: "cosecha" },
      { index: "ndvi", imageDate: "2026-11-16", mean: .243 } as any)).toBeUndefined();
  });
  it("does not equate a four-hectare notebook or an unknown area with a .93 ha parcel", () => {
    const mismatch = costAreaEvidence(sabino.area, [{ id: "c", notes: "Superficie: 4 ha" }], []);
    expect(mismatch.comparable).toBe(false);
    expect(mismatch.sources[0]).toMatchObject({ areaHa: 4, status: "mismatch" });
    expect(costAreaEvidence(sabino.area, [{ id: "c" }], []).sources[0].status).toBe("unconfirmed");
    expect(costAreaEvidence(sabino.area, [{ id: "c", areaHa: .93, areaConfirmed: true }], []).comparable).toBe(true);
  });
  it("reuses the same bean phosphorus range unless agronomic evidence changes", () => {
    const original: any = { crop: "Frijol", nutrientsKgHa: { n: null, p2o5: [50, 60], k2o: null }, provisional: true };
    const different = { ...original, nutrientsKgHa: { ...original.nutrientsKgHa, p2o5: [31, 31] } };
    const fingerprint = fertilizationFingerprint(sabino);
    const plans = { frijol: { fingerprint, savedAt: "2026-11-18", plan: original } };
    expect(chooseBasePlan(different, plans, fingerprint)).toBe(original);
    expect(renderBasePlan(chooseBasePlan(different, plans, fingerprint))).toContain("50–60");
    expect(chooseBasePlan(different, plans, fertilizationFingerprint({ ...sabino, area: "4" }))).toBe(different);
  });
  it("removes unasked irrigation advice in rainfed parcels, but allows an explicit irrigation question", () => {
    const text = "La MO es 0.87%. Aplica un riego ligero. Revisa raíces.";
    expect(rainfedResponse(text, "temporal", false)).not.toMatch(/riego/);
    expect(rainfedResponse(text, "temporal", true)).toBe(text);
    expect(rainfedResponse("", "temporal", false)).toBe("");
  });
  it("renders the structured economic breakdown exactly once", () => {
    const response = renderSinglePlanCosting("Fracciona en suelo arenoso.\nUrea 50 kg = $820 MXN.\nDesglose del plan:\nTotal del plan: $820",
      [{ name: "Urea", quantity: 50, unit: "kg", unitPrice: 16.4, currency: "MXN", source: "productor" }]);
    expect(response.match(/Desglose del plan/g)).toHaveLength(1);
    expect(response.match(/Total del plan/g)).toHaveLength(1);
    expect(response).toContain("Fracciona");
  });
  it("preserves two separately requested image dates through the single-call schema", () => {
    const turn = fieldLogTurnSchema.parse({ kind: "query", record: null, response: "", recommendedFieldAction: false,
      satelliteRequest: { index: "ndvi", date: "2026-11-18", comparisonDate: "2026-09-18", compare: true } });
    expect(turn.satelliteRequest?.comparisonDate).toBe("2026-09-18");
  });
});

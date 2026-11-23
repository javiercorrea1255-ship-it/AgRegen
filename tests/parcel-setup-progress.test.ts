import { describe, expect, it } from "vitest";
import { getParcelSetupCompletion } from "../shared/parcel-setup-progress";
import { hasSoilBiologyIndicator, sameSoilBiologyInput } from "../shared/soil-biology-input";
import {
  createEmptySoilBiologyForm, hasSoilBiologyPlateInputs, selectSoilBiologyPrefillRecord,
  serializeSoilBiologyForm, soilBiologyRecordToForm, soilBiologySaveTarget,
} from "../shared/soil-biology-form";

describe("getParcelSetupCompletion", () => {
  it("reads root flags and counts all seven steps", () => {
    const result = getParcelSetupCompletion({
      stepCycle: true,
      stepSoil: true,
      stepEconomy: true,
      stepPractices: true,
      stepSoilBio: false,
      stepTissue: false,
      stepWater: false,
    });
    expect(result.completedCount).toBe(4);
    expect(result.totalCount).toBe(7);
    expect(result.percentage).toBe(57);
    expect(result.isComplete).toBe(false);
  });

  it("supports nested progress flags while keeping optional flags at root", () => {
    const result = getParcelSetupCompletion({
      progress: { stepCycle: true, stepSoil: true, stepEconomy: true, stepPractices: true },
      stepSoilBio: true,
      stepTissue: true,
      stepWater: true,
    });
    expect(result.completedCount).toBe(7);
    expect(result.percentage).toBe(100);
    expect(result.isComplete).toBe(true);
  });

  it("does not infer completion from absent or truthy non-boolean values", () => {
    const result = getParcelSetupCompletion({ stepCycle: 1, progress: { stepSoil: "true" } });
    expect(result.completedCount).toBe(0);
    expect(result.percentage).toBe(0);
  });

  it("lets an explicit root false override a stale nested true", () => {
    const result = getParcelSetupCompletion({
      stepCycle: false,
      progress: { stepCycle: true },
    });
    expect(result.flags.stepCycle).toBe(false);
  });
});

const sabinoReport = {
  id: "sabino-146",
  sampleDate: "2025-01-15",
  depthCm: 20,
  dataSource: "lab",
  labName: "Laboratorio Sabino",
  labFolio: "146",
  microbiologyMethod: "Dilución y cultivo",
  trichodermaCfu: "6600",
  fusariumCfu: "4650",
  bacillusCfu: "30000",
  metarhiziumCfu: null,
  metarhiziumStatus: "not_detected",
  beauveriaCfu: null,
  beauveriaStatus: "not_detected",
  nitrogenFixersStatus: "detected",
  mbc: null,
  mr: null,
  bg: null,
  nag: null,
  dnaYield: null,
  notes: "Muestra compuesta de cinco puntos; conservar refrigerada.",
};

describe("soil biology form helpers", () => {
  it("prefills the measured Sabino report without losing evidence or notes", () => {
    const form = soilBiologyRecordToForm(sabinoReport);
    expect(form).toMatchObject({
      sampleDate: "2025-01-15",
      depthCm: "20",
      labFolio: "146",
      trichodermaCfu: "6600",
      fusariumCfu: "4650",
      bacillusCfu: "30000",
      metarhiziumStatus: "not_detected",
      beauveriaStatus: "not_detected",
      nitrogenFixersStatus: "detected",
      notes: "Muestra compuesta de cinco puntos; conservar refrigerada.",
    });
    expect(serializeSoilBiologyForm(form)).toMatchObject({
      sampleDate: "2025-01-15",
      depthCm: 20,
      labFolio: "146",
      trichodermaCfu: 6600,
      fusariumCfu: 4650,
      bacillusCfu: 30000,
      notes: "Muestra compuesta de cinco puntos; conservar refrigerada.",
    });
  });

  it("prefers the newest measured lab report over newer estimates, and otherwise preserves the newest source", () => {
    const newerEstimate = { ...sabinoReport, id: "satellite-newer", sampleDate: "2025-02-10", dataSource: "satellite" };
    const olderLab = { ...sabinoReport, id: "lab-older", sampleDate: "2024-11-01" };
    expect(selectSoilBiologyPrefillRecord([olderLab, newerEstimate, sabinoReport])?.id).toBe("sabino-146");
    const fallback = selectSoilBiologyPrefillRecord([newerEstimate]);
    expect(fallback?.dataSource).toBe("satellite");
    expect(soilBiologyRecordToForm(fallback!).dataSource).toBe("satellite");
  });

  it("keeps empty numeric fields null and rejects empty or identical new analyses", () => {
    const blank = createEmptySoilBiologyForm("2025-01-15");
    const payload = serializeSoilBiologyForm(blank);
    expect(payload.mbc).toBeNull();
    expect(payload.trichodermaCfu).toBeNull();
    expect(hasSoilBiologyIndicator(payload)).toBe(false);
    expect(hasSoilBiologyPlateInputs(blank)).toBe(false);
    expect(sameSoilBiologyInput(payload, serializeSoilBiologyForm(blank))).toBe(true);
    expect(sameSoilBiologyInput(serializeSoilBiologyForm(soilBiologyRecordToForm(sabinoReport)), sabinoReport)).toBe(true);
    expect(hasSoilBiologyPlateInputs(soilBiologyRecordToForm(sabinoReport))).toBe(true);
  });

  it("selects PATCH for an existing record and POST only for an explicit new entry", () => {
    expect(soilBiologySaveTarget("parcel-1", "record-146")).toEqual({
      method: "PATCH",
      url: "/api/parcels/parcel-1/soil-biology/record-146",
    });
    expect(soilBiologySaveTarget("parcel-1", null)).toEqual({
      method: "POST",
      url: "/api/parcels/parcel-1/soil-biology",
    });
  });
});

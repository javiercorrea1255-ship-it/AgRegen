import { mexicoDateKey } from "./civil-date";
import { hasSoilBiologyIndicator } from "./soil-biology-input";

export type SoilBiologyStatus = "counted" | "not_detected" | "not_analyzed" | "";
export type SoilBiologyNitrogenStatus = "detected" | "not_detected" | "not_analyzed" | "";
export type SoilBiologyForm = {
  sampleDate: string;
  depthCm: string;
  dataSource: string;
  labName: string;
  labFolio: string;
  microbiologyMethod: string;
  trichodermaCfu: string;
  fusariumCfu: string;
  bacillusCfu: string;
  metarhiziumCfu: string;
  metarhiziumStatus: SoilBiologyStatus;
  beauveriaCfu: string;
  beauveriaStatus: SoilBiologyStatus;
  nitrogenFixersStatus: SoilBiologyNitrogenStatus;
  mbc: string;
  mr: string;
  bg: string;
  nag: string;
  dnaYield: string;
  notes: string;
};

export type SoilBiologyRecordInput = Partial<Record<keyof SoilBiologyForm, unknown>> & {
  id?: string;
  createdAt?: string | Date | null;
  trichodermaFusariumRatio?: string | number | null;
};

export function createEmptySoilBiologyForm(sampleDate: string): SoilBiologyForm {
  return {
    sampleDate,
    depthCm: "20",
    dataSource: "lab",
    labName: "",
    labFolio: "",
    microbiologyMethod: "",
    trichodermaCfu: "",
    fusariumCfu: "",
    bacillusCfu: "",
    metarhiziumCfu: "",
    metarhiziumStatus: "",
    beauveriaCfu: "",
    beauveriaStatus: "",
    nitrogenFixersStatus: "",
    mbc: "",
    mr: "",
    bg: "",
    nag: "",
    dnaYield: "",
    notes: "",
  };
}

const textValue = (value: unknown) => value == null ? "" : String(value);
const dateKey = (value: unknown) => {
  if (value == null || value === "") return "";
  if (value instanceof Date) return Number.isFinite(+value) ? value.toISOString().slice(0, 10) : "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:T00:00:00(?:\.000)?Z)?$/.test(value)) {
    return value.slice(0, 10);
  }
  return mexicoDateKey(value as string | Date | null | undefined);
};
const recordTime = (record: SoilBiologyRecordInput) =>
  dateKey(record.sampleDate) || dateKey(record.createdAt) || "";

/** Prefer the latest measured lab report, otherwise retain the latest record's source. */
export function selectSoilBiologyPrefillRecord<T extends SoilBiologyRecordInput>(records: T[]): T | null {
  const newestFirst = [...records].sort((a, b) => recordTime(b).localeCompare(recordTime(a)));
  return newestFirst.find(record =>
    record.dataSource === "lab" && hasSoilBiologyIndicator(record as Record<string, unknown>)
  ) ?? newestFirst[0] ?? null;
}

export function soilBiologyRecordToForm(record: SoilBiologyRecordInput): SoilBiologyForm {
  const form = createEmptySoilBiologyForm(dateKey(record.sampleDate));
  const source = record.dataSource;
  return {
    ...form,
    depthCm: textValue(record.depthCm) || "20",
    dataSource: textValue(source) || "lab",
    labName: textValue(record.labName),
    labFolio: textValue(record.labFolio),
    microbiologyMethod: textValue(record.microbiologyMethod),
    trichodermaCfu: textValue(record.trichodermaCfu),
    fusariumCfu: textValue(record.fusariumCfu),
    bacillusCfu: textValue(record.bacillusCfu),
    metarhiziumCfu: textValue(record.metarhiziumCfu),
    metarhiziumStatus: record.metarhiziumStatus === "counted" || record.metarhiziumStatus === "not_detected" || record.metarhiziumStatus === "not_analyzed"
      ? record.metarhiziumStatus
      : "",
    beauveriaCfu: textValue(record.beauveriaCfu),
    beauveriaStatus: record.beauveriaStatus === "counted" || record.beauveriaStatus === "not_detected" || record.beauveriaStatus === "not_analyzed"
      ? record.beauveriaStatus
      : "",
    nitrogenFixersStatus: record.nitrogenFixersStatus === "detected" || record.nitrogenFixersStatus === "not_detected" || record.nitrogenFixersStatus === "not_analyzed"
      ? record.nitrogenFixersStatus
      : "",
    mbc: textValue(record.mbc),
    mr: textValue(record.mr),
    bg: textValue(record.bg),
    nag: textValue(record.nag),
    dnaYield: textValue(record.dnaYield),
    notes: textValue(record.notes),
  };
}

function numberOrNull(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function serializeSoilBiologyForm(form: SoilBiologyForm) {
  return {
    sampleDate: form.sampleDate,
    depthCm: Number.parseInt(form.depthCm, 10) || 20,
    dataSource: form.dataSource,
    labName: form.labName.trim() || null,
    labFolio: form.labFolio.trim() || null,
    microbiologyMethod: form.microbiologyMethod.trim() || null,
    trichodermaCfu: numberOrNull(form.trichodermaCfu),
    fusariumCfu: numberOrNull(form.fusariumCfu),
    bacillusCfu: numberOrNull(form.bacillusCfu),
    metarhiziumCfu: form.metarhiziumStatus === "counted" ? numberOrNull(form.metarhiziumCfu) : null,
    metarhiziumStatus: form.metarhiziumStatus || null,
    beauveriaCfu: form.beauveriaStatus === "counted" ? numberOrNull(form.beauveriaCfu) : null,
    beauveriaStatus: form.beauveriaStatus || null,
    nitrogenFixersStatus: form.nitrogenFixersStatus || null,
    mbc: numberOrNull(form.mbc),
    mr: numberOrNull(form.mr),
    bg: numberOrNull(form.bg),
    nag: numberOrNull(form.nag),
    dnaYield: numberOrNull(form.dnaYield),
    notes: form.notes.trim() || null,
  };
}

export function hasSoilBiologyPlateInputs(form: SoilBiologyForm): boolean {
  return Boolean(
    form.trichodermaCfu.trim() || form.fusariumCfu.trim() || form.bacillusCfu.trim() ||
    form.metarhiziumCfu.trim() || form.beauveriaCfu.trim() ||
    form.metarhiziumStatus || form.beauveriaStatus || form.nitrogenFixersStatus
  );
}

export function soilBiologySaveTarget(parcelId: string, recordId: string | null) {
  return {
    method: recordId ? "PATCH" as const : "POST" as const,
    url: recordId
      ? `/api/parcels/${parcelId}/soil-biology/${recordId}`
      : `/api/parcels/${parcelId}/soil-biology`,
  };
}

import { measuredNumber, soilMeasurementKeys } from "@shared/agronomic-evidence";

/** Explicit report evidence only, never mass-convert measured zeros. */
export function soilReportRepair(row: any) {
  const notes = String(row.notes || "");
  const report = notes.match(/N\s+inorg[aá]nico(?:\s*\([^)]*\))?\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*mg\/kg/i);
  const changes: Record<string, string | null> = {};
  if (measuredNumber(row.nitrogenTotal) === 0 && /N\s+total\s+no\s+(?:analizad|medid|determinad)/i.test(notes))
    changes.nitrogenTotal = null;
  if (row.nitrogenInorganic == null && report) changes.nitrogenInorganic = report[1].replace(",", ".");
  return changes;
}
export function exactSoilDuplicates(a: any, b: any) {
  return String(a.analysisDate instanceof Date ? a.analysisDate.toISOString() : a.analysisDate).slice(0, 10) ===
    String(b.analysisDate instanceof Date ? b.analysisDate.toISOString() : b.analysisDate).slice(0, 10) &&
    soilMeasurementKeys.every(k => measuredNumber(a[k]) === measuredNumber(b[k]));
}

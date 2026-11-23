/** Metadata alone is not a biological measurement. Zero is a measured value. */
export function hasSoilBiologyIndicator(value: Record<string, unknown>): boolean {
  const numbers = ["mbc", "mr", "bg", "nag", "dnaYield", "trichodermaCfu", "fusariumCfu",
    "bacillusCfu", "metarhiziumCfu", "beauveriaCfu"];
  return numbers.some(key => value[key] !== null && value[key] !== undefined && value[key] !== "" &&
    Number.isFinite(Number(value[key]))) ||
    ["metarhiziumStatus", "beauveriaStatus", "nitrogenFixersStatus"].some(key =>
      value[key] === "detected" || value[key] === "not_detected");
}

export function sameSoilBiologyInput(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const numeric = ["depthCm", "mbc", "mr", "bg", "nag", "dnaYield", "trichodermaCfu",
    "fusariumCfu", "bacillusCfu", "metarhiziumCfu", "beauveriaCfu"];
  const fields = ["labName", "labFolio", "microbiologyMethod", "metarhiziumStatus",
    "beauveriaStatus", "nitrogenFixersStatus", "notes", "dataSource"];
  const day = (v: unknown) => v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
  const number = (v: unknown) => v === null || v === undefined || v === "" ? null : Number(v);
  return day(a.sampleDate) === day(b.sampleDate) &&
    numeric.every(k => number(a[k]) === number(b[k])) &&
    fields.every(k => String(a[k] ?? "").trim() === String(b[k] ?? "").trim());
}

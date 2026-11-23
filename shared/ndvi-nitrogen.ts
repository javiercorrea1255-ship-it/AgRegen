import rules from "./ndvi-nitrogen-rules.json";

export const ndviNitrogenRuleVersion = rules.version;

/** Select a rule using the unrounded mean; equality belongs to the next band. */
export function ndviNitrogenRule(mean: number) {
  if (!Number.isFinite(mean) || mean < -1 || mean > 1) throw new RangeError("El NDVI debe estar entre -1 y 1.");
  const band = rules.bands.find(({ upperExclusive }) => upperExclusive === null || mean < upperExclusive);
  if (!band) throw new Error("La tabla NDVI no cubre el valor.");
  return { dose: band.dose, label: band.label, unit: rules.unit, version: rules.version };
}

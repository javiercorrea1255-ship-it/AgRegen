import { createHash } from "node:crypto";
import type { FieldLogTurn } from "./field-log-turn";
export type BaseFertilizationPlan = NonNullable<FieldLogTurn["fertilizationPlan"]>;
export type SavedFertilizationPlan = { fingerprint: string; savedAt: string; plan: BaseFertilizationPlan };
export const cropPlanKey = (crop: string) => crop.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
export const fertilizationFingerprint = (evidence: unknown) =>
  createHash("sha256").update(JSON.stringify(evidence)).digest("hex");

export function chooseBasePlan(proposed: BaseFertilizationPlan,
  plans: Record<string, SavedFertilizationPlan>, fingerprint: string) {
  const prior = plans[cropPlanKey(proposed.crop)];
  return prior?.fingerprint === fingerprint ? prior.plan : proposed;
}
export function renderBasePlan(plan: BaseFertilizationPlan) {
  const labels = { n: "N", p2o5: "P2O5", k2o: "K2O" };
  const doses = (Object.keys(labels) as (keyof typeof labels)[]).flatMap(k => {
    const range = plan.nutrientsKgHa[k];
    return range ? [`${labels[k]}: ${range[0] === range[1] ? range[0] : `${range[0]}–${range[1]}`} kg/ha`] : [];
  });
  return `Plan base ${plan.provisional ? "provisional " : ""}de ${plan.crop}: ${doses.join("; ") || "sin dosis definidas"}.
Con los mismos datos se conserva la misma base; no es una fórmula cerrada sin superficie y meta de rendimiento confirmadas. Valida con el técnico y prueba en franja con testigo.`;
}

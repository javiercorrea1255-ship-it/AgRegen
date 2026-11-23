/** Evidence normalization only: never changes historical rows or supplies missing measurements. */
const reportDate = (value: Date | string | undefined) => value instanceof Date ? value.toISOString().slice(0, 10)
  : value?.slice(0, 10) ?? null;
export const soilMeasurementKeys = [
  "organicMatter", "totalCarbon", "nitrogenTotal", "nitrogenInorganic", "phosphorus",
  "potassium", "calcium", "magnesium", "sulfur", "iron", "zinc", "manganese",
  "copper", "boron", "ph", "electricConductivity", "cec", "sand", "silt", "clay",
] as const;
export function measuredNumber(value: unknown): number | null {
  if (value == null || String(value).trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
export function distinctSoilAnalyses<T extends { analysisDate: Date | string }>(rows: T[]): T[] {
  const unique = new Map<string, T>();
  for (const row of [...rows].sort((a, b) => +new Date(b.analysisDate) - +new Date(a.analysisDate))) {
    const date = new Date(row.analysisDate);
    const normalized = soilEvidence(row)!;
    const key = JSON.stringify([Number.isFinite(+date) ? date.toISOString().slice(0, 10) : `unknown-${unique.size}`,
      ...soilMeasurementKeys.map(k => normalized[k])]);
    const existing = unique.get(key);
    if (!existing) unique.set(key, { ...row });
    else {
      const notes = new Set([...(String((existing as any).notes || "").split("\n")), String((row as any).notes || "")].filter(Boolean));
      (existing as any).notes = Array.from(notes).join("\n");
      const labs = new Set([String((existing as any).labName || ""), String((row as any).labName || "")].filter(Boolean));
      (existing as any).labName = Array.from(labs).join(" / ");
    }
  }
  return Array.from(unique.values());
}
export function soilEvidence(row: any) {
  if (!row) return null;
  const values = Object.fromEntries(soilMeasurementKeys.map(k => [k, measuredNumber(row[k])])) as
    Record<(typeof soilMeasurementKeys)[number], number | null>;
  const total = values.nitrogenTotal;
  if (total === 0) values.nitrogenTotal = null;
  const reported = String(row.notes || "").match(/(?:N|nitr[oó]geno)\s+inorg[aá]nico(?:\s*\([^)]*\))?\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*(?:mg\s*\/\s*kg|ppm)/i);
  let inorganicSource = values.nitrogenInorganic == null ? null : "campo del análisis";
  if (values.nitrogenInorganic == null && reported) {
    values.nitrogenInorganic = Number(reported[1].replace(",", "."));
    inorganicSource = "observaciones del informe (no se modificó el registro)";
  }
  return { date: reportDate(row.analysisDate), lab: row.labName ?? null, ...values,
    units: { nitrogenTotal: "%", nitrogenInorganic: "mg/kg", organicMatter: "%", totalCarbon: "%",
      nutrients: "mg/kg (ppm); para Ca/Mg confirmar ppm o meq/100g en el informe, no convertir sin unidad",
      ph: "adimensional", electricConductivity: "dS/m", cec: "meq/100g", texture: "%" },
    nitrogenTotalCaveat: total === 0 ? "0 legado sin validación: N total no disponible; no implica ausencia de N" : null,
    boronWarning: /(?:boro|boron|\bB\b).{0,50}(?:muy alto|t[oó]xic|exceso)/i.test(String(row.notes || "")) ||
      (values.boron != null && values.boron > 3) ? "Boro muy alto según informe o umbral orientativo >3 mg/kg: no recomendar aportes de B; validar método y cultivo" : null,
    inorganicSource, notes: row.notes ?? null };
}
export const MICROBIOLOGY_CAVEAT = "Organismos cultivables por el método reportado: no identifican patógenos ni miden fijación de N. No equivalen a diversidad total ni a eficacia de un bioinsumo.";
export function microbiologyEvidence(row: any) {
  if (!row) return null;
  const trichoderma = measuredNumber(row.trichodermaCfu), fusarium = measuredNumber(row.fusariumCfu);
  return { date: reportDate(row.sampleDate), source: row.dataSource, lab: row.labName ?? null, folio: row.labFolio ?? null,
    method: row.microbiologyMethod ?? null, trichodermaCfu: trichoderma, fusariumCfu: fusarium,
    bacillusCfu: measuredNumber(row.bacillusCfu),
    metarhiziumCfu: measuredNumber(row.metarhiziumCfu), metarhiziumStatus: row.metarhiziumStatus ?? (measuredNumber(row.metarhiziumCfu) != null ? "counted" : "not_analyzed"),
    beauveriaCfu: measuredNumber(row.beauveriaCfu), beauveriaStatus: row.beauveriaStatus ?? (measuredNumber(row.beauveriaCfu) != null ? "counted" : "not_analyzed"),
    nitrogenFixersStatus: row.nitrogenFixersStatus ?? "not_analyzed",
    trichodermaFusariumRatio: trichoderma != null && fusarium != null && fusarium > 0 ? trichoderma / fusarium : null,
    ratioCaveat: fusarium === 0 ? "No calculable: Fusarium es cero" : trichoderma == null || fusarium == null ? "No calculable: falta un conteo" : null,
    units: "UFC/g", caveat: MICROBIOLOGY_CAVEAT, notes: row.notes ?? null };
}
export function latestLabMicrobiology<T extends { dataSource: string; sampleDate: Date | string }>(rows: T[]): T | null {
  const labs = rows.filter(r => r.dataSource === "lab").sort((a, b) => +new Date(b.sampleDate) - +new Date(a.sampleDate));
  return labs.find(r => ["trichodermaCfu", "fusariumCfu", "bacillusCfu", "metarhiziumCfu",
    "beauveriaCfu", "metarhiziumStatus", "beauveriaStatus", "nitrogenFixersStatus"].some(k =>
      (r as any)[k] != null && (r as any)[k] !== "" && (r as any)[k] !== "not_analyzed")) || null;
}
export const FERTILIZATION_EVIDENCE_RULES = `FERTILIZACIÓN, NUTRICIÓN, ABONOS Y BIOINSUMOS:
Usa el suelo reciente y anterior, microbiología, cultivo/etapa/fechas, clima actual/pronóstico/sequía, aplicaciones/costos y metas/precios disponibles; cita datos concretos y faltantes.
N inorgánico (mg/kg) NO es N total (%); un cero legado de N total no validado es dato ausente, no demuestra carencia. No conviertas estas magnitudes ni infieras N disponible de un conteo microbiano.
Si el boro está clasificado muy alto (o el informe advierte exceso/toxicidad), NO recomendar boro ni productos que lo aporten. Explica los límites del método e interpretación por cultivo.
No prescribas una fórmula cerrada ni dosis finales sin superficie y meta de rendimiento confirmadas; pide el dato faltante, no lo inventes. Una superficie guardada es la reportada, no confirmación de la superficie que se fertilizará.
En suelos arenosos, prefiere fraccionar aplicaciones y considerar lluvia/riego y lixiviación. Para TODO plan de fertilización o insumo nuevo, en CUALQUIER cultivo (maíz, frijol u otro), propone prueba en franja con testigo sin ese insumo o plan antes de escalar. Los conteos cultivables no identifican patógenos ni miden fijación de N.`;

export function validAgronomicAlerts<T extends { title: string; description: string }>(alerts: T[], soil: any): T[] {
  if (measuredNumber(soil?.nitrogenTotal) !== 0) return alerts;
  return alerts.filter(a => !(/nitr[oó]geno/i.test(a.title) &&
    /(?:\(|:\s*)0(?:[.,]0+)?\s*(?:%|ppm|mg)/i.test(a.description)));
}

/** Narrow output safeguards for explicit nutrient advice, not historical receipts or costs. */
export function nutritionResponseSafety(text: string, options: { soil: any; soilType?: string | null; area: unknown; yieldTarget: unknown }): string {
  const evidence = soilEvidence(options.soil);
  const advice = (s: string) => /\b(?:aplica|aplique|aplicar|añade|incorpora|usa|utiliza|recomiendo|recomendamos|dosis|conviene|considera|inocula|inocule|inocular)\b/i.test(s) &&
    !/\bno\s+(?:apli\w*|añad\w*|incorpor\w*|us[ae]\w*|utiliz\w*)|\b(?:ayer|registrad\w*|ya\s+aplic\w*|(?:hoy|yo)\s+apliqu[eé])/i.test(s);
  const nutrients = /fertil|abono|urea|bioinsumo|bacillus|trichoderma|rhizobium|inocul|compost|micorriz|b[oó]r(?:o|ax|ico)|NPK/i;
  const clauses = text.split(/(?<=[.!?])\s+|\n/);
  const isNutrition = clauses.some(s => advice(s) && nutrients.test(s));
  if (!isNutrition) return text;
  const blockedBoron = !!evidence?.boronWarning && clauses.some(s => advice(s) && /boro|b[oó]rax|b[oó]rico/i.test(s));
  const missingTarget = !(measuredNumber(options.area)! > 0 && measuredNumber(options.yieldTarget)! > 0);
  const closedFormula = missingTarget && clauses.some(s => advice(s) && /\d+(?:[.,]\d+)?\s*(?:kg|g|l|ml|unidades)|\d+[-–]\d+[-–]\d+/i.test(s));
  let result = clauses.filter(s => !(advice(s) && (
    blockedBoron && /boro|b[oó]rax|b[oó]rico/i.test(s) ||
    closedFormula && /\d+(?:[.,]\d+)?\s*(?:kg|g|l|ml|unidades)|\d+[-–]\d+[-–]\d+/i.test(s)
  ))).join("\n");
  if (blockedBoron) result += "\nNo añadas boro: está reportado muy alto; valida método y cultivo con tu técnico.";
  if (closedFormula) result += "\nAntes de cerrar una fórmula, confirma la superficie a fertilizar y la meta de rendimiento.";
  const remainingAdvice = result.split(/(?<=[.!?])\s+|\n/).some(s => advice(s) && nutrients.test(s));
  if (remainingAdvice && (Number(evidence?.sand) >= 70 || /arenos/i.test(options.soilType || "")) && !/fraccion/i.test(result))
    result += "\nEn este suelo arenoso, fracciona las aplicaciones considerando lluvia y riego.";
  if (remainingAdvice && !/franja.{0,50}testigo|testigo.{0,50}franja/i.test(result))
    result += "\nAntes de escalar el plan o insumo nuevo, prueba una franja con testigo sin ese tratamiento.";
  return result.trim();
}

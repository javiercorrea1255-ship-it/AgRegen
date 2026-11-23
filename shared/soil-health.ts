import { z } from "zod";

export const SOIL_HEALTH_VERSION = "1";
export const SOIL_HEALTH_SOURCE = "Evaluación de la Salud del Suelo en Tierras de Cultivo. Modificado de Magdoff, F. and Van Es, H., 2021. Building soils for better crops: Ecological management for healthy soils. USDA-SARE";
export const soilHealthIndicators = [
  { id: "cover", name: "Cubierta del suelo", problem: "Materia orgánica, hábitat de organismos", timing: "En cualquier momento", criterion: "Más del 75% de la superficie del suelo está cubierta por plantas, residuos o mantillo (mulch)." },
  { id: "residues", name: "Descomposición de residuos", problem: "Materia orgánica, hábitat de organismos", timing: "En cualquier momento; principalmente siembra directa; entrevista al agricultor", criterion: "Hay descomposición natural de los residuos de cultivos según lo esperado; los residuos del año anterior están parcialmente descompuestos y desapareciendo." },
  { id: "crusts", name: "Costras superficiales", problem: "Agregación", timing: "Antes de la labranza; antes o a principios de la temporada de crecimiento", criterion: "Formación de costras en no más del 5% del campo." },
  { id: "ponding", name: "Estancamiento de agua", problem: "Compactación, agregación", timing: "Después de la lluvia o el riego (no cuando esté congelado); entrevista al agricultor", criterion: "Sin estancamiento de agua dentro de las 24 horas posteriores a una lluvia o riego importante." },
  { id: "penetration", name: "Resistencia a la penetración", problem: "Compactación", timing: "Con humedad adecuada del suelo; antes de la labranza; antes, a principios o después de la temporada de crecimiento", criterion: "Calificación del penetrómetro <150 psi en la capa superficial y <300 psi en la capa del subsuelo, O resistencia leve o nula al insertar una bandera de alambre." },
  { id: "aggregates", name: "Agregados estables al agua", problem: "Agregación, hábitat de organismos", timing: "En cualquier momento", criterion: "Sumergido en agua en un frasco de vidrio: al menos el 80% del suelo permanece intacto después de 5 minutos con poca agua turbia." },
  { id: "structure", name: "Estructura del suelo", problem: "Compactación, materia orgánica del suelo, agregación, hábitat de organismos", timing: "En cualquier momento", criterion: "Estructura granular en el horizonte superficial y sin estructura laminar en los horizontes superficiales o del subsuelo." },
  { id: "color", name: "Color del suelo", problem: "Materia orgánica", timing: "Con humedad adecuada del suelo", criterion: "Sin diferencia de color entre las muestras del campo y las de la línea de la cerca, O el valor se encuentra en el rango más oscuro usando la tabla de colores." },
  { id: "roots", name: "Raíces de las plantas", problem: "Compactación, materia orgánica, hábitat de organismos", timing: "Durante la temporada de crecimiento", criterion: "Raíces cubiertas por una película de suelo o parte de los agregados del suelo, O las raíces vivas están sanas (sin raíces negras/secas ni lesiones), completamente ramificadas y extendidas en el subsuelo." },
  { id: "diversity", name: "Diversidad biológica", problem: "Materia orgánica, hábitat de organismos", timing: "Con humedad adecuada; antes de la labranza", criterion: "Más de tres tipos diferentes de organismos observados sin aumento (lupa)." },
  { id: "biopores", name: "Bioporos", problem: "Materia orgánica, compactación, agregación, hábitat de organismos", timing: "Antes de la labranza; principalmente siembra directa", criterion: "Presencia de canales de raíces o lombrices de tierra que se extienden verticalmente a través del suelo, algunos de los cuales se conectan con la superficie." },
  { id: "ph", name: "pH", problem: "Disponibilidad nutrimental", timing: "Antes de la siembra", criterion: "pH  del suelo en agua (1:2) está entre 6.0 y 7.5 " },
  { id: "salts", name: "Presencia de sales", problem: "Estrés salino, problemas de infiltración ", timing: "Antes de la labranza", criterion: "No existen manchas de sales (aspecto de talco blanco) ni de sodio (manchas oscuras de suelo no agregado, disperso)" },
  { id: "texture", name: "Textura", problem: "Retención de agua y nutrientes", timing: "En cualquier momento", criterion: "La textura no es muy arcillosa ni muy arenosa" },
  { id: "consistency", name: "Consistencia en húmedo", problem: "Facilidad de penetración de raices", timing: "Alrededor de capacida de campo del suelo", criterion: "El suelo se desmenuza fácilmente bajo una presión de ligera a moderada, y se agrega cuando se le comprime nuevamente" },
  { id: "rotation", name: "Rotación de cultivos", problem: "Agotamiento del suelo", timing: null, criterion: "En los ultimos cinco años he alternado al menos dos tipos de cultivos" },
  { id: "crop", name: "Condición del cultivo", problem: "Cultivo", timing: "Crecimiento vegetativo", criterion: "Con follaje saludable y verde durante todo el ciclo vegetativo y en toda o casi toda la parcela" },
  { id: "yield", name: "Rendmiento del cultivo", problem: "Productividad", timing: "Al momento de la cosecha", criterion: "Rendimiento igual o superior al promedio de los campos vecinos" },
  { id: "analysis", name: "Analisis de suelos", problem: null, timing: "Antes de la siembra", criterion: "Analizo la fertilidad del suelo antes de iniciar el ciclo de cultivo cada año" },
] as const;
export type SoilHealthIndicatorId = typeof soilHealthIndicators[number]["id"];
export const indicatorIdSchema = z.enum(soilHealthIndicators.map(i => i.id) as [SoilHealthIndicatorId, ...SoilHealthIndicatorId[]]);
export const soilHealthAnswerSchema = z.object({
  answer: z.enum(["yes", "no", "unevaluated"]).default("unevaluated"),
  notes: z.string().max(4000).default(""),
}).strict();
export type SoilHealthAnswers = Partial<Record<SoilHealthIndicatorId, z.infer<typeof soilHealthAnswerSchema>>>;
export const soilHealthInputSchema = z.object({
  assessmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => {
    const d = new Date(`${s}T00:00:00Z`);
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Fecha inválida"),
  responsible: z.string().trim().min(1).max(200),
  crop: z.string().max(200).default(""),
  stage: z.string().max(200).default(""),
  area: z.string().max(500).default(""),
  moisture: z.string().max(500).default(""),
  recentWater: z.string().max(1000).default(""),
  answers: z.record(indicatorIdSchema, soilHealthAnswerSchema).default({}),
}).strict();
export type SoilHealthInput = z.infer<typeof soilHealthInputSchema>;
export interface SoilHealthEvidence { id: string; assessmentId: string; indicatorId: SoilHealthIndicatorId; filename: string }
export interface SoilHealthAssessment extends SoilHealthInput {
  id: string; parcelId: string; authorId: string; catalogueVersion: string;
  createdAt: string; updatedAt: string; evidence: SoilHealthEvidence[];
}
export interface SoilHealthList { assessments: SoilHealthAssessment[]; canEdit: boolean }
export function soilHealthSummary(answers: SoilHealthAnswers) {
  const evaluated = soilHealthIndicators.filter(i => ["yes", "no"].includes(answers[i.id]?.answer ?? "")).length;
  const fulfilled = soilHealthIndicators.filter(i => answers[i.id]?.answer === "yes").length;
  return { fulfilled, evaluated, unevaluated: 19 - evaluated, coverage: evaluated / 19, percentage: evaluated ? fulfilled / evaluated * 100 : null };
}
export function compareSoilHealth(baseline: SoilHealthAnswers, current: SoilHealthAnswers) {
  return soilHealthIndicators.map(i => {
    const before = baseline[i.id]?.answer ?? "unevaluated";
    const after = current[i.id]?.answer ?? "unevaluated";
    const change = before === "unevaluated" || after === "unevaluated" ? "not-comparable" : before === after ? "unchanged" : after === "yes" ? "improved" : "worsened";
    return { indicatorId: i.id, before, after, change };
  });
}
export function chronologicalSoilHealth<T extends { assessmentDate: string; createdAt: string | Date; id: string }>(records: T[]) {
  return [...records].sort((a, b) => a.assessmentDate.localeCompare(b.assessmentDate) || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id.localeCompare(b.id));
}
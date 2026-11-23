import { z } from "zod";
import { fieldLogActivitySpanish } from "@shared/field-log-policy";
import { civilDateInstant } from "@shared/civil-date";

const nullableText = z.string().max(2000).nullable().default(null);
export const fieldLogTurnSchema = z.object({
  kind: z.enum(["report", "query", "mixed"]),
  recordingDecision: z.enum(["fact", "none", "ambiguous"]).default("fact"),
  record: z.object({
    activityType: z.string().min(1).max(100), occurredAt: z.string().nullable().default(null),
    datePrecision: z.enum(["exact", "unknown"]).default("exact"),
    items: z.array(z.object({
      category: z.enum(["labor", "input", "machinery", "harvest", "sale", "observation"]),
      name: z.string().max(160), quantity: z.number().finite().nullable().default(null),
      unit: z.string().max(40).nullable().default(null), personnel: nullableText, machinery: nullableText,
      cost: z.number().finite().nonnegative().nullable().default(null),
      currency: z.string().max(8).nullable().default(null),
    })).max(20),
    observations: nullableText, confidence: z.number().min(0).max(1).default(0),
  }).nullable(),
  response: z.string().max(15000), recommendedFieldAction: z.boolean(),
  irrigationRequested: z.boolean().default(false),
  economicComparison: z.boolean().default(false),
  fertilizationPlan: z.object({
    crop: z.string().min(1).max(100),
    nutrientsKgHa: z.object({
      n: z.tuple([z.number().min(0).max(1000), z.number().min(0).max(1000)]).nullable().default(null),
      p2o5: z.tuple([z.number().min(0).max(1000), z.number().min(0).max(1000)]).nullable().default(null),
      k2o: z.tuple([z.number().min(0).max(1000), z.number().min(0).max(1000)]).nullable().default(null),
    }),
    provisional: z.boolean().default(true),
  }).nullable().default(null),
  planCosting: z.object({
    items: z.array(z.object({
      name: z.string().max(100), quantity: z.number().finite().nonnegative().nullable(),
      unit: z.string().max(40), unitPrice: z.number().finite().nonnegative().nullable(),
      currency: z.string().max(8).default("MXN"), source: z.string().max(200),
    })).min(1).max(30),
  }).nullable().default(null),
  satelliteRequest: z.object({
    index: z.enum(["ndvi", "ndmi"]).default("ndvi"),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
    compare: z.boolean().default(false),
    comparisonDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  }).nullable().default(null),
});
export type FieldLogTurn = z.infer<typeof fieldLogTurnSchema>;
export function normalizeFieldLogTurn(raw: unknown, messageAt: Date): FieldLogTurn {
  const turn = fieldLogTurnSchema.parse(raw);
  if (turn.kind === "query" && turn.recordingDecision !== "ambiguous") turn.record = null;
  if (turn.recordingDecision === "none") turn.record = null;
  if (turn.record) {
    turn.record.activityType = fieldLogActivitySpanish(turn.record.activityType);
    const date = turn.record.occurredAt ? civilDateInstant(turn.record.occurredAt) : messageAt;
    if (Number.isNaN(date.getTime())) turn.record.datePrecision = "unknown";
    turn.record.occurredAt = turn.record.datePrecision === "unknown" ? null
      : /^\d{4}-\d{2}-\d{2}$/.test(turn.record.occurredAt || "") ? turn.record.occurredAt : date.toISOString();
    turn.record.items = turn.record.items.map(item => ({
      ...item, unit: item.unit || null, currency: (item.currency || "MXN").toUpperCase(),
    }));
    if (!turn.record.items.length && turn.record.observations) {
      turn.record.items.push({ category: "observation", name: turn.record.observations.slice(0, 160),
        quantity: null, unit: null, personnel: null, machinery: null, cost: null, currency: "MXN" });
    }
  }
  return turn;
}
export const FIELD_FACT_RULES = `Distingue hechos OCURRIDOS de preguntas, supuestos, escenarios y precios de referencia. Añade recordingDecision="fact"|"none"|"ambiguous" al JSON.
Consultas y escenarios hipotéticos ("supongamos que siembro") y precios dados para calcular ("este año pagué la urea a 1230 pesos el bulto de 75 kg, calcula el plan") son recordingDecision="none", record=null: usa ese precio como referencia con su fuente, no como gasto ni observación.
Solo un hecho de campo inequívoco es fact. Si hay duda de si ocurrió o si el productor quiere registrarlo, ambiguous y record con candidato, sin afirmar que se guardó; el servidor preguntará ¿Lo anoto en tu bitácora?
Cada record tiene datePrecision="exact"|"unknown". Resuelve hoy/ayer con America/Mexico_City y usa YYYY-MM-DD. Sin mención de fecha, usa el día local del mensaje. Si menciona fecha imprecisa histórica ("este año", "el ciclo pasado") usa datePrecision=unknown y occurredAt=null, NUNCA hoy.`;
export const WEB_FIELD_LOG_PROMPT = `Devuelve SOLO JSON con esta forma:
{"kind":"report|query|mixed","record":null o {"activityType":"labor en español","occurredAt": "ISO o null","items":[{"category":"labor|input|machinery|harvest|sale|observation","name":"producto o labor","quantity":numero o null,"unit":texto o null,"personnel":texto o null,"machinery":texto o null,"cost":numero o null,"currency":texto o null}],"observations":texto o null,"confidence":0..1},"response":"respuesta completa en Markdown","recommendedFieldAction":false}.
Interpreta el mensaje actual y responde en la misma generación. Cuando el usuario reporte hechos de campo o pida registrar labores REALIZADAS, devuelve record con esos hechos para la bitácora compartida.
Una pregunta sobre cuándo se realizó una labor NO afirma un hecho nuevo: "¿cuándo aplicamos fertilizante?" es query, record=null. Un plan futuro o una recomendación no es labor realizada.
Si reporta y pregunta, kind=mixed. Extrae datos solo del mensaje actual, nunca copies costos, productos, cantidades o fechas del historial. Una unidad ausente queda null, moneda ausente MXN, fecha ausente la actual. Ningún faltante bloquea guardar.
No afirmes haber guardado, registrado, anotado o actualizado la bitácora: el servidor añadirá un acuse SOLO después de persistir. No inventes un guardado si record=null.
${FIELD_FACT_RULES}`;

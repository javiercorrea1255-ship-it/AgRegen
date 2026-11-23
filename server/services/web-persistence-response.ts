import type { FieldLogEntry } from "@shared/schema";
import { whatsappLedgerReceipt } from "./whatsapp-ledger-receipt";

export type WebChatMode = "normal" | "deep" | "diagnosis";
export type WebPersistenceOutcome =
  | { status: "saved"; entry: FieldLogEntry }
  | { status: "no_record" | "failed" | "unknown" };

/**
 * A model is allowed to explain agronomy, not assert application-side mutations.
 * Reject the whole answer on a persistence assertion; never splice an unchecked
 * "success" clause together with a server-side "not saved" disclaimer.
 *
 * Historical second-person facts ("registraste", "aplicaste") remain usable.
 * The check is deliberately conservative about completed/passive mutations.
 */
export function containsModelPersistenceAssertion(text: string): boolean {
  const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return normalized.split(/(?<=[.!?])\s+|\n/).some(clause => {
    const firstPersonOrProgress = /\b(?:registre|registramos|guarde|guardamos|anote|anotamos|capture|capturamos|almacene|almacenamos|archive|archivamos|asente|asentamos|apunte|apuntamos|consigne|consignamos|agregue|agregamos|incorpore|incorporamos|actualice|actualizamos|anadi|anadimos|registrando|guardando|anotando|capturando|almacenando|archivando|agregando|incorporando|actualizando)\b/;
    const completedMutation = /\b(?:registrad[oa]s?|guardad[oa]s?|anotad[oa]s?|capturad[oa]s?|almacenad[oa]s?|archivad[oa]s?|asentad[oa]s?|apuntad[oa]s?|consignad[oa]s?|agregad[oa]s?|incorporad[oa]s?|actualizad[oa]s?)\b/;
    const passiveWrite = /\bse\s+(?:(?:ha|han)\s+)?(?:registro|guardo|anoto|capturo|almaceno|archivo|asento|apunto|consigno|agrego|incorporo|actualizo|anadio)\b/;
    const persistenceTarget = /\b(?:bitacora|registro|registros|historial|cuaderno|sistema|base de datos|reporte|informacion|datos|notas)\b/;
    const persistenceSubject = /\b(?:bitacora|historial|cuaderno|base de datos|registro|registros|expediente)\b/;
    const historicalAttribution = /\b(?:segun|de acuerdo con)\s+(?:(?:la|el|tu|su)\s+)?(?:bitacora|historial|registro|registros)\b/;
    const completionCue = /\b(?:quedo|quedaron|ya|listo|lista|he|hemos|esta|estan|se ha|se han|exitosamente|correctamente)\b/;
    const eventReceipt = /^\s*(?:(?:tu|su|la|el|ese|esa)\s+)?(?:aplicacion|labor|actividad|riego|siembra|cosecha|venta|gasto|observacion|reporte)\b/;
    const ledgerPresence = /\b(?:figura|aparece|consta|incluid[oa]|incorporad[oa]|reflejad[oa]|almacenad[oa]|asentad[oa]|queda|quedo|quedaron|se encuentra|se guardo|se registro|se anoto)\b/;
    const englishReceipt = /\b(?:saved|recorded|logged|stored|registered)\b/;
    // Persistence-subject prose is denied by default, not accepted because it
    // failed to match one particular acknowledgement. Plain historical source
    // attribution is permitted only if none of the mutation checks fires.
    return firstPersonOrProgress.test(clause) || passiveWrite.test(clause) || englishReceipt.test(clause) ||
      persistenceSubject.test(clause) && !historicalAttribution.test(clause) ||
      completedMutation.test(clause) && (persistenceTarget.test(clause) || completionCue.test(clause) || eventReceipt.test(clause)) ||
      persistenceTarget.test(clause) && (ledgerPresence.test(clause) || completionCue.test(clause));
  });
}

/** The only renderer for persistence statements across all web chat modes. */
export function renderWebPersistenceResponse(
  outcome: WebPersistenceOutcome, modelResponse: string, mode: WebChatMode, now: Date,
): string {
  // On failure/uncertainty no model text is shown, regardless of its wording.
  if (outcome.status === "failed") return "No se guardó el registro de bitácora. Intenta de nuevo.";
  if (outcome.status === "unknown") return "No pude verificar si se guardó la labor. Revisa la bitácora antes de volver a registrarla.";
  const advice = containsModelPersistenceAssertion(modelResponse) ? "" : modelResponse.trim();
  if (outcome.status === "saved") {
    const entry = outcome.entry, data = entry.structuredData as any;
    if (entry.status === "pending" && !entry.occurredAt)
      return `Dejé ${entry.activityType || "el reporte"} pendiente, sin fecha exacta. ¿En qué fecha ocurrió?`;
    const receipt = whatsappLedgerReceipt({ ...data, activityType: entry.activityType,
      occurredAt: entry.occurredAt || data.occurredAt }, now);
    return `${receipt}${advice ? `\n\n${advice}` : ""}`;
  }
  const notice = mode === "normal" ? "No guardé nuevos registros de bitácora en esta respuesta."
    : `No guardé nuevos registros de bitácora. El modo ${mode === "deep" ? "Profundo" : "Diagnóstico"} no registra labores; usa el chat normal para guardarlas.`;
  return advice ? `${advice}\n\n${notice}` : notice;
}

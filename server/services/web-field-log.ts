import type { IStorage } from "../storage";
import type { FieldLogTurn } from "./field-log-turn";
import { renderWebPersistenceResponse, type WebChatMode, type WebPersistenceOutcome } from "./web-persistence-response";
import { civilDateInstant } from "@shared/civil-date";
export async function persistWebFieldLog(options: {
  storage: IStorage; userId: string; parcelId: string; sourceId: string;
  originalText: string; cycleDetailId?: string | null; response: string;
  record?: FieldLogTurn["record"]; now?: Date;
  mode?: WebChatMode;
}) {
  const { storage, userId, parcelId, sourceId } = options;
  const parcel = await storage.getParcel(parcelId);
  if (!parcel || parcel.userId !== userId) throw new Error("Parcela no autorizada");
  const render = (outcome: WebPersistenceOutcome) => renderWebPersistenceResponse(
    outcome, options.response, options.mode || "normal", options.now || new Date(),
  );
  const checkOwner = (entry: any) => {
    if (entry && (entry.userId !== userId || entry.parcelId !== parcelId)) throw new Error("Conflicto de origen de bitácora");
    return entry;
  };
  let entry = checkOwner(await storage.getFieldLogBySourceMessage(sourceId));
  const savedReply = (savedEntry: NonNullable<typeof entry>) => {
    return { response: render({ status: "saved", entry: savedEntry }), entry: savedEntry };
  };
  if (entry) return savedReply(entry);
  if (!options.record || options.mode && options.mode !== "normal")
    return { response: render({ status: "no_record" }), entry: null };
  const record = options.record;
  const totalsByCurrency = record.items.reduce<Record<string, number>>((totals, item) => {
    if (item.cost != null && item.category !== "sale") {
      const currency = item.currency || "MXN";
      totals[currency] = Math.round(((totals[currency] || 0) + item.cost) * 100) / 100;
    }
    return totals;
  }, {});
  try {
    if (!entry) entry = checkOwner(await storage.saveAutomaticFieldLog({
      userId, parcelId, cycleDetailId: options.cycleDetailId,
      sourceProviderMessageId: sourceId, originalText: options.originalText,
      activityType: record.activityType, occurredAt: record.datePrecision === "unknown" ? null
        : record.occurredAt ? civilDateInstant(record.occurredAt) : options.now || new Date(),
      structuredData: { ...record, totalsByCurrency, registration: "automatic", channel: "web" },
      missingFields: record.datePrecision === "unknown" ? ["fecha exacta"] : [], confidence: record.confidence, evidence: [],
    }));
  } catch {
    // A lost DB acknowledgement is not proof of a failed write.
    try { entry = checkOwner(await storage.getFieldLogBySourceMessage(sourceId)); }
    catch { return { response: render({ status: "unknown" }), entry: null }; }
    if (!entry) return { response: render({ status: "failed" }), entry: null };
  }
  if (!entry) throw new Error("El guardado no devolvió un registro");
  return savedReply(entry);
}

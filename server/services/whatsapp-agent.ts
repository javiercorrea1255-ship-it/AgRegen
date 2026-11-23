import { fieldLogActivitySpanish } from "@shared/field-log-policy";
import { whatsappLedgerReceipt } from "./whatsapp-ledger-receipt";
import type { IStorage } from "../storage";
import { transcribeWhatsappAudio, type ParcelContext } from "./ai-assistant";
import { saveFieldLogEvidence, type FieldLogMedia } from "./whatsapp-field-log";
import { buildWhatsappParcelCard } from "./whatsapp-context";
import { chooseBasePlan, cropPlanKey, renderBasePlan } from "./fertilization-plan-memory";
import { generateWhatsappTurn } from "./whatsapp-turn";
import { recordWhatsappMetric } from "./whatsapp-metrics";
import { prepareWhatsappSatelliteMap, satelliteCaption, SatelliteUnavailable, type SatelliteArtifact } from "./whatsapp-satellite";
import { fieldLogLabel, newestFieldLogs, selectCorrectionTarget } from "./whatsapp-ledger-actions";
import { mapTraceId, recordMapStage, timeMapStage } from "./whatsapp-satellite-cache";
import { scheduleWhatsappSatelliteRefresh } from "./whatsapp-satellite-refresh";
import { civilDateInstant } from "@shared/civil-date";

export async function processWhatsappAgentMessage(options: {
  storage: IStorage; userId: string; parcelId: string; conversationId: string; text: string;
  imageDataUrl?: string; audio?: { buffer: Buffer; mimeType: string; size: number };
  media?: FieldLogMedia; providerMessageId: string; responseMode?: "brief" | "detailed";
  phoneNumber?: string; connectionId?: string; interactionTargetId?: string; queryOnly?: boolean;
  onMapSlow?: () => Promise<void>;
  voicePreference?: string | null;
}): Promise<string> {
  const { storage, userId, parcelId, conversationId, providerMessageId } = options;
  const mapRequestId = mapTraceId(providerMessageId);
  const parcel = await storage.getParcel(parcelId);
  if (!parcel || parcel.userId !== userId) throw new Error("Parcela no encontrada");
  const providerMessages = await storage.getMessagesByProviderMessage(conversationId, providerMessageId);
  const savedAssistant = providerMessages.find(m => m.role === "assistant");
  const savedUser = providerMessages.find(m => m.role === "user");
  const priorSnapshot = savedAssistant?.contextSnapshot as any;
  const finishMap = async (message: any) => {
    const snapshot = { ...(message.contextSnapshot as any) };
    if (!snapshot.satelliteRequest || snapshot.satelliteCompleted) return message;
    let content: string;
    try {
      const artifact: SatelliteArtifact = snapshot.satelliteArtifact || await prepareWhatsappSatelliteMap({
        storage, parcel, request: snapshot.satelliteRequest, now: new Date(message.createdAt),
        requestId: mapRequestId, referenceSummary: snapshot.mapReference,
        onSlow: options.onMapSlow,
        onIntent: async objectId => {
          snapshot.satelliteObjectIntent = { objectId, namespace: "whatsapp-satellite", ownerId: userId };
          await storage.updateWhatsappMapMessage(message.id, conversationId, message.content, snapshot);
        },
      });
      snapshot.satelliteArtifact = artifact;
      // Natural-language map requests are the only permitted second generation.
      // Persist the real artifact first, so a retry never selects another image.
      if (!snapshot.mapAnalysisCompleted) {
        await storage.updateWhatsappMapMessage(message.id, conversationId, message.content, snapshot);
        const card = snapshot.mapCard ? null : await buildWhatsappParcelCard(storage, parcel, userId,
          snapshot.userText || options.text, await storage.getRecentMessagesByConversation(conversationId, 6),
          { deferSatelliteRefresh: true });
        const started = Date.now();
        const analysis = await timeMapStage(mapRequestId, "model", () => generateWhatsappTurn({
          text: snapshot.userText || options.text, card: snapshot.mapCard || card!.text,
          parcelContext: { parcel, parcelData: [], soilAnalysis: card?.soil || null,
            tillagePractices: [], cropRotation: [], animalIntegration: null, livelihood: null,
            cycleDetail: card?.cycle || null },
          messageAt: new Date(message.createdAt), mode: snapshot.responseMode || "brief",
          mapSummary: artifact.summary, mapRequest: snapshot.satelliteRequest, analysisOnly: true,
        }));
        snapshot.mapInterpretation = analysis.response;
        snapshot.recommendedFieldAction = analysis.recommendedFieldAction;
        snapshot.mapAnalysisCompleted = true;
        snapshot.modelCalls = (snapshot.modelCalls || 1) + 1;
        recordWhatsappMetric({ stage: "model", durationMs: Date.now() - started, success: true,
          model: analysis.modelUsed, inputTokens: analysis.inputTokens, outputTokens: analysis.outputTokens });
      }
      content = satelliteCaption(artifact, snapshot.mapInterpretation || "", snapshot.responseMode === "detailed", new Date(message.createdAt));
    } catch (error) {
      if (!(error instanceof SatelliteUnavailable)) throw error;
      content = snapshot.ledgerRecord ? `Anoté tu reporte.\n${error.message}` : error.message;
      snapshot.satelliteError = true;
      snapshot.recommendedFieldAction = false;
      if (!snapshot.ledgerRecord) snapshot.interactionButtons = undefined;
    }
    snapshot.satelliteCompleted = true;
    await storage.updateWhatsappMapMessage(message.id, conversationId, content, snapshot);
    return { ...message, content, contextSnapshot: snapshot };
  };
  // Completion is persisted before ledger mutation. Retries apply the saved decision
  // idempotently; they never need to ask the model a second time.
  const applyRecord = async (snapshot: any) => {
    if (!snapshot?.ledgerRecord) return;
    const alreadyApplied = await storage.getFieldLogBySourceMessage(providerMessageId);
    if (alreadyApplied) return;
    const evidence = options.media
      ? await saveFieldLogEvidence(userId, providerMessageId, options.media)
      : snapshot.evidence || [];
    const record = snapshot.ledgerRecord;
    if (snapshot.correctedEntryId) {
      await storage.reviseFieldLog(snapshot.correctedEntryId, userId, providerMessageId,
        snapshot.expectedRevision, {
          activityType: record.activityType, occurredAt: record.occurredAt ? civilDateInstant(record.occurredAt) : null,
          structuredData: record, missingFields: [], confidence: record.confidence,
          correctionText: options.text, evidence,
        });
    } else {
      await storage.saveAutomaticFieldLog({
        userId, parcelId, cycleDetailId: snapshot.cycleDetailId,
        sourceProviderMessageId: providerMessageId, originalText: snapshot.userText,
        transcription: snapshot.transcription, activityType: record.activityType,
        occurredAt: record.occurredAt ? civilDateInstant(record.occurredAt) : null, structuredData: record,
        confidence: record.confidence, missingFields: record.occurredAt ? [] : ["fecha exacta"], evidence,
      });
    }
  };
  const ensureFollowUp = async (message: any) => {
    const snapshot = message.contextSnapshot as any;
    if (!snapshot?.recommendedFieldAction || !options.connectionId) return;
    await storage.createInteractionState({
      conversationId, userId, parcelId, kind: "follow_up", status: "scheduled",
      sourceMessageId: message.id, prompt: "¿Realizaste la recomendación y qué resultado obtuviste?",
      payload: { connectionId: options.connectionId, parcelName: parcel.name, assistantMessageId: message.id },
      dueAt: new Date(new Date(message.createdAt).getTime() + 24 * 60 * 60 * 1000),
      expiresAt: new Date(new Date(message.createdAt).getTime() + 7 * 24 * 60 * 60 * 1000),
    });
  };
  const finishCommandState = async (message: any) => {
    const s = message.contextSnapshot as any;
    if (s?.pendingCorrection) await storage.createInteractionState({
      conversationId, userId, parcelId, kind: "clarification", status: "pending",
      sourceMessageId: message.id, prompt: message.content, payload: s.pendingCorrection,
      expiresAt: new Date(new Date(message.createdAt).getTime() + 24 * 60 * 60 * 1000),
    });
    if (s?.pendingRecord) await storage.createInteractionState({
      conversationId, userId, parcelId, kind: "clarification", status: "pending",
      sourceMessageId: message.id, prompt: "¿Lo anoto en tu bitácora?", payload: s.pendingRecord,
      expiresAt: new Date(new Date(message.createdAt).getTime() + 24 * 60 * 60 * 1000),
    });
    if (s?.resolvedCorrectionStateId)
      await storage.resolveInteractionState(s.resolvedCorrectionStateId, userId, "resolved");
  };
  if (savedAssistant) {
    await applyRecord(priorSnapshot);
    if (priorSnapshot?.cancelledEntryId) {
      await storage.rejectFieldLog(priorSnapshot.cancelledEntryId, userId, providerMessageId, priorSnapshot.expectedRevision);
    }
    await finishCommandState(savedAssistant);
    const finished = await finishMap(savedAssistant);
    await ensureFollowUp(finished);
    return finished.content;
  }
  const transcription = savedUser
    ? (savedUser.contextSnapshot as any)?.transcription
    : options.audio ? await transcribeWhatsappAudio(options.audio.buffer, options.audio.mimeType) : undefined;
  const text = savedUser?.content || [options.text.trim(), transcription].filter(Boolean).join("\n\n")
    || (options.imageDataUrl ? "Imagen de la parcela" : "Mensaje recibido");
  const userMessage = savedUser || await storage.createMessage({
    conversationId, role: "user", content: text, imageUrl: null,
    contextSnapshot: { channel: "whatsapp", providerMessageId,
      imageAttached: Boolean(options.imageDataUrl), audioAttached: Boolean(options.audio),
      transcription, transcriptionStatus: options.audio ? "completed" : undefined,
      sourceKind: options.audio ? "audio" : options.imageDataUrl ? "image" : "text" },
  });
  const messageAt = new Date(userMessage.createdAt);
  await storage.promoteLegacyFieldLogs(userId, parcelId);
  const logs = newestFieldLogs(await storage.getActiveFieldLogs(userId, parcelId));
  const correctionState = await storage.getOpenInteractionState(conversationId, "clarification", ["pending"]);
  const statePayload = correctionState?.payload as any;
  if (options.interactionTargetId && /^(s[ií]|no)$/i.test(text.trim()) &&
      statePayload?.purpose === "field_log_consent" &&
      options.interactionTargetId !== correctionState?.sourceMessageId) {
    const content = "Esa pregunta no es la confirmación pendiente. Responde a la pregunta vigente para no registrar otra labor.";
    await storage.createMessage({ conversationId, role: "assistant", content,
      contextSnapshot: { channel: "whatsapp", providerMessageId } });
    return content;
  }
  if (statePayload?.purpose === "field_log_consent" &&
      (!options.interactionTargetId || options.interactionTargetId === correctionState?.sourceMessageId) &&
      /^(s[ií]|no)$/i.test(text.trim())) {
    const yes = /^s[ií]$/i.test(text.trim());
    const record = yes ? statePayload.record : null;
    const responseText = yes ? record.occurredAt
      ? whatsappLedgerReceipt(record, messageAt)
      : `Dejé ${record.activityType} pendiente, sin fecha exacta. ¿En qué fecha ocurrió?`
      : "No lo guardé en tu bitácora.";
    const snapshot = { channel: "whatsapp", providerMessageId, responseContract: "whatsapp-ledger-v2",
      ledgerRecord: record, userText: statePayload.originalText, cycleDetailId: statePayload.cycleDetailId,
      resolvedCorrectionStateId: correctionState!.id,
      evidence: statePayload.evidence || [],
      interactionButtons: record ? "field-log" : undefined };
    const response = await storage.createMessage({ conversationId, role: "assistant", content: responseText, contextSnapshot: snapshot });
    await applyRecord(snapshot);
    await finishCommandState(response);
    return responseText;
  }
  if (options.interactionTargetId && /^(s[ií]|no)$/i.test(text.trim()) &&
      statePayload?.purpose !== "field_log_consent") {
    const content = "Esa confirmación ya terminó o venció. Vuelve a enviar el hecho si deseas registrarlo.";
    await storage.createMessage({ conversationId, role: "assistant", content,
      contextSnapshot: { channel: "whatsapp", providerMessageId } });
    return content;
  }
  const pendingCorrection = ["field_log_correction", "field_log_correction_choice"].includes(statePayload?.purpose);
  const correctionTarget = statePayload?.purpose === "field_log_correction" && statePayload.explicitTarget !== false
    ? statePayload.targetProviderMessageId : undefined;
  const cancelling = /^(cancelar|cancela|rechazar)$/i.test(text.trim());
  const correcting = !cancelling && (/^(corregir|corrige)\b/i.test(text.trim()) || pendingCorrection);
  const targetProvider = options.interactionTargetId || (!cancelling ? correctionTarget : undefined);
  const choiceLogs = statePayload?.purpose === "field_log_correction_choice"
    ? logs.filter(l => statePayload.candidateProviderMessageIds?.includes(l.sourceProviderMessageId)) : logs;
  const selection = selectCorrectionTarget(text, choiceLogs);
  const choiceNumber = statePayload?.purpose === "field_log_correction_choice" && /^\s*\d+\s*$/.test(text)
    ? choiceLogs.find(l => l.sourceProviderMessageId === statePayload.candidateProviderMessageIds[Number(text.trim()) - 1])
    : undefined;
  let target = targetProvider ? await storage.getFieldLogBySourceMessage(targetProvider)
    : correcting ? choiceNumber || selection.target : logs[0];
  if (target && (target.userId !== userId || target.parcelId !== parcelId)) {
    throw new Error("Registro de otra parcela");
  }
  if (/^confirmar$/i.test(text.trim())) {
    const response = `El registro${logs[0] ? ` de ${fieldLogLabel(logs[0])}` : ""} ya quedó guardado automáticamente. Puedes usar CORREGIR o CANCELAR.`;
    await storage.createMessage({ conversationId, role: "assistant", content: response,
      contextSnapshot: { channel: "whatsapp", providerMessageId, responseContract: "whatsapp-ledger-v2" } });
    return response;
  }
  if (correcting && !targetProvider && !choiceNumber && (selection.candidates.length ||
      (statePayload?.purpose === "field_log_correction_choice" && !selection.matched && choiceLogs.length > 1))) {
    const candidates = selection.candidates.length ? selection.candidates : choiceLogs;
    const response = `¿Cuál registro quieres corregir: ${candidates.map((l, i) => `${i + 1}) ${fieldLogLabel(l)}`).join("; ")}?`;
    const reply = await storage.createMessage({ conversationId, role: "assistant", content: response,
      contextSnapshot: { channel: "whatsapp", providerMessageId, responseContract: "whatsapp-ledger-v2",
        pendingCorrection: { purpose: "field_log_correction_choice", correctionText: text,
          candidateProviderMessageIds: candidates.map(l => l.sourceProviderMessageId) } } });
    if (correctionState) await storage.resolveInteractionState(correctionState.id, userId, "resolved");
    await finishCommandState(reply);
    return response;
  }
  if (cancelling || (correcting && (!target || !text.replace(/^(corregir|corrige)\s*/i, "").trim()))) {
    const response = !target ? "No hay un registro vigente para esa acción."
      : cancelling ? `Cancelé ${fieldLogLabel(target)}; conservé su historial de revisiones.`
      : `Indica el cambio para ${fieldLogLabel(target)} después de CORREGIR. Ejemplo: CORREGIR fueron 25 kg.`;
    const snapshot = { channel: "whatsapp", providerMessageId,
      cancelledEntryId: cancelling ? target?.id : undefined, expectedRevision: target?.currentRevision,
      responseContract: "whatsapp-ledger-v2",
      resolvedCorrectionStateId: cancelling && pendingCorrection ? correctionState?.id : undefined,
      pendingCorrection: correcting && target ? { purpose: "field_log_correction",
        targetProviderMessageId: target.sourceProviderMessageId, explicitTarget: Boolean(targetProvider) } : undefined };
    const reply = await storage.createMessage({ conversationId, role: "assistant", content: response, contextSnapshot: snapshot });
    if (cancelling && target) await storage.rejectFieldLog(target.id, userId, providerMessageId, target.currentRevision);
    await finishCommandState(reply);
    return response;
  }
  const history = await storage.getRecentMessagesByConversation(conversationId, 6);
  // Decide the turn first; speculative refreshes must not compete with a map.
  const contextStarted = Date.now();
  const card = await buildWhatsappParcelCard(storage, parcel, userId, text, history,
    { deferSatelliteRefresh: true });
  console.info("[whatsapp] context ready", { requestId: mapRequestId, durationMs: Date.now() - contextStarted });
  const parcelContext: ParcelContext = {
    parcel, parcelData: [], soilAnalysis: card.soil || null, tillagePractices: [],
    cropRotation: [], animalIntegration: null, livelihood: null, cycleDetail: card.cycle,
  };
  const commandMap = /^(?:mapa|ver mapa)$/i.test(text.trim());
  const commandRequest = { index: "ndvi" as const, date: null, compare: false };
  let preparedMap: SatelliteArtifact | undefined = (userMessage.contextSnapshot as any)?.satelliteArtifact;
  if (commandMap && !preparedMap) {
    const userSnapshot = { ...(userMessage.contextSnapshot as any) };
    try {
      preparedMap = await prepareWhatsappSatelliteMap({
        storage, parcel, request: commandRequest, now: messageAt, onSlow: options.onMapSlow,
        requestId: mapRequestId, referenceSummary: card.latestSentMap || null,
        onIntent: async objectId => {
          userSnapshot.satelliteObjectIntent = { objectId, namespace: "whatsapp-satellite", ownerId: userId };
          await storage.updateWhatsappMapMessage(userMessage.id, conversationId, userMessage.content, userSnapshot);
        },
      });
      userSnapshot.satelliteArtifact = preparedMap;
      await storage.updateWhatsappMapMessage(userMessage.id, conversationId, userMessage.content, userSnapshot);
    } catch (error) {
      if (!(error instanceof SatelliteUnavailable)) throw error;
      await storage.createMessage({ conversationId, role: "assistant", content: error.message,
        contextSnapshot: { channel: "whatsapp", providerMessageId, responseContract: "whatsapp-ledger-v2",
          satelliteCompleted: true, satelliteError: true } });
      return error.message;
    }
  }
  const startedAt = Date.now();
  const generateTurn = () => generateWhatsappTurn({
    text: statePayload?.purpose === "field_log_correction_choice"
      ? `${statePayload.correctionText}\nRegistro seleccionado por el productor: ${text}` : text,
    imageDataUrl: options.imageDataUrl, card: card.text, parcelContext,
    messageAt, mode: options.responseMode || "brief",
    correction: correcting && target ? target.structuredData : undefined,
    mapSummary: preparedMap?.summary, mapRequest: commandMap ? commandRequest : undefined,
  });
  const turn = commandMap ? await timeMapStage(mapRequestId, "model", generateTurn) : await generateTurn();
  if (turn.fertilizationPlan && !turn.satelliteRequest) {
    const proposed = turn.fertilizationPlan;
    if (!(Number(card.cycle?.expectedYieldTon) > 0) || !(Number(parcel.area) > 0)) proposed.provisional = true;
    const plan = chooseBasePlan(proposed, card.savedPlans, card.planFingerprint);
    if (JSON.stringify(plan) !== JSON.stringify(proposed)) {
      // Do not let prose or a cost calculation contradict the persisted base.
      turn.response = renderBasePlan(plan);
      turn.planCosting = null;
    }
    turn.fertilizationPlan = plan;
    await storage.saveParcelFertilizationPlan(parcel.id, userId, cropPlanKey(plan.crop), {
      fingerprint: card.planFingerprint, savedAt: messageAt.toISOString(), plan,
    });
  }
  if (turn.economicComparison && !card.areaEvidence.comparable) {
    turn.response = `No puedo atribuir todavía esos costos o rentabilidad a las ${parcel.area} ha de la parcela: ${
      card.areaEvidence.warning || "falta confirmar la superficie de los registros"} ${
      card.areaEvidence.sources.map(s => `${s.source}: ${s.areaHa ?? "superficie sin confirmar"}${s.areaHa ? " ha" : ""}`).join("; ")}.`;
    turn.planCosting = null;
    turn.recommendedFieldAction = false;
  }
  if (commandMap) turn.satelliteRequest = commandRequest;
  if (!commandMap && turn.satelliteRequest) recordMapStage(mapRequestId, "model", startedAt, true);
  if (!turn.satelliteRequest) scheduleWhatsappSatelliteRefresh(storage, parcel, card.satelliteObservations || [], messageAt);
  if (options.queryOnly) turn.record = null;
  // An oversized answer keeps its substance. Durable delivery splits text;
  // never replace a recommendation (or its safety conditions) with a format error.
  const needsConsent = Boolean(turn.record && turn.recordingDecision === "ambiguous");
  const proposedRecord = needsConsent ? turn.record : null;
  if (needsConsent) { turn.record = null; turn.response = "¿Lo anoto en tu bitácora?"; turn.recommendedFieldAction = false; }
  if (turn.record) {
    turn.record.activityType = fieldLogActivitySpanish(turn.record.activityType);
    // Ignore an unsolicited model acknowledgement: the server's receipt must
    // match the persisted quantities and costs, including on terse reports.
    turn.response = turn.response.replace(/^(?:anoté|anote|corregí|corregi)\s*:[\s\S]*?(?:\.(?:\s+|$)|\n|$)/i, "").trim();
    const items = turn.record.items.slice(0, 3).map(item =>
      `${item.quantity == null ? "" : `${item.quantity} ${item.unit || ""} `}${item.name.slice(0, 40)}`.trim()).join(", ");
    const receipt = correcting && target ? `Corregí ${fieldLogLabel(target)}: ${items}.`
      : turn.record.occurredAt ? whatsappLedgerReceipt(turn.record, messageAt)
        : `Dejé ${turn.record.activityType} pendiente, sin fecha exacta. ¿En qué fecha ocurrió?`;
    turn.response = `${receipt}${turn.response ? `\n${turn.response}` : ""}`;
  }
  recordWhatsappMetric({ stage: "model", durationMs: Date.now() - startedAt, success: true,
    model: turn.modelUsed, inputTokens: turn.inputTokens, outputTokens: turn.outputTokens });
  const record = turn.record ? {
    ...turn.record, occurredOn: /^\d{4}-\d{2}-\d{2}$/.test(turn.record.occurredAt || "") ? turn.record.occurredAt : null, registration: "automatic",
    totalsByCurrency: turn.record.items.reduce<Record<string, number>>((totals, item) => {
      if (item.cost != null && item.category !== "sale") {
        const currency = item.currency || "MXN";
        totals[currency] = Math.round(((totals[currency] || 0) + item.cost) * 100) / 100;
      }
      return totals;
    }, {}),
  } : null;
  const snapshot = {
    channel: "whatsapp", providerMessageId, responseContract: "whatsapp-ledger-v2",
    modelUsed: turn.modelUsed, providerUsed: turn.providerUsed, fullResponse: turn.response,
    modelCalls: 1,
    sourceKind: options.audio ? "audio" : options.imageDataUrl ? "image" : "text",
    ledgerRecord: record,
    pendingRecord: proposedRecord ? { purpose: "field_log_consent", record: proposedRecord,
      originalText: text, cycleDetailId: card.cycle?.id,
      evidence: options.media ? await saveFieldLogEvidence(userId, providerMessageId, options.media) : [] } : undefined,
    satelliteRequest: turn.satelliteRequest,
    satelliteArtifact: preparedMap,
    mapAnalysisCompleted: Boolean(preparedMap),
    mapCard: turn.satelliteRequest ? card.text : undefined,
    mapReference: turn.satelliteRequest ? card.latestSentMap || null : undefined,
    mapInterpretation: turn.satelliteRequest ? turn.response : undefined,
    responseMode: options.responseMode || "brief",
    deliveryVoicePreference: options.voicePreference || "text",
    evidenceIntent: record && options.media ? {
      kind: options.media.kind, mimeType: options.media.mimeType, size: options.media.size,
      providerMessageId,
    } : null,
    userText: text, transcription,
    cycleDetailId: card.cycle?.id,
    correctedEntryId: correcting && target ? target.id : undefined,
    expectedRevision: correcting ? target?.currentRevision : undefined,
    resolvedCorrectionStateId: correcting && turn.record ? correctionState?.id : undefined,
    interactionButtons: proposedRecord ? "field-consent" : record ? "field-log" : turn.recommendedFieldAction ? "recommendation" : undefined,
    interactionTargetProviderId: correcting && target ? target.sourceProviderMessageId : providerMessageId,
    recommendedFieldAction: turn.recommendedFieldAction,
  };
  const response = await storage.createMessage({
    conversationId, role: "assistant", content: formatWhatsappResponse(turn.response), contextSnapshot: snapshot,
  });
  await applyRecord(snapshot);
  await finishCommandState(response);
  const finished = await finishMap(response);
  await ensureFollowUp(finished);
  if (history.length <= 1) await storage.updateConversationTitle(conversationId, text.slice(0, 50));
  return finished.content;
}

/** Formatting only. Response length is requested at generation, not post-truncated. */
export function formatWhatsappResponse(input: string, _maxLength?: number): string {
  return input.replace(/```[\s\S]*?```/g, "").replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*(system|developer|assistant)\s*:\s*/gim, "").replace(/\n{3,}/g, "\n\n").trim()
    || "No pude generar una orientación segura. Intenta de nuevo con más datos.";
}

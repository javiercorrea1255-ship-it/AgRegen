import type { Express, Request, Response } from "express";
import { whatsappDetailQuery } from "../services/whatsapp-detail";
import { createHash, randomInt } from "node:crypto";
import type { IStorage } from "../storage";
import type { WhatsappMessageEvent } from "@shared/schema";
import {
  downloadWhatsappMedia,
  extractWhatsappText,
  normalizeWhatsappPhone,
  sendWhatsappText,
  sendWhatsappInteractiveButtons,
  sendWhatsappAudioBuffer,
  sendWhatsappImageBuffer,
  sendWhatsappFollowUp,
  sendWhatsappEscalationResolution,
  splitWhatsappText,
  verifyWhatsappSignature,
  verifyWhatsappWebhook,
  whatsappConfigStatus,
  whatsappCanEnableProactiveAlerts,
  whatsappIsConfigured,
  isRetryableWhatsappError,
  WhatsappAmbiguousDeliveryError,
} from "../services/whatsapp-business";
import { processWhatsappAgentMessage } from "../services/whatsapp-agent";
import { readSatellitePng, recordSentSatelliteMap, type SatelliteArtifact } from "../services/whatsapp-satellite";
import { generateWhatsappVoice } from "../services/ai-assistant";
import { recordWhatsappMetric, whatsappEndToEndDuration } from "../services/whatsapp-metrics";
import { WEATHER_ALERT_TYPES, createWeatherAlertSweep } from "../services/weather-alerts";
import { mapTraceId, recordMapStage } from "../services/whatsapp-satellite-cache";

type Guard = (req: Request, res: Response, next: () => void) => void;

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function getIncomingMessages(body: any): any[] {
  const messages: any[] = [];
  for (const entry of Array.isArray(body?.entry) ? body.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      for (const message of Array.isArray(change?.value?.messages) ? change.value.messages : []) {
        messages.push(message);
      }
    }
  }
  return messages;
}

function linkCommand(text: string): string | null {
  const match = text.trim().match(/^(?:VINCULAR|LINK)\s+([0-9]{6})$/i);
  return match?.[1] || null;
}

export function normalizedCommand(text: string, interactiveId?: string): string {
  const buttonCommands: Record<string, string> = {
    menu_weather: "CLIMA",
    menu_parcels: "PARCELAS",
    menu_help: "AYUDA",
    menu_map: "MAPA",
    feedback_helpful: "ÚTIL",
    feedback_not_helpful: "NO ÚTIL",
    response_detail: "MÁS DETALLE",
    human_help: "ASESOR",
    field_confirm: "CONFIRMAR",
    field_correct: "CORREGIR",
    field_cancel: "CANCELAR",
    ledger_yes: "SÍ",
    ledger_no: "NO",
    followup_applied: "APLICADO",
    followup_not_applied: "NO APLICADO",
    followup_success: "FUNCIONÓ",
    followup_failed: "NO FUNCIONÓ",
    alerts_on: "ALERTAS SI",
    alerts_off: "ALERTAS NO",
  };
  const buttonKey = interactiveId?.split(":")[0];
  return (buttonKey && buttonCommands[buttonKey] ? buttonCommands[buttonKey] : text).trim();
}

export function experienceCommand(text: string):
  | "menu" | "parcels" | "voice" | "text" | "brief" | "detailed"
  | "more_detail" | "helpful" | "not_helpful" | "advisor" | "followup_applied"
  | "followup_not_applied" | "followup_success" | "followup_failed" | null {
  const value = text.trim().toLocaleUpperCase("es-MX");
  if (value === "MENU" || value === "MENÚ") return "menu";
  if (value === "PARCELAS" || value === "CAMBIAR PARCELA") return "parcels";
  if (value === "VOZ" || value === "RESPUESTA DE VOZ") return "voice";
  if (value === "TEXTO" || value === "RESPUESTA DE TEXTO") return "text";
  if (value === "BREVE" || value === "RESPUESTA BREVE") return "brief";
  if (value === "DETALLADA" || value === "DETALLE" || value === "RESPUESTA DETALLADA") return "detailed";
  if (value === "MÁS DETALLE" || value === "MAS DETALLE") return "more_detail";
  if (value === "ÚTIL" || value === "UTIL") return "helpful";
  if (value === "NO ÚTIL" || value === "NO UTIL") return "not_helpful";
  if (value === "ASESOR" || value === "HABLAR CON UN TÉCNICO" || value === "HABLAR CON UN TECNICO") return "advisor";
  if (value === "APLICADO") return "followup_applied";
  if (value === "NO APLICADO") return "followup_not_applied";
  if (value === "FUNCIONÓ" || value === "FUNCIONO") return "followup_success";
  if (value === "NO FUNCIONÓ" || value === "NO FUNCIONO") return "followup_failed";
  return null;
}

function normalizeText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

export function alertCommand(text: string): "status" | "yes" | "no" | "help" | null {
  const normalized = text.trim().toLocaleUpperCase("es-MX");
  if (normalized === "ALERTAS") return "status";
  if (normalized === "ALERTAS SI" || normalized === "ALERTAS SÍ") return "yes";
  if (normalized === "ALERTAS NO") return "no";
  if (normalized === "AYUDA") return "help";
  return null;
}

export async function processWeatherAlertCommand(params: {
  command: NonNullable<ReturnType<typeof alertCommand>>;
  providerMessageId: string;
  connection: { id: string; userId: string };
  storage: Pick<IStorage, "getWeatherAlertPreferenceForUser" | "applyWeatherAlertCommand">;
  send: (text: string) => Promise<void>;
}): Promise<void> {
  const { command, providerMessageId, connection, storage, send } = params;
  if (command === "help") {
    await send("Comandos: MENU muestra opciones; MAPA envía el mapa satelital con análisis; PARCELAS cambia parcela; VOZ o TEXTO cambia el formato; BREVE o DETALLADA ajusta la extensión; ALERTAS consulta avisos; ASESOR solicita revisión técnica; ÚTIL o NO ÚTIL califica la última respuesta.");
    return;
  }
  const current = await storage.getWeatherAlertPreferenceForUser(connection.userId);
  if (command === "status") {
    await send(current?.enabled ? "Alertas meteorológicas activas para esta parcela." : "Alertas meteorológicas desactivadas. Envía ALERTAS SI para activarlas.");
    return;
  }
  const enabled = command === "yes";
  if (enabled && !whatsappCanEnableProactiveAlerts()) {
    await send("Las alertas aún no están disponibles porque falta aprobar la plantilla de avisos en Meta. No se activaron; inténtalo cuando el administrador termine la configuración.");
    return;
  }
  await storage.applyWeatherAlertCommand(providerMessageId, connection.userId, connection.id, enabled);
  await send(enabled
    ? "Alertas meteorológicas activadas. Te avisaré sobre pronósticos para esta parcela."
    : "Alertas meteorológicas desactivadas.");
}

export async function sendDurableWhatsappText(
  storage: IStorage,
  inboundId: string,
  to: string,
  text: string,
  purpose: string,
  chunk = 0,
  sender: typeof sendWhatsappText = sendWhatsappText,
): Promise<void> {
  const idempotencyKey = `${inboundId}:${purpose}:${chunk}`;
  const bodyHash = createHash("sha256").update(text).digest("hex");
  const { message, claimed } = await storage.claimWhatsappOutbound({ idempotencyKey, recipient: to, bodyHash });
  if (!claimed) {
    if (message.bodyHash !== bodyHash) {
      console.error("[whatsapp] outbound idempotency body mismatch", { id: inboundId, purpose, chunk });
    }
    if (message.status === "sent") return;
    throw new WhatsappAmbiguousDeliveryError(`WhatsApp delivery is unresolved (${message.status})`);
  }
  try {
    const providerId = await sender(to, text);
    await storage.completeWhatsappOutbound(idempotencyKey, providerId || "unknown", "sent");
  } catch (error) {
    const hasDefiniteHttpStatus = typeof (error as { status?: unknown })?.status === "number";
    await storage.completeWhatsappOutbound(
      idempotencyKey,
      "unknown",
      hasDefiniteHttpStatus ? "failed" : "ambiguous",
      error instanceof Error ? error.message : "send failed",
    );
    throw error;
  }
}

async function sendDurableWhatsappInteractive(
  storage: IStorage,
  inboundId: string,
  to: string,
  body: string,
  buttons: Array<{ id: string; title: string }>,
  purpose: string,
): Promise<void> {
  const idempotencyKey = `${inboundId}:${purpose}:0`;
  const bodyHash = createHash("sha256").update(JSON.stringify({ body, buttons })).digest("hex");
  const { message, claimed } = await storage.claimWhatsappOutbound({ idempotencyKey, recipient: to, bodyHash });
  if (!claimed) {
    if (message.status === "sent") return;
    throw new WhatsappAmbiguousDeliveryError(`WhatsApp delivery is unresolved (${message.status})`);
  }
  try {
    const providerId = await sendWhatsappInteractiveButtons(to, body, buttons);
    await storage.completeWhatsappOutbound(idempotencyKey, providerId, "sent");
  } catch (error) {
    const definite = typeof (error as { status?: unknown })?.status === "number";
    await storage.completeWhatsappOutbound(idempotencyKey, "unknown", definite ? "failed" : "ambiguous", error instanceof Error ? error.message : "send failed");
    throw error;
  }
}

async function sendDurableWhatsappAudio(storage: IStorage, inboundId: string, to: string, text: string, audio: Buffer): Promise<void> {
  const idempotencyKey = `${inboundId}:answer-audio:0`;
  const bodyHash = createHash("sha256").update(text).digest("hex");
  const { message, claimed } = await storage.claimWhatsappOutbound({ idempotencyKey, recipient: to, bodyHash });
  if (!claimed) {
    if (message.status === "sent") return;
    throw new WhatsappAmbiguousDeliveryError(`WhatsApp delivery is unresolved (${message.status})`);
  }
  try {
    const providerId = await sendWhatsappAudioBuffer(to, audio);
    await storage.completeWhatsappOutbound(idempotencyKey, providerId, "sent");
  } catch (error) {
    const definite = typeof (error as { status?: unknown })?.status === "number";
    await storage.completeWhatsappOutbound(idempotencyKey, "unknown", definite ? "failed" : "ambiguous", error instanceof Error ? error.message : "send failed");
    throw error;
  }
}

export async function sendDurableWhatsappImage(storage: IStorage, inboundId: string,
  to: string, artifact: SatelliteArtifact, caption: string,
  sender = sendWhatsappImageBuffer): Promise<void> {
  const key = `${inboundId}:answer-map:0`;
  const bodyHash = createHash("sha256").update(JSON.stringify({
    path: artifact.objectPath, caption, cacheKey: artifact.cacheKey,
  })).digest("hex");
  const { message, claimed } = await storage.claimWhatsappOutbound({ idempotencyKey: key, recipient: to, bodyHash });
  if (!claimed) {
    if (message.bodyHash !== bodyHash) throw new WhatsappAmbiguousDeliveryError("La entrega del mapa cambió durante un reintento.");
    if (message.status === "sent") return;
    throw new WhatsappAmbiguousDeliveryError(`Map delivery is unresolved (${message.status})`);
  }
  // A private-storage failure is definite: no Meta request has been made.
  let image: Buffer;
  try { image = await readSatellitePng(artifact); }
  catch (error) {
    await storage.completeWhatsappOutbound(key, "unknown", "failed", "No se pudo leer el PNG privado");
    throw error;
  }
  try {
    const providerId = await sender(to, image, caption);
    await storage.completeWhatsappOutbound(key, providerId, "sent");
  } catch (error) {
    const definite = typeof (error as { status?: unknown })?.status === "number";
    await storage.completeWhatsappOutbound(key, "unknown", definite ? "failed" : "ambiguous",
      error instanceof Error ? error.message : "send failed");
    throw error;
  }
}

/** Same delivery path for ordinary turns, requested detail, maps, text and voice. */
export async function deliverWhatsappAgentAnswer(options: {
  storage: IStorage; providerMessageId: string; from: string; response: string;
  connection: { userId: string; parcelId: string | null; voicePreference: string | null };
  responseMessage?: { id: string; contextSnapshot: unknown };
}): Promise<void> {
  const { storage, providerMessageId, from, response, connection, responseMessage } = options;
  const snapshot = (responseMessage?.contextSnapshot || {}) as Record<string, any>;
  const voice = (snapshot.deliveryVoicePreference || connection.voicePreference) === "voice";
  const targetProviderId = snapshot.interactionTargetProviderId || providerMessageId;
  const buttons = snapshot.interactionButtons === "field-consent" && responseMessage ? [
    { id: `ledger_yes:${responseMessage.id}`, title: "Sí" },
    { id: `ledger_no:${responseMessage.id}`, title: "No" },
  ] : snapshot.interactionButtons === "field-log" ? [
    { id: `field_correct:${targetProviderId}`, title: "Corregir" },
    { id: `field_cancel:${targetProviderId}`, title: "Cancelar" },
  ] : snapshot.interactionButtons === "recommendation" && responseMessage ? [
    { id: `feedback_helpful:${responseMessage.id}`, title: "Fue útil" },
    { id: `feedback_not_helpful:${responseMessage.id}`, title: "No fue útil" },
    { id: `response_detail:${responseMessage.id}`, title: "Más detalle" },
  ] : [];
  const map = snapshot.satelliteArtifact as SatelliteArtifact | undefined;
  if (map) {
    const caption = voice || response.length > 1024
      ? `${map.name} · ${map.summary.index.toUpperCase()} · ${map.summary.imageDate}` : response;
    await sendDurableWhatsappImage(storage, providerMessageId, from, map, caption);
    await recordSentSatelliteMap(storage, connection.userId, connection.parcelId!, providerMessageId, map);
  }
  const captionHasAnalysis = Boolean(map && !voice && response.length <= 1024);
  const combinedInteractive = !map && !voice && buttons.length > 0 && response.length <= 1024;
  if (!captionHasAnalysis) {
    if (combinedInteractive) {
      await sendDurableWhatsappInteractive(storage, providerMessageId, from, response, buttons, "answer-interactive");
    } else if (voice) {
      try {
        const audio = await generateWhatsappVoice(response);
        await sendDurableWhatsappAudio(storage, providerMessageId, from, response, audio);
      } catch (error) {
        if (error instanceof WhatsappAmbiguousDeliveryError) throw error;
        await sendDurableWhatsappText(storage, providerMessageId, from,
          "No pude generar el audio; te envío la respuesta en texto.", "voice-fallback");
        const chunks = splitWhatsappText(response);
        for (let index = 0; index < chunks.length; index++)
          await sendDurableWhatsappText(storage, providerMessageId, from, chunks[index], "answer", index);
      }
    } else {
      const chunks = splitWhatsappText(response);
      for (let index = 0; index < chunks.length; index++)
        await sendDurableWhatsappText(storage, providerMessageId, from, chunks[index], "answer", index);
    }
  }
  // An image already carries the answer; don't add an extra actions-only message.
  if (!map && !combinedInteractive && buttons.length > 0)
    await sendDurableWhatsappInteractive(storage, providerMessageId, from, "Acciones de esta respuesta:", buttons,
      snapshot.interactionButtons === "field-log" ? "field-log-actions" : "recommendation-actions");
}

export function registerWhatsappRoutes(
  app: Express,
  storage: IStorage,
  isAuthenticated: Guard,
  isActiveUser: Guard,
): void {
  // Meta calls this endpoint once while configuring the webhook.
  app.get("/api/whatsapp/webhook", (req, res) => {
    const challenge = verifyWhatsappWebhook(
      typeof req.query["hub.mode"] === "string" ? req.query["hub.mode"] : undefined,
      typeof req.query["hub.verify_token"] === "string" ? req.query["hub.verify_token"] : undefined,
      typeof req.query["hub.challenge"] === "string" ? req.query["hub.challenge"] : undefined,
    );
    if (challenge) return res.status(200).type("text/plain").send(challenge);
    return res.status(403).send("Verificación rechazada");
  });

  // Always acknowledge quickly; Meta retries slow webhooks. Work happens after 200.
  app.post("/api/whatsapp/webhook", async (req: any, res) => {
    if (!verifyWhatsappSignature(req.rawBody, req.get("x-hub-signature-256"))) {
      return res.status(401).send("Firma inválida");
    }
    if (!whatsappIsConfigured()) return res.sendStatus(200);
    try {
      const batch: Array<{ providerMessageId: string; phoneNumber: string; messageType: string; payload: unknown }> = [];
      for (const message of getIncomingMessages(req.body)) {
        const from = normalizeWhatsappPhone(String(message?.from || ""));
        const providerMessageId = String(message?.id || "");
        if (!from || !providerMessageId) continue;
        batch.push({ providerMessageId, phoneNumber: from, messageType: String(message?.type || "unknown"), payload: message });
      }
      await storage.enqueueWhatsappMessages(batch);
      res.sendStatus(200);
      // Wake the worker immediately. The interval remains as a recovery sweep,
      // but inbound replies must not depend on timer scheduling in production.
      setImmediate(() => void retryPending());
    } catch (error) {
      console.error("[whatsapp] could not persist webhook:", error instanceof Error ? error.message : error);
      return res.status(503).send("Webhook no persistido");
    }
  });

  app.get("/api/whatsapp/status", isAuthenticated, isActiveUser, async (req: any, res) => {
    try {
      const connection = await storage.getWhatsappConnectionForUser(req.user.id);
      res.json({
        ...whatsappConfigStatus(),
        connection: connection ? {
          id: connection.id,
          status: connection.status,
          phoneNumber: connection.phoneNumber ? `••••${connection.phoneNumber.slice(-4)}` : null,
          parcelId: connection.parcelId,
          verifiedAt: connection.verifiedAt,
          lastMessageAt: connection.lastMessageAt,
          voicePreference: connection.voicePreference,
          responseMode: connection.responseMode,
        } : null,
      });
    } catch (error) {
      console.error("[whatsapp/status]", error);
      res.status(500).json({ message: "No se pudo consultar WhatsApp" });
    }
  });

  app.post("/api/whatsapp/link/start", isAuthenticated, isActiveUser, async (req: any, res) => {
    try {
      const parcelId = typeof req.body?.parcelId === "string" ? req.body.parcelId : "";
      if (!parcelId) return res.status(400).json({ message: "Selecciona una parcela" });
      const parcel = await storage.getParcel(parcelId);
      if (!parcel || parcel.userId !== req.user.id) {
        return res.status(403).json({ message: "No tienes acceso a esa parcela" });
      }
      const code = randomInt(100000, 1000000).toString();
      const connection = await storage.createWhatsappConnection({
        userId: req.user.id,
        parcelId,
        phoneNumber: null,
        status: "pending",
        verificationCodeHash: hashCode(code),
        verificationExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
        verifiedAt: null,
        lastMessageAt: null,
      });
      res.json({
        connectionId: connection.id,
        code,
        expiresAt: connection.verificationExpiresAt,
        instructions: `Envía VINCULAR ${code} al número de WhatsApp de AgRegen.`,
      });
    } catch (error) {
      console.error("[whatsapp/link/start]", error);
      res.status(500).json({ message: "No se pudo generar el código de vinculación" });
    }
  });

  app.patch("/api/whatsapp/connection/parcel", isAuthenticated, isActiveUser, async (req: any, res) => {
    try {
      const parcelId = typeof req.body?.parcelId === "string" ? req.body.parcelId : "";
      const parcel = await storage.getParcel(parcelId);
      if (!parcel || parcel.userId !== req.user.id) return res.status(403).json({ message: "Parcela no válida" });
      const connection = await storage.updateWhatsappConnectionParcel(req.user.id, parcelId);
      if (!connection) return res.status(404).json({ message: "WhatsApp no está vinculado" });
      res.json({ connection });
    } catch (error) {
      console.error("[whatsapp/connection/parcel]", error);
      res.status(500).json({ message: "No se pudo cambiar la parcela de WhatsApp" });
    }
  });

  app.delete("/api/whatsapp/connection", isAuthenticated, isActiveUser, async (req: any, res) => {
    try {
      await storage.revokeWhatsappConnection(req.user.id);
      res.json({ success: true });
    } catch (error) {
      console.error("[whatsapp/connection]", error);
      res.status(500).json({ message: "No se pudo desvincular WhatsApp" });
    }
  });

  app.get("/api/whatsapp/alerts", isAuthenticated, isActiveUser, async (req: any, res) => {
    const preference = await storage.getWeatherAlertPreferenceForUser(req.user.id);
    const connection = await storage.getWhatsappConnectionForUser(req.user.id);
    res.json({ preference: preference || null, connection: connection ? { id: connection.id, status: connection.status, parcelId: connection.parcelId } : null });
  });

  app.patch("/api/whatsapp/alerts", isAuthenticated, isActiveUser, async (req: any, res) => {
    try {
      const connection = await storage.getWhatsappConnectionForUser(req.user.id);
      if (!connection || connection.status !== "verified") return res.status(409).json({ message: "WhatsApp verificado es requerido" });
      const body = req.body || {};
      if (body.enabled === true && !whatsappCanEnableProactiveAlerts()) {
        return res.status(409).json({ message: "Configura y aprueba la plantilla de alertas de WhatsApp antes de activarlas" });
      }
      const types = Array.isArray(body.alertTypes) ? body.alertTypes : WEATHER_ALERT_TYPES;
      if (!types.every((type: unknown) => typeof type === "string" && (WEATHER_ALERT_TYPES as readonly string[]).includes(type))) return res.status(400).json({ message: "Tipos de alerta no válidos" });
      const timezone = typeof body.timezone === "string" ? body.timezone : "America/Mexico_City";
      try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }); } catch { return res.status(400).json({ message: "Zona horaria IANA no válida" }); }
      const validTime = (value: unknown) => {
        if (value == null) return true;
        if (typeof value !== "string") return false;
        const match = value.match(/^(\d{2}):(\d{2})$/);
        return Boolean(match && Number(match[1]) <= 23 && Number(match[2]) <= 59);
      };
      if (!validTime(body.quietHoursStart) || !validTime(body.quietHoursEnd)) return res.status(400).json({ message: "Horario silencioso no válido" });
      const dailyCap = body.dailyCap == null ? 3 : Number(body.dailyCap);
      if (!Number.isInteger(dailyCap) || dailyCap < 1 || dailyCap > 20) return res.status(400).json({ message: "Límite diario debe ser entre 1 y 20" });
      const thresholds = body.thresholds && typeof body.thresholds === "object" && !Array.isArray(body.thresholds) ? body.thresholds : {};
      const ranges: Record<string, [number, number]> = {
        frost: [-30, 15], rain: [1, 500], wind: [1, 300], heat: [15, 60],
      };
      if (!Object.entries(thresholds).every(([key, value]) => {
        const range = ranges[key];
        return range && typeof value === "number" && Number.isFinite(value) && value >= range[0] && value <= range[1];
      })) return res.status(400).json({ message: "Umbrales no válidos" });
      const preference = await storage.saveWeatherAlertPreference(req.user.id, {
        connectionId: connection.id, parcelId: connection.parcelId, enabled: body.enabled === true,
        alertTypes: types, thresholds, timezone, quietHoursStart: body.quietHoursStart || null,
        quietHoursEnd: body.quietHoursEnd || null, dailyCap,
      } as any);
      res.json({ preference });
    } catch (error) {
      console.error("[whatsapp/alerts]", error);
      res.status(500).json({ message: "No se pudieron guardar las alertas" });
    }
  });

  app.get("/api/whatsapp/escalations", isAuthenticated, isActiveUser, async (req: any, res) => {
    if (req.user?.role !== "admin") return res.status(403).json({ message: "Acceso de administrador requerido" });
    const status = typeof req.query.status === "string" ? req.query.status : "pending";
    res.json({ escalations: await storage.listEscalations(status) });
  });

  app.patch("/api/whatsapp/escalations/:id", isAuthenticated, isActiveUser, async (req: any, res) => {
    if (req.user?.role !== "admin") return res.status(403).json({ message: "Acceso de administrador requerido" });
    const escalation = (await storage.listEscalations("pending")).find((item) => item.id === req.params.id);
    if (!escalation) return res.status(404).json({ message: "Solicitud no encontrada" });
    const status = req.body?.status === "cancelled" ? "cancelled" : "resolved";
    const note = typeof req.body?.note === "string" ? req.body.note.slice(0, 1000) : "";
    const connection = await storage.getWhatsappConnectionForUser(escalation.userId);
    if (connection?.status === "verified" && connection.phoneNumber) {
      const recipient = normalizeWhatsappPhone(connection.phoneNumber);
      await sendDurableWhatsappText(
        storage,
        escalation.id,
        recipient,
        note ? `El técnico revisó tu solicitud: ${note}` : "El técnico marcó tu solicitud como atendida.",
        "escalation-resolution",
        0,
        () => sendWhatsappEscalationResolution(
          recipient,
          note ? `El técnico revisó tu solicitud: ${note}` : "El técnico marcó tu solicitud como atendida.",
        ),
      );
    }
    const updated = await storage.resolveInteractionState(escalation.id, escalation.userId, status, {
      ...((escalation.payload || {}) as object),
      resolutionNote: note || undefined,
      resolvedBy: req.user.id,
    });
    res.json({ escalation: updated });
  });

  let workerRunning = false;
  const retryPending = async () => {
    if (workerRunning) return;
    workerRunning = true;
    try {
      if (!whatsappIsConfigured()) return;
      const concurrency = Math.min(20, Math.max(1, Number(process.env.WHATSAPP_WORKER_CONCURRENCY || 4)));
      const claimLimit = concurrency * 2;
      const events = await storage.claimWhatsappMessages(claimLimit);
      for (let index = 0; index < events.length; index += concurrency) {
        await Promise.all(events.slice(index, index + concurrency).map(async (event) => {
          try { await processQueuedMessage(event.providerMessageId, storage, event); }
          catch (error) { console.error("[whatsapp] worker failed", { id: event.providerMessageId, attempt: event.attempts, ageMs: Date.now() - event.createdAt.getTime(), error: error instanceof Error ? error.message : "unknown" }); }
        }));
      }
    } catch (error) {
      console.error("[whatsapp] retry sweep failed:", error instanceof Error ? error.message : error);
    } finally {
      workerRunning = false;
    }
  };
  const workerPollMs = Math.min(30_000, Math.max(500, Number(process.env.WHATSAPP_WORKER_POLL_MS || 1_000)));
  setTimeout(() => void retryPending(), 250).unref();
  setInterval(() => void retryPending(), workerPollMs).unref();
  const sweepAlerts = createWeatherAlertSweep({ storage });
  setTimeout(() => void sweepAlerts(), 15_000).unref();
  setInterval(() => void sweepAlerts(), 15 * 60_000).unref();
  let followUpSweepRunning = false;
  const sweepFollowUps = async () => {
    if (followUpSweepRunning || typeof storage.claimDueInteractionStates !== "function") return;
    followUpSweepRunning = true;
    try {
      const due = await storage.claimDueInteractionStates(20);
      for (const item of due) {
        const payload = (item.payload || {}) as Record<string, unknown>;
        try {
          const connection = await storage.getWhatsappConnectionForUser(item.userId);
          if (!connection || connection.status !== "verified" || connection.id !== payload.connectionId || connection.parcelId !== item.parcelId) {
            const cancelled = await storage.updateInteractionState(item.id, item.userId, {
              status: "cancelled", payload: { ...payload, cancelledReason: "connection-not-active" },
            });
            if (!cancelled) throw new Error("No se pudo cancelar el seguimiento revocado");
            continue;
          }
          const phone = normalizeWhatsappPhone(String(connection.phoneNumber || ""));
          if (!phone) throw new Error("Seguimiento sin conexión verificada");
          await sendDurableWhatsappText(
            storage, item.id, phone, `follow-up:${String(payload.parcelName || "")}`, "follow-up", 0,
            () => sendWhatsappFollowUp(phone, String(payload.parcelName || "tu parcela"), item.id),
          );
          const outbound = await storage.getWhatsappOutbound(`${item.id}:follow-up:0`);
          const providerId = outbound?.providerMessageId || "";
          await storage.completeInteractionState(item.id, "sent", { ...payload, providerMessageId: providerId });
        } catch (error) {
          await storage.completeInteractionState(item.id, "failed", {
            ...payload,
            error: error instanceof Error ? error.message : "No se pudo enviar",
          });
        }
      }
    } catch (error) {
      // Includes claim failures and failures while recording an item error.
      // Leave durable records for reconciliation; do not resend in this catch.
      console.error("[whatsapp] follow-up sweep failed:", error instanceof Error ? error.message : "unknown");
    } finally {
      followUpSweepRunning = false;
    }
  };
  setTimeout(() => void sweepFollowUps(), 30_000).unref();
  setInterval(() => void sweepFollowUps(), 60_000).unref();
}

function processQueuedMessageSafely(providerMessageId: string, storage: IStorage, claimed?: WhatsappMessageEvent): void {
  void processQueuedMessage(providerMessageId, storage, claimed).catch((error) => {
    console.error(
      "[whatsapp] queued message processing failed:",
      error instanceof Error ? error.message : "Error desconocido",
    );
  });
}

async function processQueuedMessage(providerMessageId: string, storage: IStorage, claimed?: WhatsappMessageEvent): Promise<void> {
  const processingStartedAt = Date.now();
  const event = claimed || await storage.takeWhatsappMessage(providerMessageId);
  if (!event) return;
  console.info("[whatsapp] worker claim", {
    id: providerMessageId, attempt: event.attempts, stage: event.stage,
    ageMs: Date.now() - event.createdAt.getTime(), correlationId: event.correlationId,
  });
  const message = event.payload as any;
  const from = normalizeWhatsappPhone(String(message?.from || ""));
  if (!from) {
    await storage.completeWhatsappMessage(providerMessageId, "failed", "Número de origen inválido");
    return;
  }
  const leaseHeartbeat = setInterval(() => {
    void storage.touchWhatsappMessage(providerMessageId).catch((error) => {
      console.error("[whatsapp] message lease heartbeat failed:", error instanceof Error ? error.message : error);
    });
  }, 60_000);
  leaseHeartbeat.unref();
  const sendReply = (purpose: string, text: string) =>
    sendDurableWhatsappText(storage, providerMessageId, from, text, purpose);

  try {
    const extracted = extractWhatsappText(message);
    const text = normalizedCommand(extracted.text, extracted.interactiveId);
    const { mediaId, mediaKind } = extracted;
    const interactionTargetId = extracted.interactiveId?.includes(":")
      ? extracted.interactiveId.split(":").slice(1).join(":")
      : undefined;
    const command = linkCommand(text);
    if (command) {
      const alreadyUsed = await storage.getWhatsappConnectionByPhone(from);
      if (alreadyUsed) {
        await sendReply("link-already-used", "Este número ya está vinculado. Desvincúlalo desde AgRegen antes de usar otro código.");
      } else {
        const verified = await storage.consumePendingWhatsappConnection(hashCode(command), from);
        if (!verified) {
        await sendReply("link-invalid", "El código no es válido o ya expiró. Genera uno nuevo desde AgRegen.");
        } else {
          const parcel = await storage.getParcel(verified.parcelId);
          await sendReply("link-success", `Número vinculado correctamente a ${parcel?.name || "tu parcela"}. Ya puedes enviar preguntas o fotos.`);
        }
      }
      await storage.completeWhatsappMessage(providerMessageId, "processed");
      return;
    }

    const connection = await storage.getWhatsappConnectionByPhone(from);
    if (!connection) {
      await sendReply("not-linked", "Este número aún no está vinculado a AgRegen. Pide al administrador de tu cuenta que genere un código y envía: VINCULAR código");
      await storage.completeWhatsappMessage(providerMessageId, "processed");
      return;
    }
    const parcel = await storage.getParcel(connection.parcelId);
    if (!parcel || parcel.userId !== connection.userId) {
      await sendReply("parcel-missing", "No pude encontrar la parcela vinculada. Selecciona otra desde AgRegen.");
      await storage.completeWhatsappMessage(providerMessageId, "failed");
      return;
    }
    const conversation = await storage.getOrCreateWhatsappConversation(connection.userId, connection.parcelId);
    const finishReceiptTransition = async (snapshot: Record<string, unknown>) => {
      const interactionId = typeof snapshot.transitionInteractionId === "string" ? snapshot.transitionInteractionId : "";
      if (!interactionId) return;
      const current = await storage.getInteractionStateForUserAnyStatus(interactionId, connection.userId);
      if (!current) throw new Error("No se encontró la interacción del recibo");
      if (["resolved", "cancelled"].includes(current.status)) return;
      const transitionStatus = snapshot.transitionStatus === "cancelled" ? "cancelled" : "resolved";
      const transitionPayload = snapshot.transitionPayload && typeof snapshot.transitionPayload === "object"
        ? snapshot.transitionPayload
        : current.payload;
      const updated = await storage.resolveInteractionState(interactionId, connection.userId, transitionStatus, transitionPayload);
      if (!updated) throw new Error("No se pudo completar la transición del recibo");
    };
    const priorCommandMessages = await storage.getMessagesByProviderMessage(conversation.id, providerMessageId);
    const priorCommandReceipt = priorCommandMessages.find((item) =>
      item.role === "assistant"
      && (item.contextSnapshot as Record<string, unknown> | null)?.responseContract === "whatsapp-command-receipt-v1");
    if (priorCommandReceipt) {
      const receiptSnapshot = priorCommandReceipt.contextSnapshot as Record<string, unknown>;
      await finishReceiptTransition(receiptSnapshot);
      const purpose = String(receiptSnapshot?.purpose || "command-replay");
      await sendReply(purpose, priorCommandReceipt.content);
      await storage.completeWhatsappMessage(providerMessageId, "processed");
      return;
    }

    const pendingFeedback = typeof storage.getOpenInteractionState === "function"
      ? await storage.getOpenInteractionState(conversation.id, "clarification", ["pending"]).catch(() => undefined)
      : undefined;
    const pendingPayload = (pendingFeedback?.payload || {}) as Record<string, unknown>;
    if (pendingFeedback && pendingPayload.purpose === "feedback_reason" && /^(omitir|cancelar)$/i.test(text)) {
      const receiptText = "Entendido. Conservé la calificación sin pedirte más detalles.";
      const receiptSnapshot = {
        channel: "whatsapp", providerMessageId, responseContract: "whatsapp-command-receipt-v1",
        purpose: "feedback-reason-skip", transitionInteractionId: pendingFeedback.id,
        transitionStatus: "cancelled", transitionPayload: pendingPayload,
      };
      await storage.createMessage({ conversationId: conversation.id, role: "assistant", content: receiptText, contextSnapshot: receiptSnapshot });
      await finishReceiptTransition(receiptSnapshot);
      await sendReply("feedback-reason-skip", receiptText);
      await storage.completeWhatsappMessage(providerMessageId, "processed");
      return;
    }
    if (pendingFeedback && pendingPayload.purpose === "feedback_reason" && text && !experienceCommand(text)
      && !/^PARCELA\b|^ALERTAS\b|^(CONFIRMAR|CORREGIR|CANCELAR)\b/i.test(text)) {
      await storage.upsertRecommendationFeedback({
        conversationId: conversation.id,
        messageId: String(pendingPayload.messageId),
        userId: connection.userId,
        parcelId: connection.parcelId,
        rating: "not_helpful",
        reason: text.slice(0, 500),
      });
      const receiptText = "Gracias. Registré el motivo para mejorar próximas recomendaciones.";
      const transitionPayload = { ...pendingPayload, reason: text.slice(0, 500) };
      const receiptSnapshot = {
        channel: "whatsapp", providerMessageId, responseContract: "whatsapp-command-receipt-v1",
        purpose: "feedback-reason", transitionInteractionId: pendingFeedback.id,
        transitionStatus: "resolved", transitionPayload,
      };
      await storage.createMessage({
        conversationId: conversation.id, role: "assistant", content: receiptText,
        contextSnapshot: receiptSnapshot,
      });
      await finishReceiptTransition(receiptSnapshot);
      await sendReply("feedback-reason", receiptText);
      await storage.completeWhatsappMessage(providerMessageId, "processed");
      return;
    }

    const parcelSelection = text.match(/^PARCELA\s+(.+)$/i)?.[1]?.trim();
    if (parcelSelection) {
      const parcels = await storage.getParcelsByUser(connection.userId);
      const numeric = Number(parcelSelection);
      const selected = Number.isInteger(numeric) && numeric >= 1
        ? parcels[numeric - 1]
        : parcels.find((candidate) => normalizeText(candidate.name) === normalizeText(parcelSelection));
      if (!selected) {
        await sendReply("parcel-invalid", `No encontré esa parcela. Envía PARCELAS para ver opciones.`);
      } else {
        await storage.updateWhatsappConnectionParcel(connection.userId, selected.id);
        await sendReply("parcel-changed", `Listo. Ahora responderé usando la parcela ${selected.name}. El contexto anterior no se mezclará.`);
      }
      await storage.completeWhatsappMessage(providerMessageId, "processed");
      return;
    }

    const uxCommand = experienceCommand(text);
    if (uxCommand) {
      const recent = await storage.getRecentMessagesByConversation(conversation.id, 20);
      const boundAssistant = interactionTargetId
        ? await storage.getMessageInConversation(interactionTargetId, conversation.id)
        : undefined;
      const latestAssistant = interactionTargetId
        ? (boundAssistant?.role === "assistant" ? boundAssistant : undefined)
        : [...recent].reverse().find((item) => item.role === "assistant");
      if (uxCommand === "menu") {
        await sendDurableWhatsappInteractive(storage, providerMessageId, from, "¿Qué quieres hacer? Para el clima también puedes escribir CLIMA.", [
          { id: "menu_map", title: "Ver mapa" },
          { id: "menu_parcels", title: "Cambiar parcela" },
          { id: "human_help", title: "Hablar con técnico" },
        ], "menu");
      } else if (uxCommand === "parcels") {
        const parcels = await storage.getParcelsByUser(connection.userId);
        const list = parcels.slice(0, 20).map((item, index) => `${index + 1}. ${item.name}${item.id === connection.parcelId ? " (actual)" : ""}`).join("\n");
        await sendReply("parcels", `Tus parcelas:\n${list || "No hay parcelas disponibles."}\n\nPara cambiar envía PARCELA número o PARCELA nombre.`);
      } else if (uxCommand === "voice" || uxCommand === "text") {
        await storage.updateWhatsappExperiencePreferences(connection.userId, { voicePreference: uxCommand });
        await sendReply("voice-preference", uxCommand === "voice" ? "Listo. Enviaré las próximas respuestas como audio." : "Listo. Enviaré las próximas respuestas como texto.");
      } else if (uxCommand === "brief" || uxCommand === "detailed") {
        await storage.updateWhatsappExperiencePreferences(connection.userId, { responseMode: uxCommand });
        await sendReply("response-mode", uxCommand === "brief" ? "Usaré respuestas breves con la acción principal primero." : "Usaré respuestas detalladas con evidencia y pasos completos.");
      } else if (uxCommand === "more_detail") {
        const priorSnapshot = latestAssistant?.contextSnapshot as any;
        const original = priorSnapshot?.userText || [...recent].reverse().find(item =>
          item.role === "user" && +new Date(item.createdAt) <= +new Date(latestAssistant?.createdAt || 0))?.content;
        const detail = latestAssistant ? await processWhatsappAgentMessage({
          storage, userId: connection.userId, parcelId: connection.parcelId,
          conversationId: conversation.id, providerMessageId,
          text: whatsappDetailQuery(latestAssistant, original),
          responseMode: "detailed", queryOnly: true, connectionId: connection.id,
          voicePreference: connection.voicePreference,
          onMapSlow: () => sendReply("map-preparing", "Estoy preparando tu mapa con la imagen satelital disponible."),
        }) : undefined;
        if (detail) {
          const messages = await storage.getMessagesByProviderMessage(conversation.id, providerMessageId);
          await deliverWhatsappAgentAnswer({ storage, providerMessageId, from, response: detail, connection,
            responseMessage: messages.find(m => m.role === "assistant") });
        } else await sendReply("more-detail", "Aún no hay una recomendación anterior para ampliar.");
      } else if (uxCommand === "helpful" || uxCommand === "not_helpful") {
        if (!latestAssistant) {
          await sendReply("feedback-missing", "Aún no hay una recomendación para calificar.");
        } else {
          await storage.upsertRecommendationFeedback({
            conversationId: conversation.id, messageId: latestAssistant.id,
            userId: connection.userId, parcelId: connection.parcelId,
            rating: uxCommand === "helpful" ? "helpful" : "not_helpful",
          });
          if (uxCommand === "helpful") {
            await sendReply("feedback-helpful", "Gracias. Registré que la recomendación fue útil.");
          } else {
            const prompt = "Gracias. ¿Qué faltó o qué estuvo incorrecto? Responde con una frase o escribe OMITIR.";
            await storage.createInteractionState({
              conversationId: conversation.id, userId: connection.userId, parcelId: connection.parcelId,
              kind: "clarification", status: "pending", sourceMessageId: latestAssistant.id, prompt,
              payload: { purpose: "feedback_reason", messageId: latestAssistant.id },
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            });
            await sendReply("feedback-not-helpful", prompt);
          }
        }
      } else if (uxCommand === "advisor") {
        await storage.createInteractionState({
          conversationId: conversation.id, userId: connection.userId, parcelId: connection.parcelId,
          kind: "escalation", status: "pending", sourceMessageId: latestAssistant?.id,
          prompt: "Solicita revisión de un técnico",
          payload: {
            reason: text, priority: "normal", parcelName: parcel.name,
            handoffSummary: latestAssistant?.content?.slice(0, 1200),
          },
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });
        await sendReply("advisor", "Registré tu solicitud. Un técnico podrá revisar la parcela y el resumen de esta conversación sin que tengas que repetirlo.");
      } else {
        const openFollowUps = interactionTargetId
          ? []
          : await storage.listOpenInteractionStates(conversation.id, "follow_up", ["sent"]);
        const followUp = interactionTargetId
          ? await storage.getInteractionStateForUser(interactionTargetId, connection.userId, "follow_up")
          : openFollowUps.length === 1 ? openFollowUps[0] : undefined;
        if (!followUp) {
          await sendReply("followup-missing", openFollowUps.length > 1
            ? "Hay varios seguimientos pendientes. Usa los botones del mensaje correspondiente."
            : "No hay un seguimiento pendiente para registrar.");
        } else {
          const outcomes: Record<string, string> = {
            followup_applied: "applied", followup_not_applied: "not_applied",
            followup_success: "successful", followup_failed: "unsuccessful",
          };
          const outcome = outcomes[uxCommand];
          const payload = { ...((followUp.payload || {}) as object), outcome };
          if (outcome === "applied") {
            const updated = await storage.updateInteractionState(followUp.id, connection.userId, { status: "sent", payload });
            if (!updated) throw new Error("El seguimiento ya fue atendido");
            await sendDurableWhatsappInteractive(storage, providerMessageId, from, "Registré que la aplicaste. ¿Cuál fue el resultado?", [
              { id: `followup_success:${followUp.id}`, title: "Funcionó" },
              { id: `followup_failed:${followUp.id}`, title: "No funcionó" },
            ], "followup-result");
          } else {
            const receiptText = "Gracias. Guardé el resultado para mejorar el seguimiento de esta parcela.";
            const receiptSnapshot = {
              channel: "whatsapp", providerMessageId, responseContract: "whatsapp-command-receipt-v1",
              purpose: "followup-recorded", transitionInteractionId: followUp.id,
              transitionStatus: "resolved", transitionPayload: payload,
            };
            await storage.createMessage({
              conversationId: conversation.id, role: "assistant", content: receiptText,
              contextSnapshot: receiptSnapshot,
            });
            await finishReceiptTransition(receiptSnapshot);
            await sendReply("followup-recorded", receiptText);
          }
        }
      }
      await storage.completeWhatsappMessage(providerMessageId, "processed");
      return;
    }
    const alerts = alertCommand(text);
    if (alerts) {
      await processWeatherAlertCommand({
        command: alerts,
        providerMessageId,
        connection,
        storage,
        send: async (reply) => { await sendReply(`alert-${alerts}`, reply); },
      });
      await storage.completeWhatsappMessage(providerMessageId, "processed");
      return;
    }

    if (mediaId) {
      await sendReply("processing", "Recibí tu archivo. Lo estoy revisando y te responderé en cuanto termine.");
    }

    let imageDataUrl: string | undefined;
    let audio: { buffer: Buffer; mimeType: string; size: number } | undefined;
    let media: { buffer: Buffer; mimeType: string; size: number; kind: "image" | "audio" } | undefined;
    const mediaStartedAt = Date.now();
    if (mediaId && mediaKind === "image") {
      const downloaded = await downloadWhatsappMedia(mediaId, "image");
      imageDataUrl = downloaded.dataUrl;
      media = { buffer: downloaded.buffer, mimeType: downloaded.mimeType, size: downloaded.size, kind: "image" };
    } else if (mediaId && mediaKind === "audio") {
      const downloaded = await downloadWhatsappMedia(mediaId, "audio");
      audio = { buffer: downloaded.buffer, mimeType: downloaded.mimeType, size: downloaded.size };
      media = { ...audio, kind: "audio" };
    }
    const mediaDurationMs = Date.now() - mediaStartedAt;
    if (!text && !imageDataUrl && !audio) {
      await sendReply("unsupported", "Puedo recibir preguntas escritas, fotos JPG/PNG/WebP y notas de voz.");
      await storage.completeWhatsappMessage(providerMessageId, "processed");
      return;
    }

    const agentStartedAt = Date.now();
    const response = await processWhatsappAgentMessage({
      storage,
      userId: connection.userId,
      parcelId: connection.parcelId,
      conversationId: conversation.id,
      text,
      imageDataUrl,
      audio,
      media,
      providerMessageId,
      responseMode: connection.responseMode === "detailed" ? "detailed" : "brief",
      phoneNumber: from,
      connectionId: connection.id,
      interactionTargetId: /^(?:field_|ledger_)/.test(extracted.interactiveId || "") ? interactionTargetId : undefined,
      onMapSlow: () => sendReply("map-preparing", "Estoy preparando tu mapa con la imagen satelital disponible."),
      voicePreference: connection.voicePreference,
    });
    const agentDurationMs = Date.now() - agentStartedAt;
    const sendStartedAt = Date.now();
    const responseMessages = await storage.getMessagesByProviderMessage(conversation.id, providerMessageId);
    const responseMessage = responseMessages.find((item) => item.role === "assistant");
    let sent = false;
    try {
      await deliverWhatsappAgentAnswer({ storage, providerMessageId, from, response, connection, responseMessage });
      sent = true;
    } finally {
      const snapshot = responseMessage?.contextSnapshot as any;
      if (snapshot?.satelliteRequest || snapshot?.satelliteArtifact || snapshot?.satelliteError)
        recordMapStage(mapTraceId(providerMessageId), "send", sendStartedAt, sent);
    }
    const sendDurationMs = Date.now() - sendStartedAt;
    await storage.recordWhatsappMessage(connection.id);
    await storage.completeWhatsappMessage(providerMessageId, "processed");
    recordWhatsappMetric({ stage: "queue", durationMs: processingStartedAt - event.createdAt.getTime(), success: true });
    recordWhatsappMetric({ stage: "media", durationMs: mediaDurationMs, success: true });
    recordWhatsappMetric({ stage: "send", durationMs: sendDurationMs, success: true });
    recordWhatsappMetric({ stage: "total", durationMs: whatsappEndToEndDuration(event.createdAt), success: true });
    console.info("[whatsapp] worker complete", {
      id: providerMessageId,
      mapRequestId: mapTraceId(providerMessageId),
      correlationId: event.correlationId,
      attempt: event.attempts,
      queueAgeMs: processingStartedAt - event.createdAt.getTime(),
      mediaDurationMs,
      agentDurationMs,
      sendDurationMs,
      totalDurationMs: whatsappEndToEndDuration(event.createdAt),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Error desconocido";
    const retryable = isRetryableWhatsappError(error);
    recordWhatsappMetric({ stage: "total", durationMs: whatsappEndToEndDuration(event.createdAt), success: false });
    await storage.completeWhatsappMessage(providerMessageId, retryable ? "failed" : "dead", errorMessage).catch(() => undefined);
    // Avoid sending the same failure notice on every automatic retry.
    if ((!retryable || event.attempts >= 5) && !(error instanceof WhatsappAmbiguousDeliveryError)) {
      console.error("[whatsapp] dead-letter", { id: providerMessageId, attempt: event.attempts, stage: event.stage });
      await sendReply("terminal-error", "No pude procesar tu consulta en este momento. Intenta nuevamente en unos minutos.").catch(() => undefined);
    }
    throw error;
  } finally {
    clearInterval(leaseHeartbeat);
  }
}
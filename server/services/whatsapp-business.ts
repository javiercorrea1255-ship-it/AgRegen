import { createHmac, timingSafeEqual } from "node:crypto";

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export interface WhatsappMedia {
  dataUrl: string;
  buffer: Buffer;
  mimeType: string;
  size: number;
}

export type WhatsappMediaKind = "image" | "audio";

export class WhatsappProviderError extends Error {
  readonly status?: number;
  readonly retryable: boolean;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "WhatsappProviderError";
    this.status = status;
    this.retryable = status === 429 || (status !== undefined && status >= 500) || status === undefined;
  }
}

export class WhatsappAmbiguousDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WhatsappAmbiguousDeliveryError";
  }
}

export function isRetryableWhatsappError(error: unknown): boolean {
  return error instanceof WhatsappProviderError ? error.retryable : error instanceof Error && /timeout|timed out|network|fetch/i.test(error.message);
}

/** Exponential delay with bounded jitter, exported for worker policy/tests. */
export function whatsappRetryDelay(attempt: number, random = Math.random()): number {
  const n = Math.max(1, Math.floor(attempt));
  const base = Math.min(300_000, 5_000 * 2 ** (n - 1));
  return Math.floor(base * (0.8 + Math.max(0, Math.min(1, random)) * 0.4));
}

function withTimeout(ms: number): AbortSignal {
  return AbortSignal.timeout ? AbortSignal.timeout(ms) : (() => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms).unref();
    return controller.signal;
  })();
}

const MEDIA_RULES: Record<WhatsappMediaKind, {
  maxBytes: number;
  mimePattern: RegExp;
  label: string;
}> = {
  image: {
    maxBytes: 10 * 1024 * 1024,
    mimePattern: /^image\/(jpeg|png|webp)$/i,
    label: "imagen",
  },
  audio: {
    maxBytes: 16 * 1024 * 1024,
    mimePattern: /^audio\/(ogg|opus|mpeg|mp3|mp4|m4a|aac|amr|wav|x-wav)$/i,
    label: "audio",
  },
};

export function isValidWhatsappAudio(buffer: Buffer, mimeType: string): boolean {
  if (buffer.length < 7) return false;
  const starts = (value: string) => buffer.subarray(0, value.length).toString("ascii") === value;
  const normalized = mimeType.toLowerCase();
  const validOggOpus = () => {
    if (buffer.length < 36 || !starts("OggS") || buffer[4] !== 0) return false;
    const segmentCount = buffer[26];
    if (!segmentCount || buffer.length < 27 + segmentCount) return false;
    let payloadLength = 0;
    for (let index = 0; index < segmentCount; index++) payloadLength += buffer[27 + index];
    const payloadStart = 27 + segmentCount;
    if (payloadLength < 8 || buffer.length < payloadStart + payloadLength) return false;
    return buffer.subarray(payloadStart, payloadStart + Math.min(payloadLength, 64)).includes(Buffer.from("OpusHead"));
  };
  if (normalized === "audio/ogg") return validOggOpus();
  if (normalized === "audio/opus") {
    return validOggOpus();
  }
  if (normalized === "audio/wav" || normalized === "audio/x-wav") {
    if (buffer.length < 44 || !starts("RIFF") || buffer.subarray(8, 12).toString("ascii") !== "WAVE") return false;
    const declaredSize = buffer.readUInt32LE(4) + 8;
    return declaredSize <= buffer.length
      && buffer.includes(Buffer.from("fmt "), 12)
      && buffer.includes(Buffer.from("data"), 12);
  }
  if (normalized === "audio/mpeg" || normalized === "audio/mp3") {
    if (starts("ID3") && buffer.length >= 10) {
      const tagSize = ((buffer[6] & 0x7f) << 21) | ((buffer[7] & 0x7f) << 14)
        | ((buffer[8] & 0x7f) << 7) | (buffer[9] & 0x7f);
      return tagSize + 10 <= buffer.length;
    }
    return buffer.length >= 24 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0;
  }
  if (normalized === "audio/mp4" || normalized === "audio/m4a") {
    if (buffer.length < 16 || buffer.subarray(4, 8).toString("ascii") !== "ftyp") return false;
    const boxSize = buffer.readUInt32BE(0);
    return boxSize >= 16 && boxSize <= buffer.length;
  }
  if (normalized === "audio/aac") {
    if (buffer[0] !== 0xff || (buffer[1] !== 0xf1 && buffer[1] !== 0xf9)) return false;
    const frameLength = ((buffer[3] & 0x03) << 11) | (buffer[4] << 3) | ((buffer[5] & 0xe0) >> 5);
    return frameLength >= 7 && frameLength <= buffer.length;
  }
  if (normalized === "audio/amr") {
    const headerLength = starts("#!AMR-WB\n") ? 9 : starts("#!AMR\n") ? 6 : 0;
    return headerLength > 0 && buffer.length >= headerLength + 13;
  }
  return false;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} no está configurado`);
  return value;
}

export function whatsappIsConfigured(): boolean {
  return Boolean(
    process.env.WHATSAPP_ACCESS_TOKEN &&
    process.env.WHATSAPP_PHONE_NUMBER_ID &&
    process.env.WHATSAPP_VERIFY_TOKEN &&
    (process.env.NODE_ENV !== "production" || process.env.WHATSAPP_APP_SECRET),
  );
}

export function whatsappConfigStatus() {
  return {
    configured: whatsappIsConfigured(),
    phoneNumberConfigured: Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID),
    accessTokenConfigured: Boolean(process.env.WHATSAPP_ACCESS_TOKEN),
    appSecretConfigured: Boolean(process.env.WHATSAPP_APP_SECRET),
    alertTemplateConfigured: Boolean(process.env.WHATSAPP_ALERT_TEMPLATE_NAME),
  };
}

export function whatsappCanEnableProactiveAlerts(): boolean {
  return process.env.NODE_ENV !== "production" || Boolean(process.env.WHATSAPP_ALERT_TEMPLATE_NAME);
}

export function verifyWhatsappWebhook(
  mode: string | undefined,
  token: string | undefined,
  challenge: string | undefined,
): string | null {
  if (
    mode === "subscribe" &&
    token &&
    challenge &&
    process.env.WHATSAPP_VERIFY_TOKEN &&
    token === process.env.WHATSAPP_VERIFY_TOKEN
  ) {
    return challenge;
  }
  return null;
}

export function verifyWhatsappSignature(rawBody: Buffer | undefined, signature: string | undefined): boolean {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) {
    // Local development can run without the Meta app secret. Production must set it.
    return process.env.NODE_ENV !== "production" && !signature;
  }
  if (!rawBody || !signature?.startsWith("sha256=")) return false;
  const expected = Buffer.from(
    `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`,
  );
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

async function graphRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${GRAPH_BASE}${path}`, {
    ...init,
    signal: init.signal || withTimeout(Number(process.env.WHATSAPP_META_TIMEOUT_MS || 15000)),
    headers: {
      Authorization: `Bearer ${required("WHATSAPP_ACCESS_TOKEN")}`,
      ...(init.headers || {}),
    },
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    if (response.ok) {
      throw new WhatsappAmbiguousDeliveryError("Meta accepted the request but its confirmation body was unreadable");
    }
    payload = {};
  }
  if (!response.ok) {
    const message = (payload as any)?.error?.message || `WhatsApp respondió ${response.status}`;
    throw new WhatsappProviderError(message, response.status);
  }
  return payload as T;
}

export async function sendWhatsappText(to: string, text: string): Promise<string> {
  const phoneNumberId = required("WHATSAPP_PHONE_NUMBER_ID");
  const result = await graphRequest<{ messages?: Array<{ id?: string }> }>(`/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: false, body: text },
    }),
  });
  const providerId = result.messages?.[0]?.id;
  if (!providerId) {
    throw new WhatsappAmbiguousDeliveryError("Meta response did not include a confirmed message ID");
  }
  return providerId;
}

export type WhatsappReplyButton = { id: string; title: string };

function requireWhatsappMessageId(result: { messages?: Array<{ id?: string }> }): string {
  const providerId = result.messages?.[0]?.id;
  if (!providerId) throw new WhatsappAmbiguousDeliveryError("Meta response did not include a confirmed message ID");
  return providerId;
}

export async function sendWhatsappInteractiveButtons(
  to: string,
  body: string,
  buttons: WhatsappReplyButton[],
): Promise<string> {
  const phoneNumberId = required("WHATSAPP_PHONE_NUMBER_ID");
  const safeButtons = buttons.slice(0, 3).map((button) => ({
    type: "reply",
    reply: { id: button.id.slice(0, 256), title: button.title.slice(0, 20) },
  }));
  const result = await graphRequest<{ messages?: Array<{ id?: string }> }>(`/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "interactive",
      interactive: { type: "button", body: { text: body.slice(0, 1024) }, action: { buttons: safeButtons } },
    }),
  });
  return requireWhatsappMessageId(result);
}

export async function sendWhatsappAudioBuffer(to: string, audio: Buffer, mimeType = "audio/mpeg"): Promise<string> {
  const phoneNumberId = required("WHATSAPP_PHONE_NUMBER_ID");
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("file", new Blob([audio], { type: mimeType }), "respuesta.mp3");
  const uploaded = await graphRequest<{ id?: string }>(`/${phoneNumberId}/media`, { method: "POST", body: form });
  if (!uploaded.id) throw new WhatsappAmbiguousDeliveryError("Meta did not confirm the uploaded audio");
  const result = await graphRequest<{ messages?: Array<{ id?: string }> }>(`/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp", recipient_type: "individual", to,
      type: "audio", audio: { id: uploaded.id },
    }),
  });
  return requireWhatsappMessageId(result);
}

export async function sendWhatsappImageBuffer(to: string, image: Buffer, caption: string): Promise<string> {
  if (caption.length > 1024) throw new Error("El pie de imagen excede el límite de WhatsApp.");
  const phoneNumberId = required("WHATSAPP_PHONE_NUMBER_ID");
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("file", new Blob([image], { type: "image/png" }), "mapa-parcela.png");
  const uploaded = await graphRequest<{ id?: string }>(`/${phoneNumberId}/media`, { method: "POST", body: form });
  if (!uploaded.id) throw new WhatsappAmbiguousDeliveryError("Meta did not confirm the uploaded image");
  const result = await graphRequest<{ messages?: Array<{ id?: string }> }>(`/${phoneNumberId}/messages`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to,
      type: "image", image: { id: uploaded.id, caption } }),
  });
  return requireWhatsappMessageId(result);
}

export async function sendWhatsappFollowUp(to: string, parcelName: string, interactionId: string): Promise<string> {
  const template = process.env.WHATSAPP_FOLLOWUP_TEMPLATE_NAME;
  if (!template) {
    if (process.env.NODE_ENV === "production") throw new Error("WHATSAPP_FOLLOWUP_TEMPLATE_NAME is required in production");
    return sendWhatsappInteractiveButtons(to, `Seguimiento de ${parcelName}: ¿realizaste la recomendación?`, [
      { id: `followup_applied:${interactionId}`, title: "Aplicado" },
      { id: `followup_not_applied:${interactionId}`, title: "No aplicado" },
    ]);
  }
  const phoneNumberId = required("WHATSAPP_PHONE_NUMBER_ID");
  const result = await graphRequest<{ messages?: Array<{ id?: string }> }>(`/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp", to, type: "template",
      template: {
        name: template,
        language: { code: process.env.WHATSAPP_FOLLOWUP_TEMPLATE_LANGUAGE || "es_MX" },
        components: [
          { type: "body", parameters: [{ type: "text", text: parcelName.slice(0, 120) }] },
          { type: "button", sub_type: "quick_reply", index: "0", parameters: [{ type: "payload", payload: `followup_applied:${interactionId}` }] },
          { type: "button", sub_type: "quick_reply", index: "1", parameters: [{ type: "payload", payload: `followup_not_applied:${interactionId}` }] },
        ],
      },
    }),
  });
  return requireWhatsappMessageId(result);
}

export async function sendWhatsappEscalationResolution(to: string, note: string): Promise<string> {
  const template = process.env.WHATSAPP_ESCALATION_TEMPLATE_NAME;
  if (process.env.NODE_ENV !== "production") return sendWhatsappText(to, note);
  if (!template) throw new Error("WHATSAPP_ESCALATION_TEMPLATE_NAME is required in production");
  const phoneNumberId = required("WHATSAPP_PHONE_NUMBER_ID");
  const result = await graphRequest<{ messages?: Array<{ id?: string }> }>(`/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp", to, type: "template",
      template: {
        name: template,
        language: { code: process.env.WHATSAPP_ESCALATION_TEMPLATE_LANGUAGE || "es_MX" },
        components: [{ type: "body", parameters: [{ type: "text", text: note.slice(0, 1000) }] }],
      },
    }),
  });
  return requireWhatsappMessageId(result);
}

/** Business-initiated messages must use an approved Meta template in production. */
export async function sendWhatsappProactiveAlert(to: string, text: string): Promise<void> {
  const template = process.env.WHATSAPP_ALERT_TEMPLATE_NAME;
  const language = process.env.WHATSAPP_ALERT_TEMPLATE_LANGUAGE || "es_MX";
  if (!template) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("WHATSAPP_ALERT_TEMPLATE_NAME is required for proactive production alerts");
    }
    await sendWhatsappText(to, text);
    return;
  }
  const phoneNumberId = required("WHATSAPP_PHONE_NUMBER_ID");
  await graphRequest(`/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp", to, type: "template",
      template: { name: template, language: { code: language }, components: [{
        type: "body", parameters: [{ type: "text", text }],
      }] },
    }),
  });
}

export async function downloadWhatsappMedia(
  mediaId: string,
  kind: WhatsappMediaKind = "image",
): Promise<WhatsappMedia> {
  const media = await graphRequest<{ url?: string; mime_type?: string; file_size?: number }>(`/${mediaId}`);
  const rules = MEDIA_RULES[kind];
  if (!media.url) throw new Error(`Meta no devolvió una URL para el ${rules.label}`);
  const maxBytes = rules.maxBytes;
  if (typeof media.file_size === "number" && media.file_size > maxBytes) {
    throw new Error(`El ${rules.label} supera el límite de ${Math.floor(maxBytes / 1024 / 1024)} MB`);
  }
  const response = await fetch(media.url, {
    headers: { Authorization: `Bearer ${required("WHATSAPP_ACCESS_TOKEN")}` },
    signal: withTimeout(Number(process.env.WHATSAPP_MEDIA_TIMEOUT_MS || 30000)),
  });
  if (!response.ok) throw new WhatsappProviderError(`No se pudo descargar el ${rules.label} (${response.status})`, response.status);
  const mimeType = (media.mime_type || response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!rules.mimePattern.test(mimeType)) {
    throw new Error(kind === "image"
      ? "WhatsApp solo permite imágenes JPG, PNG o WebP para el diagnóstico"
      : "La nota de voz tiene un formato no compatible");
  }
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > maxBytes) throw new Error(`El ${rules.label} supera el límite permitido`);
  if (!response.body) throw new Error(`Meta devolvió un ${rules.label} vacío`);
  const chunks: Buffer[] = [];
  let size = 0;
  const reader = response.body.getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error("La imagen supera el límite de 10 MB");
    }
    chunks.push(Buffer.from(value));
  }
  const buffer = Buffer.concat(chunks, size);
  if (!buffer.length) throw new Error(`Meta devolvió un ${rules.label} vacío`);
  if (kind === "image") {
    const isJpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const isPng = buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const isWebp = buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
    if (!isJpeg && !isPng && !isWebp) throw new Error("El archivo recibido no contiene una imagen válida");
  } else if (!isValidWhatsappAudio(buffer, mimeType)) {
    throw new Error("El archivo recibido no contiene una nota de voz válida");
  }
  return {
    dataUrl: `data:${mimeType};base64,${buffer.toString("base64")}`,
    buffer,
    mimeType,
    size: buffer.length,
  };
}

export function splitWhatsappText(text: string, maxLength = 3500): string[] {
  const clean = text.trim();
  if (!clean) return ["No pude generar una respuesta. Intenta de nuevo en unos minutos."];
  if (clean.length <= maxLength) return [clean];
  const chunks: string[] = [];
  let remaining = clean;
  while (remaining.length > maxLength) {
    let cut = remaining.lastIndexOf("\n", maxLength);
    if (cut < Math.floor(maxLength * 0.6)) cut = remaining.lastIndexOf(" ", maxLength);
    if (cut < Math.floor(maxLength * 0.6)) cut = maxLength;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export function normalizeWhatsappPhone(phone: string): string {
  return phone.replace(/[^\d]/g, "");
}

export function extractWhatsappText(message: any): {
  text: string;
  mediaId?: string;
  mediaKind?: WhatsappMediaKind;
  interactiveId?: string;
  contextMessageId?: string;
} {
  const contextMessageId = typeof message?.context?.id === "string" ? message.context.id : undefined;
  if (message?.type === "text") return { text: String(message.text?.body || "").trim(), contextMessageId };
  if (message?.type === "image") {
    return {
      text: String(message.image?.caption || "").trim(),
      mediaId: typeof message.image?.id === "string" ? message.image.id : undefined,
      mediaKind: "image",
      contextMessageId,
    };
  }
  if (message?.type === "audio") {
    return {
      text: "",
      mediaId: typeof message.audio?.id === "string" ? message.audio.id : undefined,
      mediaKind: "audio",
      contextMessageId,
    };
  }
  if (message?.type === "interactive") {
    const reply = message.interactive?.button_reply || message.interactive?.list_reply;
    return {
      text: String(reply?.title || reply?.id || "").trim(),
      interactiveId: typeof reply?.id === "string" ? reply.id : undefined,
      contextMessageId,
    };
  }
  if (message?.type === "button") {
    return {
      text: String(message.button?.text || "").trim(),
      interactiveId: typeof message.button?.payload === "string" ? message.button.payload : undefined,
      contextMessageId,
    };
  }
  return { text: "" };
}
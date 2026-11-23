import { afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import {
  extractWhatsappText,
  isValidWhatsappAudio,
  normalizeWhatsappPhone,
  splitWhatsappText,
  sendWhatsappText,
  sendWhatsappInteractiveButtons,
  sendWhatsappImageBuffer,
  sendWhatsappProactiveAlert,
  verifyWhatsappSignature,
  WhatsappProviderError,
  WhatsappAmbiguousDeliveryError,
  isRetryableWhatsappError,
  whatsappRetryDelay,
  verifyWhatsappWebhook,
} from "../server/services/whatsapp-business";
import { formatWhatsappResponse } from "../server/services/whatsapp-agent";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

describe("WhatsApp Business helpers", () => {
  it("uploads the PNG privately to Meta and sends its analysis as a single image caption", async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = "unit-test-token";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "test-phone";
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ id: "media-map" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ messages: [{ id: "wamid.map" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    expect(await sendWhatsappImageBuffer("521234", Buffer.from("test-png"), "Análisis completo")).toBe("wamid.map");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][1].body).toBeInstanceOf(FormData);
    const message = JSON.parse(fetcher.mock.calls[1][1].body);
    expect(message).toMatchObject({ type: "image", image: { id: "media-map", caption: "Análisis completo" } });
    expect(message.image.link).toBeUndefined();
  });
  it("normalizes E.164-like phone values", () => {
    expect(normalizeWhatsappPhone("+52 33 1234-5678")).toBe("523312345678");
  });

  it("extracts text and image captions", () => {
    expect(extractWhatsappText({ type: "text", text: { body: "  ¿Cómo está mi maíz? " } }))
      .toEqual({ text: "¿Cómo está mi maíz?" });
    expect(extractWhatsappText({ type: "image", image: { id: "media-1", caption: "Manchas" } }))
      .toEqual({ text: "Manchas", mediaId: "media-1", mediaKind: "image" });
    expect(extractWhatsappText({ type: "audio", audio: { id: "voice-1", voice: true } }))
      .toEqual({ text: "", mediaId: "voice-1", mediaKind: "audio" });
    expect(extractWhatsappText({ type: "interactive", interactive: { button_reply: { id: "feedback_helpful", title: "Fue útil" } } }))
      .toEqual({ text: "Fue útil", interactiveId: "feedback_helpful" });
    expect(extractWhatsappText({
      type: "button",
      button: { payload: "followup_applied:state-1", text: "Aplicado" },
      context: { id: "wamid.template" },
    })).toEqual({
      text: "Aplicado",
      interactiveId: "followup_applied:state-1",
      contextMessageId: "wamid.template",
    });
  });

  it("verifies the Meta webhook challenge", () => {
    process.env.WHATSAPP_VERIFY_TOKEN = "verify-me";
    expect(verifyWhatsappWebhook("subscribe", "verify-me", "12345")).toBe("12345");
    expect(verifyWhatsappWebhook("subscribe", "wrong", "12345")).toBeNull();
  });

  it("verifies x-hub-signature-256 with timing-safe HMAC", () => {
    process.env.WHATSAPP_APP_SECRET = "app-secret";
    const body = Buffer.from(JSON.stringify({ entry: [] }));
    const signature = `sha256=${createHmac("sha256", "app-secret").update(body).digest("hex")}`;
    expect(verifyWhatsappSignature(body, signature)).toBe(true);
    expect(verifyWhatsappSignature(body, "sha256=bad")).toBe(false);
  });

  it("rejects a supplied signature when no app secret is configured", () => {
    delete process.env.WHATSAPP_APP_SECRET;
    process.env.NODE_ENV = "development";
    expect(verifyWhatsappSignature(Buffer.from("{}"), "sha256=bad")).toBe(false);
  });

  it("splits long replies without losing content order", () => {
    const text = `${"a ".repeat(80)}\n${"b ".repeat(80)}`.trim();
    const chunks = splitWhatsappText(text, 100);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 100)).toBe(true);
    expect(chunks.join(" ").replace(/\s+/g, " ")).toBe(text.replace(/\s+/g, " "));
  });

  it("keeps WhatsApp agronomic replies concise and removes code blocks", () => {
    const response = formatWhatsappResponse(`# Diagnóstico\n${"Acción prioritaria. ".repeat(60)}\n\`\`\`secret\`\`\``);
    expect(response.length).toBeLessThanOrEqual(3500);
    expect(response).not.toContain("# Diagnóstico");
    expect(response).not.toContain("secret");
    expect(response.trim().length).toBeGreaterThan(0);
  });

  it("retries only transient Meta failures with bounded exponential delay", () => {
    expect(isRetryableWhatsappError(new WhatsappProviderError("rate limit", 429))).toBe(true);
    expect(isRetryableWhatsappError(new WhatsappProviderError("bad request", 400))).toBe(false);
    expect(whatsappRetryDelay(1, 0.5)).toBe(5000);
    expect(whatsappRetryDelay(20, 0.5)).toBe(300000);
  });

  it("treats an unreadable or unconfirmed HTTP 200 response as ambiguous", async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = "token";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "phone-id";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => { throw new Error("body disconnected"); },
    }));
    await expect(sendWhatsappText("521234", "Hola")).rejects.toBeInstanceOf(WhatsappAmbiguousDeliveryError);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{}] }),
    }));
    await expect(sendWhatsappText("521234", "Hola")).rejects.toBeInstanceOf(WhatsappAmbiguousDeliveryError);
  });

  it("sends WhatsApp quick replies with Cloud API limits", async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = "token";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "phone-id";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: "wamid.buttons" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendWhatsappInteractiveButtons("521234", "Elige una opción", [
      { id: "one", title: "Primera opción demasiado larga" },
      { id: "two", title: "Segunda" },
      { id: "three", title: "Tercera" },
      { id: "four", title: "No se envía" },
    ])).resolves.toBe("wamid.buttons");
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.type).toBe("interactive");
    expect(payload.interactive.action.buttons).toHaveLength(3);
    expect(payload.interactive.action.buttons[0].reply.title.length).toBeLessThanOrEqual(20);
  });

  it("uses a safe fallback for an empty model response", () => {
    expect(formatWhatsappResponse("   ")).toContain("orientación segura");
  });

  it("validates audio container bytes instead of trusting the declared MIME", () => {
    const oggOpus = Buffer.alloc(47);
    oggOpus.write("OggS", 0, "ascii");
    oggOpus[26] = 1;
    oggOpus[27] = 19;
    oggOpus.write("OpusHead", 28, "ascii");
    expect(isValidWhatsappAudio(oggOpus, "audio/ogg")).toBe(true);
    expect(isValidWhatsappAudio(Buffer.from("not-really-audio"), "audio/ogg")).toBe(false);
    expect(isValidWhatsappAudio(Buffer.from("OggS"), "audio/ogg")).toBe(false);

    const wav = Buffer.alloc(48);
    wav.write("RIFF", 0, "ascii");
    wav.writeUInt32LE(40, 4);
    wav.write("WAVE", 8, "ascii");
    wav.write("fmt ", 12, "ascii");
    wav.write("data", 36, "ascii");
    expect(isValidWhatsappAudio(wav, "audio/wav")).toBe(true);
    expect(isValidWhatsappAudio(Buffer.from("#!AMR\n1234567890123"), "audio/amr")).toBe(true);
  });

  it("requires an approved template for proactive production alerts", async () => {
    process.env.NODE_ENV = "production";
    process.env.WHATSAPP_ACCESS_TOKEN = "token";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "phone-id";
    delete process.env.WHATSAPP_ALERT_TEMPLATE_NAME;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendWhatsappProactiveAlert("521234", "Pronóstico")).rejects.toThrow("WHATSAPP_ALERT_TEMPLATE_NAME");
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("sends configured proactive alerts as a Meta template payload", async () => {
    process.env.NODE_ENV = "production";
    process.env.WHATSAPP_ACCESS_TOKEN = "token";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "phone-id";
    process.env.WHATSAPP_ALERT_TEMPLATE_NAME = "weather_alert";
    process.env.WHATSAPP_ALERT_TEMPLATE_LANGUAGE = "es_MX";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: "wamid.1" }] }) });
    vi.stubGlobal("fetch", fetchMock);
    await sendWhatsappProactiveAlert("521234", "Helada prevista");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/phone-id/messages"),
      expect.objectContaining({ method: "POST", body: JSON.stringify({
        messaging_product: "whatsapp", to: "521234", type: "template",
        template: { name: "weather_alert", language: { code: "es_MX" }, components: [{ type: "body", parameters: [{ type: "text", text: "Helada prevista" }] }] },
      }) }),
    );
    vi.unstubAllGlobals();
  });
});
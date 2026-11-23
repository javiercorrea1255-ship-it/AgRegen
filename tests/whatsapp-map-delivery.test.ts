import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  download: vi.fn(), image: vi.fn(), text: vi.fn(), audio: vi.fn(), buttons: vi.fn(), voice: vi.fn(),
}));
vi.mock("../server/services/whatsapp-business", async original => ({
  ...await original<typeof import("../server/services/whatsapp-business")>(),
  sendWhatsappImageBuffer: mocks.image, sendWhatsappText: mocks.text,
  sendWhatsappAudioBuffer: mocks.audio, sendWhatsappInteractiveButtons: mocks.buttons,
}));
vi.mock("../server/services/ai-assistant", async original => ({
  ...await original<typeof import("../server/services/ai-assistant")>(),
  generateWhatsappVoice: mocks.voice,
}));
vi.mock("../server/services/whatsapp-satellite", async original => ({
  ...await original<typeof import("../server/services/whatsapp-satellite")>(),
  readSatellitePng: mocks.download,
}));
import { sendDurableWhatsappImage, normalizedCommand, deliverWhatsappAgentAnswer } from "../server/routes/whatsapp";
import { WhatsappProviderError } from "../server/services/whatsapp-business";

const artifact = { objectPath: "/objects/whatsapp-satellite/private.png", cacheKey: "key", name: "Lote",
  summary: { imageDate: "2026-11-14", index: "ndvi", mean: .5, level: "medio",
    percentages: { low: 20, medium: 50, high: 30, unseen: 0 }, lowHa: 1.8,
    weakLocations: ["esquina noreste"], change: null } } as any;
function storage() {
  const states = new Map<string, any>();
  return {
    claimWhatsappOutbound: vi.fn(async (data: any) => {
      let state = states.get(data.idempotencyKey);
      if (!state || state.status === "failed") {
        state = { ...data, status: "sending" }; states.set(data.idempotencyKey, state);
        return { claimed: true, message: state };
      }
      return { claimed: false, message: state };
    }),
    completeWhatsappOutbound: vi.fn(async (key: string, _provider: string, status: string) => {
      states.get(key).status = status;
    }),
    saveAutomaticFieldLog: vi.fn().mockResolvedValue({}),
  } as any;
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.download.mockResolvedValue(Buffer.from("test-png"));
  mocks.image.mockResolvedValue("wamid.image"); mocks.audio.mockResolvedValue("wamid.audio");
  mocks.text.mockResolvedValue("wamid.text"); mocks.voice.mockResolvedValue(Buffer.from("test-audio"));
});
describe("Durable private satellite-image delivery", () => {
  it("delivers a short map analysis in one caption, with no duplicate text or buttons", async () => {
    const s = storage();
    await deliverWhatsappAgentAnswer({ storage: s, providerMessageId: "in", from: "521234", response: "Análisis del mapa.",
      connection: { userId: "u", parcelId: "p", voicePreference: "text" },
      responseMessage: { id: "m", contextSnapshot: { satelliteArtifact: artifact, interactionButtons: "recommendation" } } });
    expect(mocks.image).toHaveBeenCalledWith("521234", expect.any(Buffer), "Análisis del mapa.");
    expect(mocks.image).toHaveBeenCalledTimes(1);
    expect(mocks.text).not.toHaveBeenCalled();
    expect(mocks.buttons).not.toHaveBeenCalled();
    expect(s.saveAutomaticFieldLog.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.image.mock.invocationCallOrder[0]);
  });
  it("keeps the complete detailed analysis after the image when it exceeds the caption limit", async () => {
    const response = "Detalles del mapa. ".repeat(80), s = storage();
    await deliverWhatsappAgentAnswer({ storage: s, providerMessageId: "in", from: "521234", response,
      connection: { userId: "u", parcelId: "p", voicePreference: "text" },
      responseMessage: { id: "m", contextSnapshot: { satelliteArtifact: artifact } } });
    expect(mocks.image.mock.calls[0][2]).toContain("2026-11-14");
    expect(mocks.image.mock.calls[0][2].length).toBeLessThan(1024);
    expect(mocks.text).toHaveBeenCalledWith("521234", response.trim());
    expect(mocks.text.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.image.mock.invocationCallOrder[0]);
  });
  it("sends the image plus analysis as audio and freezes the preference for durable retries", async () => {
    const s = storage();
    await deliverWhatsappAgentAnswer({ storage: s, providerMessageId: "in", from: "521234", response: "Análisis hablado",
      connection: { userId: "u", parcelId: "p", voicePreference: "text" },
      responseMessage: { id: "m", contextSnapshot: { satelliteArtifact: artifact, deliveryVoicePreference: "voice" } } });
    expect(mocks.image).toHaveBeenCalledTimes(1);
    expect(mocks.voice).toHaveBeenCalledWith("Análisis hablado");
    expect(mocks.audio).toHaveBeenCalledWith("521234", expect.any(Buffer));
    expect(mocks.text).not.toHaveBeenCalled();
  });
  it("does not record a sent satellite observation when the image delivery is uncertain", async () => {
    const s = storage();
    mocks.image.mockRejectedValueOnce(new Error("network timeout"));
    await expect(deliverWhatsappAgentAnswer({ storage: s, providerMessageId: "in", from: "521234", response: "Análisis",
      connection: { userId: "u", parcelId: "p", voicePreference: "text" },
      responseMessage: { id: "m", contextSnapshot: { satelliteArtifact: artifact } } })).rejects.toThrow();
    expect(s.saveAutomaticFieldLog).not.toHaveBeenCalled();
  });
  it("maps the menu button to MAPA without adding a natural-language keyword classifier", () => {
    expect(normalizedCommand("", "menu_map")).toBe("MAPA");
  });
  it("sends exactly one image with its complete analysis and suppresses a confirmed replay", async () => {
    const s = storage(), sender = vi.fn().mockResolvedValue("wamid.map");
    await sendDurableWhatsappImage(s, "in", "521234", artifact, "Análisis de la parcela", sender);
    await sendDurableWhatsappImage(s, "in", "521234", artifact, "Análisis de la parcela", sender);
    expect(sender).toHaveBeenCalledTimes(1);
    expect(sender).toHaveBeenCalledWith("521234", expect.any(Buffer), "Análisis de la parcela");
    expect(s.completeWhatsappOutbound).toHaveBeenCalledWith("in:answer-map:0", "wamid.map", "sent");
  });
  it("quarantines network uncertainty and never blindly resends the image", async () => {
    const s = storage(), sender = vi.fn().mockRejectedValue(new Error("network timeout"));
    await expect(sendDurableWhatsappImage(s, "in", "521234", artifact, "Análisis", sender)).rejects.toThrow("timeout");
    expect(s.completeWhatsappOutbound).toHaveBeenCalledWith("in:answer-map:0", "unknown", "ambiguous", "network timeout");
    await expect(sendDurableWhatsappImage(s, "in", "521234", artifact, "Análisis", sender)).rejects.toThrow("unresolved");
    expect(sender).toHaveBeenCalledTimes(1);
  });
  it("allows a definite provider rejection to use the existing retry policy", async () => {
    const s = storage(), sender = vi.fn().mockRejectedValueOnce(new WhatsappProviderError("Rejected", 429))
      .mockResolvedValueOnce("wamid.recovered");
    await expect(sendDurableWhatsappImage(s, "in", "521234", artifact, "Análisis", sender)).rejects.toThrow();
    await sendDurableWhatsappImage(s, "in", "521234", artifact, "Análisis", sender);
    expect(sender).toHaveBeenCalledTimes(2);
  });
  it("rejects a changed caption on a reused inbound key instead of creating a different delivery", async () => {
    const s = storage(), sender = vi.fn().mockResolvedValue("wamid.map");
    await sendDurableWhatsappImage(s, "in", "521234", artifact, "Original", sender);
    await expect(sendDurableWhatsappImage(s, "in", "521234", artifact, "Changed", sender)).rejects.toThrow("cambió");
    expect(sender).toHaveBeenCalledTimes(1);
  });
  it("never calls Meta if the private PNG cannot be loaded", async () => {
    const s = storage(), sender = vi.fn();
    mocks.download.mockRejectedValue(new Error("missing object"));
    await expect(sendDurableWhatsappImage(s, "in", "521234", artifact, "Análisis", sender)).rejects.toThrow("missing");
    expect(sender).not.toHaveBeenCalled();
    expect(s.completeWhatsappOutbound).toHaveBeenCalledWith("in:answer-map:0", "unknown", "failed", expect.any(String));
  });
});

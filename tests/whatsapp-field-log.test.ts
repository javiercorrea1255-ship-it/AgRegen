import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ create: vi.fn(), save: vi.fn() }));
vi.mock("openai", () => ({ default: class {
  chat = { completions: { create: mocks.create } };
} }));
vi.mock("../server/replit_integrations/object_storage/objectStorage", () => ({
  ObjectStorageService: class { savePrivateBuffer = mocks.save; },
}));
import { generateWhatsappTurn, normalizeWhatsappTurn } from "../server/services/whatsapp-turn";
import { saveFieldLogEvidence } from "../server/services/whatsapp-field-log";

const date = new Date("2026-11-17T12:00:00Z");
const report = () => ({
  kind: "report", record: { activityType: "aplicación", occurredAt: null, confidence: 0.9,
    items: [{ category: "input", name: "Urea", quantity: 50, unit: null, cost: 500 }] },
  response: "Anoté: 50 de urea, hoy.", recommendedFieldAction: false,
});
const options = () => ({
  text: "Apliqué 50 de urea", card: "(a) parcela\n(b) clima\n(e) bitácora",
  parcelContext: { parcel: { crop: "maíz", phenologicalStage: "V6" } } as any,
  messageAt: date, mode: "brief" as const,
});
beforeEach(() => {
  vi.clearAllMocks();
  // The entire OpenAI client is mocked above; no provider credentials are needed.
  vi.stubEnv("AI_INTEGRATIONS_OPENAI_API_KEY", "mock-only");
});
afterEach(() => vi.unstubAllEnvs());

describe("Automatic field-log interpretation and private evidence", () => {
  it("defaults date and currency but never invents an absent quantity unit", () => {
    const result = normalizeWhatsappTurn(report(), date);
    expect(result.record?.occurredAt).toBe(date.toISOString());
    expect(result.record?.items[0]).toMatchObject({ quantity: 50, unit: null, currency: "MXN", cost: 500 });
  });
  it("retains an explicitly supplied date, unit and foreign currency", () => {
    const raw = report();
    raw.record.occurredAt = "2026-11-16T12:00:00Z" as any;
    Object.assign(raw.record.items[0], { unit: "kg", currency: "USD" });
    const result = normalizeWhatsappTurn(raw, date);
    expect(result.record?.occurredAt).toBe("2026-11-16T12:00:00.000Z");
    expect(result.record?.items[0].currency).toBe("USD");
  });
  it("prevents a query from creating a field fact even if the output contains an extraneous record", () => {
    expect(normalizeWhatsappTurn({ ...report(), kind: "query" }, date).record).toBeNull();
  });
  it("accepts observations without input quantities or costs", () => {
    const raw = report();
    Object.assign(raw.record, { activityType: "observación", items: [{
      category: "observation", name: "Gusano cogollero observado",
    }] });
    const result = normalizeWhatsappTurn(raw, date);
    expect(result.record?.items[0]).toMatchObject({ quantity: null, unit: null, cost: null });
  });
  it("rejects malformed JSON structures rather than silently recording invented facts", () => {
    expect(() => normalizeWhatsappTurn({ record: "urea" }, date)).toThrow();
  });
  it("saves media privately under a deterministic provider-message key", async () => {
    mocks.save.mockResolvedValue("/objects/private/audio");
    const evidence = await saveFieldLogEvidence("owner", "wamid.1", {
      buffer: Buffer.from("audio"), mimeType: "audio/ogg", size: 5, kind: "audio",
    });
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: "owner", namespace: "whatsapp-evidence", objectId: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
    expect(evidence[0]).toMatchObject({ path: "/objects/private/audio", providerMessageId: "wamid.1" });
  });
  it("does not create evidence objects for messages without attachments", async () => {
    expect(await saveFieldLogEvidence("owner", "wamid.1")).toEqual([]);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("uses exactly one generation request for reply plus structured record", async () => {
    mocks.create.mockResolvedValue({ choices: [{ message: { content: JSON.stringify(report()) } }] });
    const result = await generateWhatsappTurn(options());
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0][0].response_format).toEqual({ type: "json_object" });
    expect(result.record?.items[0].name).toBe("Urea");
    expect(result.response).toBe("Anoté: 50 de urea, hoy.");
  });
  it("requests the selected length at generation, not a longer answer to truncate", async () => {
    mocks.create.mockResolvedValue({ choices: [{ message: { content: JSON.stringify(report()) } }] });
    await generateWhatsappTurn(options());
    expect(mocks.create.mock.calls[0][0].messages[0].content).toContain("máximo 600 caracteres");
  });
  it("leaves factual receipts to the server, without a false pesticide warning", async () => {
    const raw = report();
    raw.response = "";
    raw.record.items[0].cost = null as any;
    mocks.create.mockResolvedValue({ choices: [{ message: { content: JSON.stringify(raw) } }] });
    const result = await generateWhatsappTurn(options());
    expect(result.response).toBe("");
    expect(result.record?.items[0].cost).toBeNull();
  });
  it("does not weaken the existing pesticide safety validator", async () => {
    mocks.create.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({
      kind: "query", record: null, response: "Aplica insecticida a 2 L/ha.",
      recommendedFieldAction: true,
    }) } }] });
    const result = await generateWhatsappTurn({ ...options(), text: "¿Aplico algo?" });
    expect(result.response).not.toContain("Aplica insecticida");
    expect(result.response.toLowerCase()).toContain("no aplicar plaguicidas");
  });
});

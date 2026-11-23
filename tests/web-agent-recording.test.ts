import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocked = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("openai", () => ({ default: class { chat = { completions: { create: mocked.create } }; } }));
import { generateAIResponse } from "../server/services/ai-assistant";
const messageAt = new Date("2026-11-17T22:15:00Z");
const context = {
  parcel: { id: "p", name: "Ensayo", crop: "Maíz", area: "4", location: "Puebla", soilType: "arenoso" },
  soilAnalysis: { analysisDate: new Date("2026-02-13"), nitrogenTotal: "0.000", nitrogenInorganic: "20.08",
    boron: "5.73", ph: "7.18", sand: "78.36", notes: "Boro muy alto" },
  parcelData: [], tillagePractices: [], cropRotation: [], animalIntegration: null, livelihood: null, cycleDetail: null,
} as any;
function complete(turn: any) { mocked.create.mockResolvedValue({ choices: [{ message: { content: JSON.stringify(turn) } }] }); }
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("AI_INTEGRATIONS_OPENAI_API_KEY", "unit-test-placeholder"); });
afterEach(() => vi.unstubAllEnvs());
describe("web model uses one structured decision with full soil evidence", () => {
  it("extracts the same Spanish ledger record in the call that answers the producer", async () => {
    complete({ kind: "report", response: "Reporte recibido.", recommendedFieldAction: false,
      record: { activityType: "fertilization", occurredAt: null, items: [
        { category: "input", name: "urea", quantity: 50, unit: "kg", cost: 900 }], confidence: .95 } });
    const result = await generateAIResponse("Registra: apliqué 50 kg de urea, me costó 900 pesos",
      context, [], [], "openai", undefined, undefined, messageAt);
    expect(mocked.create).toHaveBeenCalledOnce();
    expect(mocked.create.mock.calls[0][0].response_format).toEqual({ type: "json_object" });
    expect(result.fieldLogRecord).toMatchObject({ activityType: "fertilización", occurredAt: messageAt.toISOString(),
      items: [{ quantity: 50, unit: "kg", cost: 900, currency: "MXN" }] });
  });
  it("does not let a historical question create a new operation", async () => {
    complete({ kind: "query", response: "Ayer registraste urea.", recommendedFieldAction: false,
      record: { activityType: "fertilización", items: [{ category: "input", name: "urea" }] } });
    const result = await generateAIResponse("¿Cuándo aplicamos el fertilizante?", context, [], []);
    expect(result.fieldLogRecord).toBeNull(); expect(mocked.create).toHaveBeenCalledOnce();
  });
  it("passes inorganic nitrogen, boron limits and the nutrition policy to the model and guards its response", async () => {
    complete({ kind: "query", record: null, recommendedFieldAction: true,
      response: "Aplica 2 kg de ácido bórico por ha. Aplica 150 kg de urea por ha." });
    const result = await generateAIResponse("Dame un plan de fertilización", context, [], []);
    const messages = JSON.stringify(mocked.create.mock.calls[0][0].messages);
    for (const word of ["20.08", "7.18", "5.73", "fraccion", "testigo", "sin superficie y meta"]) expect(messages).toContain(word);
    expect(result.response).toContain("No añadas boro"); expect(result.response).toContain("confirma la superficie");
    expect(result.response).not.toContain("150 kg"); expect(mocked.create).toHaveBeenCalledOnce();
  });
});

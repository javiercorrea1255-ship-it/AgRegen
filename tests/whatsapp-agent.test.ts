import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  turn: vi.fn(), transcribe: vi.fn(), saveBuffer: vi.fn(), map: vi.fn(),
}));
vi.mock("../server/services/whatsapp-turn", () => ({ generateWhatsappTurn: mocks.turn }));
vi.mock("../server/services/whatsapp-satellite", async original => ({
  ...await original<typeof import("../server/services/whatsapp-satellite")>(),
  prepareWhatsappSatelliteMap: mocks.map,
}));
vi.mock("../server/services/ai-assistant", () => ({ transcribeWhatsappAudio: mocks.transcribe }));
vi.mock("../server/services/weather", () => ({ getRecentObservedWeather: vi.fn().mockResolvedValue(null),
  getFullWeatherData: vi.fn().mockResolvedValue({
  current: { temperature: 28, humidity: 45, precipitation: 0 },
  forecast: [{ date: "2026-06-02", precipitation: 20, tempMin: 18, tempMax: 28, windSpeed: 10 }],
}) }));
vi.mock("../server/services/market-prices", () => ({ getSniimPrice: vi.fn().mockResolvedValue(null) }));
vi.mock("../server/services/parcel-climatology", () => ({ getParcelClimatology: vi.fn().mockResolvedValue(null) }));
vi.mock("../server/replit_integrations/object_storage/objectStorage", () => ({
  ObjectStorageService: class { savePrivateBuffer = mocks.saveBuffer; },
}));
import { processWhatsappAgentMessage } from "../server/services/whatsapp-agent";
import { clearWhatsappWeatherCache } from "../server/services/whatsapp-context";

const now = new Date("2026-06-01T12:00:00Z");
function record(activityType = "aplicación de urea") {
  return { activityType, occurredAt: now.toISOString(), confidence: 0.9,
    items: [{ category: "input", name: "Urea", quantity: 50, unit: "kg", cost: 250, currency: "MXN" }],
    observations: null };
}
function fixture(owner = "u") {
  const messages: any[] = [], entries: any[] = [], interactions: any[] = [];
  const plans: Record<string, any> = {};
  const storage = {
    getParcel: vi.fn().mockResolvedValue({ id: "p", userId: owner, name: "Lote", crop: "maíz",
      location: "Jalisco", latitude: "20", longitude: "-103", area: "9" }),
    getMessagesByProviderMessage: vi.fn(async (_: string, id: string) =>
      messages.filter(m => m.contextSnapshot?.providerMessageId === id)),
    getRecentMessagesByConversation: vi.fn(async () => messages.slice(-6)),
    createMessage: vi.fn(async (data: any) => {
      const message = { id: `m${messages.length}`, createdAt: now, ...data };
      messages.push(message); return message;
    }),
    updateWhatsappMapMessage: vi.fn(async (id: string, _: string, content: string, contextSnapshot: any) => {
      Object.assign(messages.find(m => m.id === id), { content, contextSnapshot });
    }),
    promoteLegacyFieldLogs: vi.fn().mockResolvedValue(undefined),
    getActiveFieldLogs: vi.fn(async () => entries.filter(e => e.status !== "rejected")),
    getLatestCropCycleDetail: vi.fn().mockResolvedValue({
      id: "cycle", cycleYear: 2026, cycleSeason: "primavera-verano", totalPlannedCost: "1000",
    }),
    getAlertsByParcel: vi.fn().mockResolvedValue([{ title: "Lluvia fuerte", severity: "high", description: "20 mm previstos" }]),
    getLatestSoilAnalysis: vi.fn().mockResolvedValue({ ph: "6.5", organicMatter: "2" }),
    getWaterAnalysisByParcel: vi.fn().mockResolvedValue([]),
    getPlantTissueAnalysisByParcel: vi.fn().mockResolvedValue([]),
    getParcelData: vi.fn().mockResolvedValue([]),
    getProductionCostsByParcel: vi.fn().mockResolvedValue([{
      id: "cost", cycleYear: 2026, cycleSeason: "primavera-verano", totalCost: "800", category: "semillas",
    }]),
    getParcelMemory: vi.fn(async () => ({ fertilizationPlans: plans })),
    saveParcelFertilizationPlan: vi.fn(async (_parcel: string, _user: string, key: string, plan: any) => { plans[key] = plan; }),
    getOpenInteractionState: vi.fn().mockResolvedValue(undefined),
    getFieldLogBySourceMessage: vi.fn(async (id: string) => entries.find(e => e.sourceProviderMessageId === id)),
    saveAutomaticFieldLog: vi.fn(async (data: any) => {
      const prior = entries.find(e => e.sourceProviderMessageId === data.sourceProviderMessageId);
      if (prior) return prior;
      const entry = { id: `e${entries.length}`, status: "confirmed", currentRevision: 1, createdAt: now, ...data };
      entries.push(entry); return entry;
    }),
    reviseFieldLog: vi.fn().mockResolvedValue({ status: "confirmed" }),
    rejectFieldLog: vi.fn().mockResolvedValue({ status: "rejected" }),
    createInteractionState: vi.fn(async (data: any) => { interactions.push(data); return data; }),
    resolveInteractionState: vi.fn().mockResolvedValue({}),
    updateConversationTitle: vi.fn().mockResolvedValue(undefined),
  };
  const send = (text: string, extras: any = {}) => processWhatsappAgentMessage({
    storage: storage as any, userId: "u", parcelId: "p", conversationId: "c",
    providerMessageId: `wa${messages.length}`, text, connectionId: "connection", ...extras,
  });
  return { storage, send, entries, messages, interactions };
}
beforeEach(() => {
  vi.clearAllMocks(); clearWhatsappWeatherCache();
  mocks.turn.mockResolvedValue({ kind: "query", record: null,
    response: "El pronóstico indica 20 mm de lluvia.", recommendedFieldAction: false, modelUsed: "gpt-4o-mini" });
  mocks.transcribe.mockResolvedValue("Regué ayer dos horas.");
  mocks.saveBuffer.mockResolvedValue("/objects/private/evidence");
});

describe("Single-call WhatsApp ledger", () => {
  it("keeps the saved bean base dose on equivalent questions and replaces it only when evidence changes", async () => {
    const f = fixture();
    const plan = { crop: "Frijol", nutrientsKgHa: { n: null, p2o5: [50, 60], k2o: null }, provisional: true };
    mocks.turn.mockResolvedValue({ kind: "query", record: null, response: "Para frijol P2O5 50–60 kg/ha.",
      recommendedFieldAction: true, fertilizationPlan: plan });
    expect(await f.send("¿Qué fertilización lleva frijol?")).toContain("50–60");
    mocks.turn.mockResolvedValue({ kind: "query", record: null, response: "Aplica P2O5 31 kg/ha.",
      recommendedFieldAction: true, fertilizationPlan: { ...plan, nutrientsKgHa: { ...plan.nutrientsKgHa, p2o5: [31, 31] } } });
    const second = await f.send("¿Qué dosis de fósforo para el frijol?");
    expect(second).toContain("50–60");
    expect(second).not.toContain("31");
    expect(mocks.turn.mock.calls[1][0].card).toContain("baseFertilizationPlans");
    expect(f.storage.saveParcelFertilizationPlan).toHaveBeenCalledTimes(2);
    f.storage.getLatestSoilAnalysis.mockResolvedValue({ ph: "7.15", organicMatter: ".87" });
    mocks.turn.mockResolvedValue({ kind: "query", record: null, response: "P2O5 31 kg/ha con datos nuevos.",
      recommendedFieldAction: true, fertilizationPlan: { ...plan, nutrientsKgHa: { ...plan.nutrientsKgHa, p2o5: [31, 31] } } });
    expect(await f.send("Con el análisis actualizado, ¿qué dosis?")).toContain("31");
    expect(f.entries).toHaveLength(0);
  });
  it("does not attribute four-hectare costs to the .93 ha parcel", async () => {
    const f = fixture();
    f.storage.getParcel.mockResolvedValue({ ...(await f.storage.getParcel()), area: ".93" });
    f.storage.getProductionCostsByParcel.mockResolvedValue([{
      id: "notebook", notes: "Cuaderno con superficie 4 ha", totalCost: "6830",
      cycleYear: 2026, cycleSeason: "primavera-verano", category: "semillas",
    }] as any);
    mocks.turn.mockResolvedValue({ kind: "query", record: null, economicComparison: true,
      response: "Llevas $6830 en las .93 ha", recommendedFieldAction: false });
    const answer = await f.send("¿Cuánto llevo gastado por hectárea?");
    expect(answer).toContain("No puedo atribuir");
    expect(answer).toContain("4 ha");
    expect(answer).not.toContain("$6830");
  });
  it("asks Yes/No before saving an ambiguous fact, binds approval and never reinterprets it", async () => {
    const f = fixture();
    mocks.turn.mockResolvedValue({ kind: "report", recordingDecision: "ambiguous", record: record(),
      response: "", recommendedFieldAction: false });
    expect(await f.send("Se aplicaría urea")).toBe("¿Lo anoto en tu bitácora?");
    expect(f.entries).toHaveLength(0);
    const state = { ...f.interactions[0], id: "consent" };
    f.storage.getOpenInteractionState.mockResolvedValue(state);
    expect(await f.send("SÍ", { interactionTargetId: state.sourceMessageId })).toContain("Anoté:");
    expect(f.entries).toHaveLength(1);
    expect(mocks.turn).toHaveBeenCalledTimes(1);
    expect(f.storage.resolveInteractionState).toHaveBeenCalledWith("consent", "u", "resolved");
  });
  it("declines an ambiguous fact without creating an expense", async () => {
    const f = fixture();
    f.storage.getOpenInteractionState.mockResolvedValue({ id: "consent", sourceMessageId: "prior",
      payload: { purpose: "field_log_consent", record: record() } });
    expect(await f.send("NO", { interactionTargetId: "prior" })).toContain("No lo guardé");
    expect(f.entries).toHaveLength(0);
    expect(mocks.turn).not.toHaveBeenCalled();
  });
  it("keeps an imprecise historical report without inventing today's date", async () => {
    const f = fixture();
    mocks.turn.mockResolvedValue({ kind: "report", record: { ...record(), occurredAt: null, datePrecision: "unknown" },
      response: "", recommendedFieldAction: false });
    const response = await f.send("Este año apliqué urea");
    expect(response).toContain("sin fecha exacta");
    expect(f.entries[0].occurredAt).toBeNull();
    expect(f.entries[0].missingFields).toEqual(["fecha exacta"]);
  });
  it("retains the substance and safety conditions of a long answer", async () => {
    const f = fixture();
    const technical = "Revisa humedad antes de incorporar urea. ".repeat(30) + "No apliques con el suelo saturado.";
    mocks.turn.mockResolvedValue({ kind: "query", record: null, response: technical, recommendedFieldAction: true });
    const response = await f.send("¿Cómo fertilizo?");
    expect(response).toBe(technical);
    expect(response).not.toContain("excedió el formato");
    expect(response).toContain("No apliques con el suelo saturado.");
  });
  it("persists Spanish labor and acknowledges the reported urea cost even if the model writes an English receipt", async () => {
    const f = fixture();
    const messageAt = new Date("2026-11-17T22:15:00Z");
    const createMessage = f.storage.createMessage.getMockImplementation()!;
    f.storage.createMessage.mockImplementation((data: any) => createMessage({ ...data, createdAt: messageAt }));
    mocks.turn.mockResolvedValue({
      kind: "report", record: { ...record("fertilization"), occurredAt: messageAt.toISOString(),
        items: [{ category: "input", name: "urea", quantity: 50, unit: "kg", cost: 900, currency: "MXN" }] },
      response: "Anoté: fertilization; 50 kg urea, 17/11/2026.",
      recommendedFieldAction: false, modelUsed: "test-model",
    });
    const result = await f.send("Hoy aplique 50 kg de urea, me costo 900 pesos");
    expect(result).toBe("Anoté: fertilización con urea, 50 kg, $900, hoy 17/11/2026.");
    expect(f.entries[0]).toMatchObject({
      activityType: "fertilización",
      structuredData: { activityType: "fertilización", items: [{ cost: 900 }], totalsByCurrency: { MXN: 900 } },
    });
    expect(mocks.turn).toHaveBeenCalledTimes(1);
  });
  it.each(["mándame el mapa de mi parcela", "MAPA", "cómo se ve mi cultivo desde el satélite", "dónde está más débil la milpa"])(
    "uses the same model turn and durable decision for %s", async text => {
      const f = fixture();
      const logs = vi.spyOn(console, "info");
      mocks.turn.mockResolvedValue({ kind: "query", record: null,
        response: text === "MAPA" ? "Una explicación que incumple el presupuesto. ".repeat(20)
          : "Con el riego reciente, revisa las zonas que sigan secas.",
        recommendedFieldAction: true, satelliteRequest: { index: "ndvi", date: null, compare: false } });
      mocks.map.mockResolvedValue({
        objectPath: "/objects/whatsapp-satellite/map.png", cacheKey: "cache", summary: {
          imageDate: "2026-05-31", index: "ndvi", mean: .5, level: "medio",
          percentages: { low: 20, medium: 50, high: 30, unseen: 0 }, lowHa: 1.8,
          weakLocations: ["esquina noreste"], unseenLocations: [], change: null,
        },
      });
      const reply = await f.send(text, { providerMessageId: "map-request" });
      expect(reply).toContain("2026-05-31");
      expect(reply).toContain("1.8 ha");
      if (text === "MAPA") {
        expect(reply).toContain("incumple el presupuesto");
        expect(reply).not.toContain("excedió el formato");
      }
      const calls = text === "MAPA" ? 1 : 2;
      expect(mocks.turn).toHaveBeenCalledTimes(calls);
      const analysis = mocks.turn.mock.calls[calls - 1][0];
      expect(analysis.mapSummary.mean).toBe(.5);
      expect(analysis.mapSummary.weakLocations).toEqual(["esquina noreste"]);
      if (text === "MAPA") {
        expect(mocks.map.mock.invocationCallOrder[0]).toBeLessThan(mocks.turn.mock.invocationCallOrder[0]);
      } else {
        expect(mocks.map.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.turn.mock.invocationCallOrder[0]);
        expect(analysis.analysisOnly).toBe(true);
      }
      expect(mocks.map).toHaveBeenCalledTimes(1);
      expect(f.entries).toHaveLength(0); // satellite observations are saved only after confirmed delivery
      const modelStages = logs.mock.calls.filter(call => call[0] === "[whatsapp] map stage" && call[1]?.stage === "model");
      expect(modelStages).toHaveLength(calls);
      expect(modelStages.every(call => call[1].requestId === mocks.map.mock.calls[0][0].requestId)).toBe(true);
      expect(f.messages[1].contextSnapshot.satelliteCompleted).toBe(true);
      expect(await f.send(text, { providerMessageId: "map-request" })).toBe(reply);
      expect(mocks.turn).toHaveBeenCalledTimes(calls);
      expect(mocks.map).toHaveBeenCalledTimes(1);
      logs.mockRestore();
    });
  it("lets the same interpreter request NDMI from a transcribed voice note", async () => {
    const f = fixture();
    mocks.transcribe.mockResolvedValue("Mándame el mapa de humedad de hace un mes");
    mocks.turn.mockResolvedValue({ kind: "query", record: null, response: "",
      recommendedFieldAction: false, satelliteRequest: { index: "ndmi", date: "2026-05-01", compare: false } });
    const { SatelliteUnavailable } = await import("../server/services/whatsapp-satellite");
    mocks.map.mockRejectedValue(new SatelliteUnavailable("No hay imagen disponible cerca de esa fecha."));
    const reply = await f.send("", { audio: { buffer: Buffer.from("audio"), mimeType: "audio/ogg", size: 5 } });
    expect(mocks.turn).toHaveBeenCalledTimes(1);
    expect(mocks.turn.mock.calls[0][0].text).toContain("hace un mes");
    expect(mocks.map.mock.calls[0][0].request).toMatchObject({ index: "ndmi", date: "2026-05-01" });
    expect(reply).toContain("No hay imagen");
    expect(f.messages[1].contextSnapshot.satelliteArtifact).toBeUndefined();
    expect(f.interactions).toHaveLength(0);
  });
  it("saves a first-person report immediately without confirmation or memory summary", async () => {
    const f = fixture();
    mocks.turn.mockResolvedValue({ kind: "report", record: record(), response: "Anoté: 50 kg de urea, hoy.", recommendedFieldAction: false });
    expect(await f.send("Apliqué 50 kg de urea")).toContain("Anoté:");
    expect(mocks.turn).toHaveBeenCalledTimes(1);
    expect(f.entries).toHaveLength(1);
    expect(f.entries[0].structuredData.registration).toBe("automatic");
    expect(f.interactions).toHaveLength(0);
    expect(f.messages[1].contextSnapshot.interactionButtons).toBe("field-log");
  });
  it("saves an observation without a field labor", async () => {
    const f = fixture();
    mocks.turn.mockResolvedValue({ kind: "report", record: {
      ...record("observación"), items: [{ category: "observation", name: "Granizo", quantity: null, unit: null, cost: null }],
      observations: "El productor reportó granizo.",
    }, response: "Anoté: cayó granizo.", recommendedFieldAction: false });
    await f.send("Cayó granizo");
    expect(f.entries[0].structuredData.items[0].category).toBe("observation");
  });
  it("builds a factual receipt without treating a past application as pesticide advice", async () => {
    const f = fixture();
    mocks.turn.mockResolvedValue({ kind: "report", record: record(),
      response: "", recommendedFieldAction: false });
    const response = await f.send("Apliqué 50 kg de urea");
    expect(response).toContain("Anoté:");
    expect(response).toContain("aplicación de urea");
    expect(response).toContain("50 kg");
    expect(response).toContain("$250");
    expect(response).not.toContain("No aplicar plaguicidas");
    expect(response.length).toBeLessThanOrEqual(600);
  });
  it("preserves an oversized explanation for chunked delivery without losing the record", async () => {
    const f = fixture();
    mocks.turn.mockResolvedValue({ kind: "report", record: record(),
      response: "x".repeat(1200), recommendedFieldAction: true });
    const response = await f.send("Apliqué urea");
    expect(response).toContain("Anoté:");
    expect(response).not.toContain("excedió");
    expect(response).toContain("x".repeat(1200));
    expect(f.entries).toHaveLength(1);
    expect(f.interactions).toHaveLength(1);
  });
  it("stores a captionless field photo as a private observation from the same turn", async () => {
    const f = fixture();
    mocks.turn.mockResolvedValue({ kind: "report", record: {
      ...record("observación"), items: [{ category: "observation", name: "Daño visible" }],
      observations: "Hipótesis visual, no diagnóstico confirmado.",
    }, response: "", recommendedFieldAction: false });
    await f.send("", { imageDataUrl: "data:image/jpeg;base64,AA==",
      media: { kind: "image", mimeType: "image/jpeg", buffer: Buffer.from("photo"), size: 5 } });
    expect(f.entries[0].structuredData.observations).toContain("Hipótesis");
    expect(f.entries[0].evidence[0].kind).toBe("image");
    expect(mocks.turn).toHaveBeenCalledTimes(1);
  });
  it("does not create a field event for a question mentioning a labor", async () => {
    const f = fixture();
    await f.send("¿Cuándo aplicamos el fertilizante?");
    expect(f.storage.saveAutomaticFieldLog).not.toHaveBeenCalled();
    expect(f.messages[0].role).toBe("user");
  });
  it("handles mixed report and question with one generation", async () => {
    const f = fixture();
    mocks.turn.mockResolvedValue({ kind: "mixed", record: record(),
      response: "Anoté la urea. Hay 20 mm de lluvia previstos.", recommendedFieldAction: false });
    await f.send("Apliqué 50 kg de urea, ¿lloverá?");
    expect(mocks.turn).toHaveBeenCalledTimes(1);
    expect(f.entries).toHaveLength(1);
    expect(mocks.turn.mock.calls[0][0].card).toContain("precipitation");
  });
  it("answers an irrigation question with weather and the last irrigation together", async () => {
    const f = fixture();
    f.entries.push({ id: "r", userId: "u", parcelId: "p", status: "confirmed",
      createdAt: now, occurredAt: now, activityType: "Riego de 2 horas", structuredData: { items: [] } });
    await f.send("¿Debo regar otra vez?");
    const card = mocks.turn.mock.calls[0][0].card;
    expect(card).toContain("Riego de 2 horas");
    expect(card).toContain("Lluvia fuerte");
    expect(card).toContain('"precipitation":20');
    expect(f.storage.saveAutomaticFieldLog).not.toHaveBeenCalled();
  });
  it("uses the same costs-module-plus-ledger sum in the card", async () => {
    const f = fixture();
    f.entries.push({ id: "expense", userId: "u", parcelId: "p", status: "confirmed", cycleDetailId: "cycle",
      createdAt: now, occurredAt: now, structuredData: record() });
    await f.send("¿Cuánto llevo gastado?");
    expect(mocks.turn.mock.calls[0][0].card).toContain('"total":1050');
    expect(mocks.turn.mock.calls[0][0].card).toContain('"differenceMXN":50');
  });
  it("authorizes before persistence, transcription or model access", async () => {
    const f = fixture("another-owner");
    await expect(f.send("", { audio: { buffer: Buffer.from("a"), mimeType: "audio/ogg", size: 1 } }))
      .rejects.toThrow("Parcela no encontrada");
    expect(mocks.turn).not.toHaveBeenCalled();
    expect(mocks.transcribe).not.toHaveBeenCalled();
    expect(f.storage.createMessage).not.toHaveBeenCalled();
  });
  it("replays persisted decisions without another generation or duplicate entry", async () => {
    const f = fixture();
    mocks.turn.mockResolvedValue({ kind: "report", record: record(), response: "Anoté: urea.", recommendedFieldAction: false });
    await f.send("Apliqué urea", { providerMessageId: "same" });
    await f.send("Apliqué urea", { providerMessageId: "same" });
    expect(mocks.turn).toHaveBeenCalledTimes(1);
    expect(f.entries).toHaveLength(1);
    expect(f.messages).toHaveLength(2);
  });
  it("recovers the ledger write after the response was persisted", async () => {
    const f = fixture();
    mocks.turn.mockResolvedValue({ kind: "report", record: record(), response: "Anoté: urea.", recommendedFieldAction: false });
    f.storage.saveAutomaticFieldLog.mockRejectedValueOnce(new Error("temporary database error"));
    await expect(f.send("Apliqué urea", { providerMessageId: "retry" })).rejects.toThrow();
    await f.send("Apliqué urea", { providerMessageId: "retry" });
    expect(mocks.turn).toHaveBeenCalledTimes(1);
    expect(f.entries).toHaveLength(1);
  });
  it("keeps audio transcription and private evidence attached to the report", async () => {
    const f = fixture();
    mocks.turn.mockResolvedValue({ kind: "report", record: record("riego"),
      response: "Anoté: riego de dos horas, ayer.", recommendedFieldAction: false });
    const media = { buffer: Buffer.from("audio"), mimeType: "audio/ogg", size: 5, kind: "audio" };
    await f.send("", { audio: media, media });
    expect(mocks.transcribe).toHaveBeenCalledTimes(1);
    expect(f.entries[0].transcription).toBe("Regué ayer dos horas.");
    expect(f.entries[0].evidence[0].path).toBe("/objects/private/evidence");
  });
  it("does not schedule follow-up for receipts, but schedules concrete advice at 24h", async () => {
    const f = fixture();
    await f.send("Hola");
    expect(f.storage.createInteractionState).not.toHaveBeenCalled();
    mocks.turn.mockResolvedValue({ kind: "query", record: null, response: "Revisa la humedad a 20 cm.",
      recommendedFieldAction: true });
    await f.send("¿Qué reviso?");
    expect(f.interactions[0].dueAt.getTime() - now.getTime()).toBe(24 * 60 * 60 * 1000);
  });
  it("honors brief and detailed modes without shortening a detailed generation", async () => {
    const f = fixture();
    await f.send("Consulta");
    expect(mocks.turn.mock.calls[0][0].mode).toBe("brief");
    await f.send("Explica", { responseMode: "detailed", queryOnly: true });
    expect(mocks.turn.mock.calls[1][0].mode).toBe("detailed");
  });
  it("binds correction and cancellation to the selected original report", async () => {
    const f = fixture();
    f.entries.push({ id: "first", userId: "u", parcelId: "p", sourceProviderMessageId: "original",
      status: "confirmed", currentRevision: 2, createdAt: now, structuredData: record() });
    mocks.turn.mockResolvedValue({ kind: "report", record: record(), response: "Corregí la cantidad.", recommendedFieldAction: false });
    await f.send("CORREGIR fueron 25 kg", { interactionTargetId: "original" });
    expect(f.storage.reviseFieldLog).toHaveBeenCalledWith("first", "u", expect.any(String), 2, expect.any(Object));
    await f.send("CANCELAR", { interactionTargetId: "original" });
    expect(f.storage.rejectFieldLog).toHaveBeenCalledWith("first", "u", expect.any(String), 2);
  });
  it("rejects delayed actions for a foreign parcel", async () => {
    const f = fixture();
    f.storage.getFieldLogBySourceMessage.mockResolvedValueOnce({ id: "foreign", userId: "u", parcelId: "other" } as any);
    await expect(f.send("CANCELAR", { interactionTargetId: "foreign" })).rejects.toThrow("Registro de otra parcela");
    expect(f.storage.rejectFieldLog).not.toHaveBeenCalled();
  });

  function twoReports() {
    const f = fixture();
    f.entries.push(
      { id: "urea", userId: "u", parcelId: "p", sourceProviderMessageId: "urea-source",
        occurredAt: new Date("2026-06-01T10:00Z"), createdAt: now, status: "confirmed", currentRevision: 1,
        structuredData: record() },
      { id: "irrigation", userId: "u", parcelId: "p", sourceProviderMessageId: "water-source",
        activityType: "riego", occurredAt: now, createdAt: now, status: "confirmed", currentRevision: 1,
        structuredData: { activityType: "riego", items: [{ name: "riego", unit: "horas", quantity: 3 }] } },
    );
    mocks.turn.mockResolvedValue({ kind: "report", record: { ...record(),
      items: [{ ...record().items[0], quantity: 60 }] }, response: "", recommendedFieldAction: false });
    return f;
  }
  it.each(["CORREGIR fueron 60 kg", "CORREGIR fueron 60 kilos de urea"])(
    "selects urea by product or unit rather than the newer irrigation: %s", async text => {
      const f = twoReports();
      const reply = await f.send(text);
      expect(f.storage.reviseFieldLog).toHaveBeenCalledWith("urea", "u", expect.any(String), 1, expect.any(Object));
      expect(reply).toContain("Corregí Urea del 1 de junio de 2026");
      expect(reply).toContain("60 kg");
    });
  it("selects the irrigation by labor or unit", async () => {
    const f = twoReports();
    await f.send("CORREGIR el riego fueron 4 horas");
    expect(f.storage.reviseFieldLog).toHaveBeenCalledWith("irrigation", "u", expect.any(String), 1, expect.any(Object));
  });
  it("falls back to the latest report when there is no matching clue", async () => {
    const f = twoReports();
    await f.send("CORREGIR fue ayer");
    expect(f.storage.reviseFieldLog).toHaveBeenCalledWith("irrigation", "u", expect.any(String), 1, expect.any(Object));
  });
  it("asks one question rather than choosing between two kg reports, then applies the original change", async () => {
    const f = twoReports();
    f.entries.push({ ...f.entries[0], id: "dap", sourceProviderMessageId: "dap-source",
      occurredAt: new Date("2026-06-01T11:00Z"),
      structuredData: { ...record(), items: [{ ...record().items[0], name: "DAP" }] } });
    const question = await f.send("CORREGIR fueron 60 kg");
    expect(question).toContain("Urea");
    expect(question).toContain("DAP");
    expect(question.match(/\?/g)).toHaveLength(1);
    expect(mocks.turn).not.toHaveBeenCalled();
    expect(f.storage.reviseFieldLog).not.toHaveBeenCalled();
    const state = f.interactions.at(-1);
    f.storage.getOpenInteractionState.mockResolvedValue({ id: "choice", payload: state.payload });
    await f.send("Urea");
    expect(f.storage.reviseFieldLog).toHaveBeenCalledWith("urea", "u", expect.any(String), 1, expect.any(Object));
    expect(mocks.turn.mock.calls[0][0].text).toContain("fueron 60 kg");
  });
  it("names the latest cancelled report and replays cancellation without another generation", async () => {
    const f = twoReports();
    const reply = await f.send("CANCELAR", { providerMessageId: "cancel" });
    expect(reply).toContain("Cancelé riego del 1 de junio de 2026");
    expect(f.storage.rejectFieldLog).toHaveBeenCalledWith("irrigation", "u", "cancel", 1);
    expect(await f.send("CANCELAR", { providerMessageId: "cancel" })).toBe(reply);
    expect(mocks.turn).not.toHaveBeenCalled();
  });
  it("makes CONFIRMAR a replayable acknowledgement without changing the record or invoking AI", async () => {
    const f = twoReports();
    const reply = await f.send("CONFIRMAR", { providerMessageId: "confirm" });
    expect(reply).toContain("ya quedó guardado");
    expect(reply).toContain("CORREGIR o CANCELAR");
    expect(await f.send("CONFIRMAR", { providerMessageId: "confirm" })).toBe(reply);
    expect(mocks.turn).not.toHaveBeenCalled();
    expect(f.storage.reviseFieldLog).not.toHaveBeenCalled();
    expect(f.storage.saveAutomaticFieldLog).not.toHaveBeenCalled();
  });
  it("prepares Ver mapa before its only generation", async () => {
    const f = fixture();
    mocks.map.mockResolvedValue({ summary: { index: "ndvi", imageDate: "2026-05-31", mean: .7,
      level: "alto", percentages: { low: 0, medium: 0, high: 100, unseen: 0 },
      lowHa: 0, weakLocations: [], change: null }, objectPath: "/objects/map.png" });
    await f.send("Ver mapa");
    expect(mocks.turn).toHaveBeenCalledTimes(1);
    expect(mocks.map.mock.invocationCallOrder[0]).toBeLessThan(mocks.turn.mock.invocationCallOrder[0]);
    expect(mocks.turn.mock.calls[0][0].mapSummary.mean).toBe(.7);
  });
});

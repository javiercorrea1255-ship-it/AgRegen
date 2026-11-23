import { describe, expect, it } from "vitest";
import {
  classifyWhatsappTask,
  buildWhatsappTreatmentEvidence,
  selectWhatsappModel,
  validateWhatsappResponse,
} from "../server/services/ai-assistant";

const baseContext = {
  parcel: { id: "p1", crop: "maíz" },
  parcelData: [{ id: "d1" }],
  soilAnalysis: { id: "s1" },
  tillagePractices: [{ id: "t1" }],
  cropRotation: [{ id: "r1" }],
  animalIntegration: null,
  livelihood: null,
  weatherData: { currentTemp: 31, humidity: 40, precipitation: 0 },
  operationalLog: {
    period: { from: "2026-01-01", to: "2026-01-02" },
    limited: false,
    totalConfirmedInPeriod: 1,
    events: [{ citation: "Riego confirmado", occurredAt: "2026-01-01", activityType: "riego", items: [], observations: null, confirmedAt: "2026-01-01", revision: 1, channel: "WhatsApp" as const }],
  },
} as any;

describe("WhatsApp intelligence policy", () => {
  it("routes simple, complex and image requests to distinct model tasks", () => {
    expect(classifyWhatsappTask("Hola, ¿cómo está mi parcela?")).toBe("fast");
    expect(classifyWhatsappTask("Compara el historial y recomienda un plan")).toBe("primary");
    expect(classifyWhatsappTask("¿Qué ves?", true)).toBe("image");
  });

  it("keeps provider selection allow-listed independently of the complete context", () => {
    expect(selectWhatsappModel("fast").provider).toBe("openai");
    expect(selectWhatsappModel("image").supported).toBe(true);
    expect(selectWhatsappModel("primary", "sinong")).toMatchObject({
      provider: "openai", supported: false,
    });
  });

  it("repairs incomplete recommendations and blocks unsafe pesticide certainty", () => {
    const response = validateWhatsappResponse("Aplica insecticida ahora.");
    expect(response).not.toContain("Aplica insecticida");
    expect(response).toContain("Evidencia confirmada:");
    expect(response).toContain("Confianza:");
    expect(response).toContain("no aplicar plaguicidas");
  });

  it("does not treat explicitly missing treatment data as affirmative evidence", () => {
    const evidence = buildWhatsappTreatmentEvidence(
      "No conozco la plaga, no tengo etiqueta ni condiciones. ¿Aplico 2 L/ha?",
      baseContext,
    );
    expect(evidence).toMatchObject({
      hasIdentification: false,
      hasLabel: false,
      hasDose: false,
      hasConditions: false,
    });
    const response = validateWhatsappResponse("Aplica insecticida a 2 L/ha.", evidence);
    expect(response).not.toContain("Aplica insecticida");
    const decimalResponse = validateWhatsappResponse("Aplica 2.5 L/ha de insecticida al amanecer.", evidence);
    expect(decimalResponse).not.toContain("Aplica 2.5");
  });
});
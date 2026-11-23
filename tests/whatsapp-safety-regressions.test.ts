import { describe, expect, it } from "vitest";
import { validateWhatsappResponse, buildWhatsappTreatmentEvidence } from "../server/services/ai-assistant";

describe("Pesticide safety applies to new pesticide recommendations only", () => {
  it.each([
    "Según la bitácora, aplicaron fertilizante hoy, 2026-11-17, a las 21:05. El registro reciente indica urea: 50 kg.",
    "Ayer aplicaste 2.5 L/ha de insecticida; así quedó registrado en la bitácora.",
    "El productor registró una aplicación de herbicida de 2 L/ha.",
    "Aplica 50 kg de urea, según tu análisis de suelo.",
    "Usa 200 kg de cal como enmienda.",
    "Riega durante 3 horas; mañana revisa la humedad.",
    "Llevas gastados 1,200 MXN: 900 de urea y 300 de semillas.",
    "No apliques insecticida sin revisar la etiqueta.",
    "No recomiendo usar herbicida.",
    "Evita aplicar fungicida.",
  ])("preserves the non-treatment answer: %s", text => {
    expect(validateWhatsappResponse(text)).toBe(text);
  });
  it.each(["Aplica insecticida ahora.", "Aplica 2.5 L/ha de herbicida.",
    "Puedes usar fungicida mañana.", "Recomiendo un insecticida.", "Aplica glifosato a 2 L/ha."])(
    "blocks unsafe new treatment: %s", text => {
      const checked = validateWhatsappResponse(text);
      expect(checked).not.toContain(text);
      expect(checked).toContain("No aplicar plaguicidas");
    });
  it.each(["hasIdentification", "hasLabel", "hasDose"] as const)(
    "blocks when %s is missing", field => {
      const evidence = { hasIdentification: true, hasLabel: true, hasDose: true,
        hasCrop: true, hasStage: true, hasConditions: true, [field]: false };
      expect(validateWhatsappResponse("Aplica insecticida a 2 L/ha.", evidence)).toContain("No aplicar plaguicidas");
    });
  it("does not block when identification, label and dose were provided", () => {
    const text = "Aplica insecticida a 2 L/ha según la etiqueta revisada.";
    expect(validateWhatsappResponse(text, { hasIdentification: true, hasLabel: true, hasDose: true,
      hasCrop: true, hasStage: false, hasConditions: false })).toBe(text);
  });
  it("does not mistake identifying only a product for identifying the pest", () => {
    expect(buildWhatsappTreatmentEvidence("producto: insecticida; etiqueta revisada, 2 L/ha",
      { parcel: { crop: "maíz" } } as any).hasIdentification).toBe(false);
  });
});

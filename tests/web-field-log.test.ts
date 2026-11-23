import { describe, it, expect, vi } from "vitest";
import { persistWebFieldLog } from "../server/services/web-field-log";
import { normalizeFieldLogTurn } from "../server/services/field-log-turn";
import { fieldLogOrigin } from "../shared/field-log-policy";
const now = new Date("2026-11-17T22:15:00Z");
const record = normalizeFieldLogTurn({ kind: "report", response: "", recommendedFieldAction: false,
  record: { activityType: "fertilization", items: [{ name: "urea", category: "input", quantity: 50,
    unit: "kg", cost: 900 }], observations: null, confidence: .9 } }, now).record!;
function fixture(owner = "u") {
  const entries = new Map<string, any>();
  const storage = {
    getParcel: vi.fn().mockResolvedValue({ id: "p", userId: owner }),
    getFieldLogBySourceMessage: vi.fn(async (id: string) => entries.get(id)),
    saveAutomaticFieldLog: vi.fn(async (data: any) => {
      const entry = { id: "entry", status: "confirmed", ...data }; entries.set(data.sourceProviderMessageId, entry); return entry;
    }),
  } as any;
  const options = { storage, userId: "u", parcelId: "p", sourceId: "web:conv:request-unique",
    originalText: "Registra: apliqué 50 kg de urea, costó 900 pesos", response: "Bitácora registrada (transcrita y ordenada).",
    now, record };
  return { storage, entries, options };
}
describe("web chat uses the real operational ledger", () => {
  it.each(["Tu aplicación quedó registrada en la bitácora.", "La labor está guardada correctamente.",
    "Ya lo incorporé al historial.", "Se asentó el riego en el cuaderno.",
    "Tu reporte figura en la bitácora.", "El gasto se encuentra incluido en el registro.",
    "He guardado tu aplicación.", "Quedaron anotados los gastos.", "Logged your field operation.",
    "Ya está en tu bitácora.", "Tu aplicación tiene un registro.", "El riego quedó documentado en el historial."])(
    "rejects the entire unsupported save acknowledgement: %s", async response => {
      for (const mode of ["normal", "deep", "diagnosis"] as const) {
        const f = fixture();
        const result = await persistWebFieldLog({ ...f.options, mode, record: null,
          response: `Revisa la humedad mañana. ${response}` });
        expect(result.entry).toBeNull(); expect(f.storage.saveAutomaticFieldLog).not.toHaveBeenCalled();
        expect(result.response).toMatch(/^No guardé nuevos registros de bitácora/);
        expect(result.response).not.toContain(response);
        expect(result.response).not.toContain("Revisa la humedad");
      }
    });
  it.each(["Tu aplicación quedó registrada en la bitácora.", "Todo quedó listo.",
    "La información está disponible para la próxima consulta."])(
    "discards all model prose on a failed write, without depending on acknowledgement wording: %s", async response => {
      const f = fixture(); f.storage.saveAutomaticFieldLog.mockRejectedValue(new Error("database unavailable"));
      const result = await persistWebFieldLog({ ...f.options, response });
      expect(result.response).toBe("No se guardó el registro de bitácora. Intenta de nuevo.");
    });
  it.each(["deep", "diagnosis"] as const)("keeps %s non-writing even if supplied an accidental structured record", async mode => {
    const f = fixture();
    const result = await persistWebFieldLog({ ...f.options, mode, response: "Tu aplicación quedó registrada en la bitácora." });
    expect(result.entry).toBeNull(); expect(f.storage.saveAutomaticFieldLog).not.toHaveBeenCalled();
    expect(result.response).toContain("no registra labores");
  });
  it("preserves actual historical facts and ordinary agronomic advice without a new save claim", async () => {
    const f = fixture(), response = "Según la bitácora, el 17 de noviembre aplicaste 50 kg de urea. Revisa la humedad antes de fertilizar.";
    const result = await persistWebFieldLog({ ...f.options, response, record: null });
    expect(result.response).toContain(response); expect(result.entry).toBeNull();
  });
  it("saves Spanish labor, quantity, costs and web provenance before acknowledging", async () => {
    const f = fixture(), result = await persistWebFieldLog(f.options);
    expect(f.storage.saveAutomaticFieldLog).toHaveBeenCalledOnce();
    expect(f.entries.size).toBe(1);
    expect(result.response).toContain("Anoté: fertilización con urea, 50 kg, $900");
    expect(result.response).not.toContain("transcrita y ordenada");
    expect(result.entry?.structuredData).toMatchObject({ channel: "web", registration: "automatic", totalsByCurrency: { MXN: 900 } });
    expect(fieldLogOrigin(result.entry!)).toBe("web_automatic");
  });
  it("does not duplicate entries or expenses on a retry", async () => {
    const f = fixture();
    const a = await persistWebFieldLog(f.options), b = await persistWebFieldLog(f.options);
    expect(f.entries.size).toBe(1); expect(f.storage.saveAutomaticFieldLog).toHaveBeenCalledOnce();
    expect(b.response).toBe(a.response);
  });
  it("does not create a field event for a historical question or preserve a false receipt", async () => {
    const f = fixture();
    const turn = normalizeFieldLogTurn({ kind: "query", record, response: "", recommendedFieldAction: false }, now);
    const result = await persistWebFieldLog({ ...f.options, record: turn.record, originalText: "¿Cuándo aplicamos urea?" });
    expect(f.storage.saveAutomaticFieldLog).not.toHaveBeenCalled();
    expect(result.response).not.toContain("Bitácora registrada");
    expect(result.response).toContain("No guardé nuevos registros");
  });
  it("clearly reports an unsuccessful write instead of claiming registration", async () => {
    const f = fixture(); f.storage.saveAutomaticFieldLog.mockRejectedValue(new Error("database unavailable"));
    const result = await persistWebFieldLog(f.options);
    expect(result.entry).toBeNull(); expect(f.entries.size).toBe(0);
    expect(result.response).toContain("No se guardó"); expect(result.response).not.toContain("Anoté:");
  });
  it("reconciles a lost DB acknowledgement against the same unique source", async () => {
    const f = fixture(), save = f.storage.saveAutomaticFieldLog.getMockImplementation();
    f.storage.saveAutomaticFieldLog.mockImplementation(async (data: any) => { await save(data); throw new Error("connection lost"); });
    const result = await persistWebFieldLog(f.options);
    expect(result.response).toContain("Anoté:"); expect(f.entries.size).toBe(1);
  });
  it("does not claim definite failure when the DB outcome cannot be verified", async () => {
    const f = fixture(); f.storage.saveAutomaticFieldLog.mockRejectedValue(new Error("network"));
    f.storage.getFieldLogBySourceMessage.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("network"));
    const result = await persistWebFieldLog(f.options);
    expect(result.response).toContain("No pude verificar"); expect(result.response).not.toContain("Anoté:");
  });
  it("authorizes ownership before any write", async () => {
    const f = fixture("foreign-owner");
    await expect(persistWebFieldLog(f.options)).rejects.toThrow("no autorizada");
    expect(f.storage.saveAutomaticFieldLog).not.toHaveBeenCalled();
  });
  it("rejects a source collision belonging to another parcel", async () => {
    const f = fixture(); f.entries.set(f.options.sourceId, { userId: "other", parcelId: "other" });
    await expect(persistWebFieldLog(f.options)).rejects.toThrow("Conflicto");
    expect(f.storage.saveAutomaticFieldLog).not.toHaveBeenCalled();
  });
  it("acknowledges persisted rather than regenerated quantities on a replay", async () => {
    const f = fixture(); await persistWebFieldLog(f.options);
    const result = await persistWebFieldLog({ ...f.options, record: { ...record, items: [{ ...record.items[0], quantity: 60 }] } });
    expect(result.response).toContain("50 kg"); expect(result.response).not.toContain("60 kg");
  });
  it("recovers a committed record even if a regenerated decision omits it", async () => {
    const f = fixture(); await persistWebFieldLog(f.options);
    const result = await persistWebFieldLog({ ...f.options, record: null });
    expect(result.response).toContain("Anoté:"); expect(f.entries.size).toBe(1);
    expect(result.response).not.toContain("No guardé");
  });
});

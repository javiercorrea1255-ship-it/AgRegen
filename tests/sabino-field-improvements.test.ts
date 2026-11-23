import { afterEach, describe, expect, it, vi } from "vitest";
import { mexicoDateKey, formatMexicoDate, civilDateInstant } from "../shared/civil-date";
import { normalizeFieldLogTurn, FIELD_FACT_RULES } from "../server/services/field-log-turn";
import { nutritionResponseSafety, soilEvidence } from "../shared/agronomic-evidence";
import { exactSoilDuplicates, soilReportRepair } from "../server/services/soil-quality";
import { producerPriceHistory, previousHarvests, PLAN_COST_RULES, renderPlanCosting } from "../server/services/parcel-economy";
import { summarizeClimatology, getParcelClimatology, clearClimatologyCache } from "../server/services/parcel-climatology";
import { whatsappDetailQuery } from "../server/services/whatsapp-detail";
import { importReviewedNotebook } from "../server/services/field-notebook";
import { insertSoilAnalysisSchema } from "../shared/schema";
import { fieldLogOccurredOn, canApplyFieldLogAction } from "../shared/field-log-policy";

afterEach(() => { vi.unstubAllGlobals(); clearClimatologyCache(); });
const report = { kind: "report", response: "", recommendedFieldAction: false,
  record: { activityType: "fertilización", items: [{ category: "input", name: "urea", quantity: 75,
    unit: "kg", cost: 1230, currency: "MXN" }], confidence: .9 } };
describe("Field evaluation improvements", () => {
  it("preserves civil dates in soil, biology and cycles and uses Mexico for event instants", () => {
    expect(mexicoDateKey("2026-11-18T00:30:00Z")).toBe("2026-11-17");
    expect(formatMexicoDate("2025-01-15")).toBe("15 de enero de 2025");
    expect(formatMexicoDate("2025-01-15T00:00:00.000Z")).toBe("15 de enero de 2025");
    expect(mexicoDateKey(civilDateInstant("2026-11-17"))).toBe("2026-11-17");
    expect(Number.isNaN(+civilDateInstant("2026-02-31"))).toBe(true);
    expect(insertSoilAnalysisSchema.parse({ parcelId: "p", analysisDate: "2026-02-13", nitrogenTotal: "   " }).nitrogenTotal).toBeNull();
    expect(normalizeFieldLogTurn({ ...report, record: { ...report.record, occurredAt: "2026-11-17" } },
      new Date("2026-11-18T00:30:00Z")).record?.occurredAt).toBe("2026-11-17");
  });
  it("does not invent today for imprecise historical reports", () => {
    const turn = normalizeFieldLogTurn({ ...report, record: { ...report.record, datePrecision: "unknown" } }, new Date());
    expect(turn.record?.occurredAt).toBeNull();
  });
  it("keeps an invalid interpreted date uncertain instead of changing the event to today", () => {
    const turn = normalizeFieldLogTurn({ ...report, record: { ...report.record, occurredAt: "2026-02-31" } }, new Date());
    expect(turn.record).toMatchObject({ occurredAt: null, datePrecision: "unknown" });
  });
  it("uses the declared civil day in ledger editing and the local day for real instants, including UTC midnight", () => {
    expect(fieldLogOccurredOn({ occurredAt: "2026-11-18T00:00:00.000Z" })).toBe("2026-11-17");
    expect(fieldLogOccurredOn({ occurredAt: "2026-11-18T00:30:00.000Z",
      structuredData: { occurredOn: "2026-11-16" } })).toBe("2026-11-16");
    expect(fieldLogOccurredOn({ occurredAt: null })).toBe("");
    expect(fieldLogOccurredOn({})).toBe("");
    expect(canApplyFieldLogAction("confirmed", "correct")).toBe(true);
    expect(canApplyFieldLogAction("confirmed", "reject")).toBe(true);
    expect(canApplyFieldLogAction("confirmed", "confirm")).toBe(false);
    expect(canApplyFieldLogAction("rejected", "correct")).toBe(false);
  });
  it.each(["query", "mixed"] as const)("discards non-facts classified by the model in a %s turn", kind => {
    const turn = normalizeFieldLogTurn({ ...report, kind, recordingDecision: "none" }, new Date());
    expect(turn.record).toBeNull();
    expect(FIELD_FACT_RULES).toContain("supongamos");
    expect(FIELD_FACT_RULES).toContain("precios de referencia");
  });
  it("keeps an ambiguous candidate for review, not an automatic fact", () => {
    expect(normalizeFieldLogTurn({ ...report, recordingDecision: "ambiguous" }, new Date()).recordingDecision).toBe("ambiguous");
  });
  it("detail expands the original inoculation question even after a format-only response", () => {
    const question = "¿Debo inocular frijol y qué hago contra Fusarium?";
    const message = { content: "La explicación excedió el formato solicitado.", contextSnapshot: { userText: question } };
    const text = whatsappDetailQuery(message);
    expect(text).toContain(`CONSULTA ORIGINAL: ${question}`);
    expect(text).toContain("qué hacer, cuánto");
    const again = whatsappDetailQuery({ content: "Respuesta técnica", contextSnapshot: { userText: text } });
    expect(again.match(/CONSULTA ORIGINAL:/g)).toHaveLength(1);
    expect(again).toContain(question);
  });
  it.each(["maíz", "frijol", "trigo"])("requires a trial strip for fertilization in %s", crop => {
    const result = nutritionResponseSafety(`Para ${crop}, recomiendo aplicar urea fraccionada.`,
      { soil: null, area: 1, yieldTarget: 4 });
    expect(result).toMatch(/franja con testigo/);
  });
  it("requires an explicit control strip for a suggested inoculant in any crop", () => {
    expect(nutritionResponseSafety("Sí conviene inocular la semilla con Rhizobium específico.",
      { soil: null, area: 1, yieldTarget: 4 })).toContain("franja con testigo");
  });
  it("repairs only report-evidenced nitrogen, retains true measured zeros and detects exact duplicates", () => {
    const a = { analysisDate: "2026-02-13", nitrogenTotal: "0.000",
      notes: "N total no analizado. N inorgánico (KCl 2N) 20.08 mg/kg" };
    const changes = soilReportRepair(a);
    expect(changes).toEqual({ nitrogenTotal: null, nitrogenInorganic: "20.08" });
    expect(soilReportRepair({ nitrogenTotal: 0, notes: "N total medido 0.000 %" })).toEqual({});
    expect(exactSoilDuplicates({ ...a, ...changes }, { ...a, ...changes, notes: "Otro laboratorio" })).toBe(true);
    expect(exactSoilDuplicates(a, { ...a, ph: "7.18" })).toBe(false);
    expect(soilEvidence({ ...a, ...changes })?.nitrogenInorganic).toBe(20.08);
  });
  it("does not clear a measured or unverified total-N zero merely because inorganic N is also reported", () => {
    expect(soilReportRepair({ nitrogenTotal: "0.000",
      notes: "N total medido 0.000 %. N inorgánico 20.08 mg/kg" })).toEqual({ nitrogenInorganic: "20.08" });
    expect(soilReportRepair({ nitrogenTotal: "0.000",
      notes: "N inorgánico 20.08 mg/kg" })).toEqual({ nitrogenInorganic: "20.08" });
  });
  it("keeps harvest income and costs separated by currency instead of summing incompatible amounts", () => {
    const rows = previousHarvests([{ id: "mixed", status: "confirmed", occurredAt: new Date(),
      structuredData: { items: [{ category: "sale", name: "frijol", cost: 10400, currency: "MXN" },
        { category: "labor", name: "costo", cost: 400, currency: "USD" }] } }] as any);
    expect(rows[0]).toMatchObject({ cost: null, revenue: null, margin: null,
      byCurrency: { MXN: { revenue: 10400, cost: 0 }, USD: { revenue: 0, cost: 400 } } });
  });
  it("uses paid prices with units and sources and excludes sales from price history", () => {
    const entries = [{ id: "urea", status: "confirmed", occurredAt: new Date("2026-05-26T18:00Z"),
      structuredData: { items: report.record.items }, createdAt: new Date() }] as any;
    expect(producerPriceHistory([], entries)[0]).toMatchObject({ unitPrice: 16.4, unit: "kg", currency: "MXN", source: "bitácora:urea" });
    expect(PLAN_COST_RULES).toContain("TODOS");
    expect(PLAN_COST_RULES).toContain("subtotal");
  });
  it("compares a historical harvest using its revenue and costs", () => {
    const entries = [{ id: "bean", status: "confirmed", occurredAt: new Date(), structuredData: {
      observations: "Frijol 2026", items: [
        { category: "sale", name: "Frijol 2026", quantity: 400, unit: "kg", cost: 10400 },
        { category: "labor", name: "Costo del cultivo anterior", cost: 6830 },
      ] } }] as any;
    expect(previousHarvests(entries)[0]).toMatchObject({ revenue: 10400, cost: 6830, margin: 3570 });
    expect(producerPriceHistory([], entries)).toEqual([]);
  });
  it("sums every plan input and labels incomplete costs as subtotals with price sources", () => {
    const items = [
      { name: "urea", quantity: 100, unit: "kg", unitPrice: 16.4, currency: "MXN", source: "productor: $1230/75 kg" },
      { name: "MAP", quantity: 75, unit: "kg", unitPrice: 18.4, currency: "MXN", source: "cuaderno 01/05" },
      { name: "KCl", quantity: 50, unit: "kg", unitPrice: 10, currency: "MXN", source: "cuaderno" },
    ];
    expect(renderPlanCosting(items)).toContain("Total del plan: $3,520 MXN");
    expect(renderPlanCosting(items)).toContain("productor: $1230/75 kg");
    expect(renderPlanCosting([...items, { ...items[0], name: "Inoculante", unitPrice: null }])).toContain("Subtotal conocido");
  });
  it("computes historical monthly rain and a documented onset indicator", () => {
    const days = Array.from({ length: 40 }, (_, i) => ({
      date: new Date(Date.UTC(2024, 4, 1 + i)).toISOString().slice(0, 10), rain: i % 3 === 0 ? 10 : 0,
    }));
    const summary = summarizeClimatology(days);
    expect(summary.typicalRainOnset).toBe("05-01");
    expect(summary.monthlyRainMM[4].mean).toBe(110);
    expect(summary.source).toContain("Open-Meteo");
  });
  it("caches real climatology and never substitutes synthetic rain on service failure", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      daily: { time: ["2025-05-01"], precipitation_sum: [12] },
    }) });
    vi.stubGlobal("fetch", fetch);
    const a = await getParcelClimatology(19.2, -97.3), b = await getParcelClimatology(19.2, -97.3);
    expect(a).toEqual(b); expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0].toString()).toContain("timezone=America%2FMexico_City");
    clearClimatologyCache(); fetch.mockRejectedValue(new Error("down"));
    expect(await getParcelClimatology(19.2, -97.3)).toBeNull();
  });
  it("imports only reviewed rows with retry idempotence and keeps unknown dates pending", async () => {
    const entries: any[] = [];
    const storage = {
      getParcel: vi.fn().mockResolvedValue({ userId: "u" }),
      getFieldLogBySourceMessage: vi.fn(async (id: string) => entries.find(e => e.sourceProviderMessageId === id)),
      saveAutomaticFieldLog: vi.fn(async (data: any) => { const row = { ...data, id: "e" }; entries.push(row); return row; }),
    } as any;
    const body = { requestId: "00000000-0000-4000-8000-000000000001", text: "Cuaderno revisado", records: [{ ...report.record, occurredAt: null, datePrecision: "unknown" }] };
    await importReviewedNotebook(storage, "u", "p", body);
    await importReviewedNotebook(storage, "u", "p", body);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ occurredAt: null, missingFields: ["fecha exacta"],
      structuredData: { reviewed: true, channel: "web" } });
    await expect(importReviewedNotebook(storage, "other", "p", body)).rejects.toThrow("autorizada");
  });
});

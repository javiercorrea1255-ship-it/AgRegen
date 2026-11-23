import { describe, expect, it } from "vitest";
import { whatsappLedgerReceipt } from "../server/services/whatsapp-ledger-receipt";
import { fieldLogActivitySpanish } from "../shared/field-log-policy";
import { normalizeWhatsappTurn } from "../server/services/whatsapp-turn";

const messageAt = new Date("2026-11-17T22:15:00Z");
const record = {
  activityType: "fertilization", occurredAt: messageAt.toISOString(),
  items: [{ category: "input", name: "urea", quantity: 50, unit: "kg", cost: 900, currency: "MXN" }],
};
describe("Spanish fact-based WhatsApp acknowledgements", () => {
  it("includes the Spanish labor, product, quantity, cost and today's Mexican date exactly", () => {
    expect(whatsappLedgerReceipt(record, messageAt))
      .toBe("Anoté: fertilización con urea, 50 kg, $900, hoy 17/11/2026.");
  });
  it("normalizes the persisted record, not just its acknowledgement", () => {
    const turn = normalizeWhatsappTurn({
      kind: "report", record, response: "", recommendedFieldAction: false,
    }, messageAt);
    expect(turn.record?.activityType).toBe("fertilización");
    expect(turn.record?.items[0]).toMatchObject({ cost: 900, currency: "MXN", quantity: 50 });
  });
  it.each([
    ["irrigation", "riego"], ["planting", "siembra"], ["harvest", "cosecha"],
    ["observation", "observación"], ["pest observation", "observación de plaga"],
    ["application", "aplicación"], ["sale", "venta"], ["expense", "gasto"],
    ["aplicación de composta", "aplicación de composta"],
  ])("normalizes %s without erasing descriptive Spanish activities", (input, expected) => {
    expect(fieldLogActivitySpanish(input)).toBe(expected);
  });
  it("does not invent a cost when none was reported, and keeps a quantity with no unit", () => {
    const value = whatsappLedgerReceipt({ ...record, items: [{ name: "urea", quantity: 50 }] }, messageAt);
    expect(value).toContain("urea, 50, hoy");
    expect(value).not.toContain("$");
  });
  it("does not call an earlier day's work 'today', including across midnight UTC", () => {
    const value = whatsappLedgerReceipt(record, new Date("2026-11-18T05:00:00Z"));
    expect(value).toContain("hoy 17/11/2026");
    expect(whatsappLedgerReceipt(record, new Date("2026-11-18T12:00:00Z"))).not.toContain("hoy");
  });
  it("keeps distinct currencies and includes explicitly reported zero costs", () => {
    expect(whatsappLedgerReceipt({ ...record, items: [
      ...record.items, { name: "flete", quantity: null as any, unit: "", cost: 20, currency: "USD" },
    ] }, messageAt)).toContain("$900, USD $20");
    expect(whatsappLedgerReceipt({ ...record, items: [{ ...record.items[0], cost: 0 }] }, messageAt)).toContain("$0");
  });
});

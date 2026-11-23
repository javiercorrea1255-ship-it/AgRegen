import { describe, expect, it } from "vitest";
import { projectParcelCosts, summarizeParcelEconomy } from "../server/services/parcel-economy";
import { fieldLogOrigin, isActiveFieldLog } from "../shared/field-log-policy";

const cycle = { id: "cycle", cycleYear: 2026, cycleSeason: "primavera-verano", totalPlannedCost: "1000" } as any;
function entry(overrides: any = {}) {
  return { id: "entry", parcelId: "p", status: "confirmed", cycleDetailId: "cycle",
    createdAt: new Date("2026-06-01"), occurredAt: new Date("2026-06-01"),
    structuredData: { registration: "automatic", items: [
      { category: "input", name: "Urea", cost: 250, currency: "MXN", quantity: 50, unit: "kg" },
    ] }, ...overrides } as any;
}
describe("One parcel expense projection", () => {
  it("adds costs module and active ledger without copying expense rows", () => {
    const manual = [{ id: "manual", totalCost: "800", category: "semillas", cycleYear: 2026,
      cycleSeason: "primavera-verano" }] as any;
    const rows = projectParcelCosts(manual, [entry()], cycle);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ origin: "field_log", readOnly: true, fieldLogEntryId: "entry" });
    expect(summarizeParcelEconomy(rows, cycle.totalPlannedCost)).toMatchObject({
      byCurrency: { MXN: { total: 1050, byCategory: { semillas: 800, otros_insumos: 250 } } },
      differenceMXN: 50,
    });
    expect(manual).toHaveLength(1);
  });
  it("does not count rejected entries, other cycles, sale proceeds or currencies as MXN", () => {
    const rows = projectParcelCosts([], [
      entry({ status: "rejected" }), entry({ cycleDetailId: "old" }),
      entry({ structuredData: { items: [{ category: "sale", cost: 2000, currency: "MXN" }] } }),
      entry({ structuredData: { items: [{ category: "labor", name: "Jornal", cost: 100, currency: "USD" }] } }),
    ], cycle);
    expect(rows).toHaveLength(1);
    expect(summarizeParcelEconomy(rows).byCurrency).toEqual({
      USD: { total: 100, byCategory: { mano_obra_otros: 100 } },
    });
  });
  it("distinguishes automatic, corrected and explicit records", () => {
    expect(fieldLogOrigin(entry())).toBe("whatsapp_automatic");
    expect(fieldLogOrigin(entry({ structuredData: {} }))).toBe("confirmed");
    expect(fieldLogOrigin(entry({ structuredData: { lastAction: "corrected" } }))).toBe("corrected");
    expect(isActiveFieldLog(entry({ status: "draft" }))).toBe(false);
    expect(isActiveFieldLog(entry())).toBe(true);
  });
  it("never substitutes the capture date for an undated confirmed expense", () => {
    expect(projectParcelCosts([], [entry({ occurredAt: null })], cycle)).toEqual([]);
    expect(projectParcelCosts([], [entry({ occurredAt: null, structuredData: {
      registration: "explicit", items: [{ category: "input", name: "Urea", cost: 900, currency: "MXN" }],
    } })])).toEqual([]);
  });
});

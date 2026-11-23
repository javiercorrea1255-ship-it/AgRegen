import type { CropCycleDetail, FieldLogEntry, ProductionCost } from "@shared/schema";
import { isActiveFieldLog, fieldLogOccurredOn } from "@shared/field-log-policy";
import { mexicoDateKey } from "@shared/civil-date";

export type ParcelCostRow = ProductionCost & {
  origin: "cost_module" | "field_log";
  readOnly: boolean;
  currency: string;
  fieldLogEntryId?: string;
};

const categoryMap: Record<string, string> = {
  labor: "mano_obra_otros", input: "otros_insumos", machinery: "maquinaria_renta",
  observation: "otros_gastos",
};

/** A read projection, never a copy into production_costs. Sale proceeds are not expenses. */
export function projectParcelCosts(
  costs: ProductionCost[],
  entries: FieldLogEntry[],
  cycle?: CropCycleDetail | null,
): ParcelCostRow[] {
  const rows: ParcelCostRow[] = costs.filter((cost) => !cycle ||
    (cost.cycleYear === cycle.cycleYear && cost.cycleSeason === cycle.cycleSeason))
    .map((cost) => ({ ...cost, origin: "cost_module", readOnly: false, currency: "MXN" }));
  for (const entry of entries) {
    if (!isActiveFieldLog(entry)) continue;
    // Captured through the explicit previous-crop form: never mix its aggregate
    // cost into the current crop merely because the sale happened this season.
    if (cycle && (entry.structuredData as any)?.historicalHarvest) continue;
    // Explicit linkage wins. Unlinked legacy rows need a date in the requested season.
    const day = fieldLogOccurredOn(entry);
    if (!day) continue;
    const date = new Date(`${day}T12:00:00Z`);
    const month = date.getUTCMonth() + 1;
    const season = month >= 4 && month <= 9 ? "primavera-verano" : "otono-invierno";
    if (cycle && (entry.cycleDetailId
      ? entry.cycleDetailId !== cycle.id
      : date.getUTCFullYear() !== cycle.cycleYear || season !== cycle.cycleSeason)) continue;
    const data = entry.structuredData as { items?: Record<string, unknown>[] } | null;
    const items = data?.items || [];
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      if (item.category === "sale" || item.cost == null || item.cost === "") continue;
      const amount = Number(item.cost);
      if (!Number.isFinite(amount) || amount < 0) continue;
      rows.push({
        id: `field-log:${entry.id}:${index}`, parcelId: entry.parcelId,
        cycleYear: cycle?.cycleYear ?? date.getUTCFullYear(),
        cycleSeason: cycle?.cycleSeason ?? season,
        category: categoryMap[String(item.category)] || "otros_gastos",
        concept: String(item.name || entry.activityType || "Gasto de bitácora"),
        unit: item.unit ? String(item.unit) : null,
        quantity: item.quantity == null ? null : String(item.quantity),
        unitCost: null, totalCost: String(amount),
        notes: `Bitácora · ${entry.id} · ${date.toISOString()}`,
        createdAt: entry.createdAt,
        origin: "field_log", readOnly: true,
        currency: String(item.currency || "MXN").toUpperCase(),
        fieldLogEntryId: entry.id,
      });
    }
  }
  return rows;
}

export function summarizeParcelEconomy(rows: ParcelCostRow[], plannedCost?: string | null) {
  const byCurrency: Record<string, { total: number; byCategory: Record<string, number> }> = {};
  for (const row of rows) {
    const amount = Number(row.totalCost);
    if (!Number.isFinite(amount)) continue;
    const totals = byCurrency[row.currency] ||= { total: 0, byCategory: {} };
    totals.total = Math.round((totals.total + amount) * 100) / 100;
    totals.byCategory[row.category] = Math.round(((totals.byCategory[row.category] || 0) + amount) * 100) / 100;
  }
  const planned = plannedCost == null ? null : Number(plannedCost);
  return {
    byCurrency,
    plannedMXN: planned != null && Number.isFinite(planned) ? planned : null,
    differenceMXN: planned != null && Number.isFinite(planned)
      ? (byCurrency.MXN?.total || 0) - planned : null,
    source: "production_costs + field_log_entries (sin copiar filas)",
  };
}

/** Latest paid unit prices; reference-only conversational prices are never expenses. */
export function producerPriceHistory(costs: ProductionCost[], entries: FieldLogEntry[]) {
  const prices: { product: string; unit: string; unitPrice: number; currency: string; date: string;
    source: string; cycle?: string; }[] = [];
  for (const cost of costs) {
    const quantity = Number(cost.quantity), total = Number(cost.totalCost);
    const price = cost.unitCost == null ? total / quantity : Number(cost.unitCost);
    if (cost.unit && Number.isFinite(price) && price > 0)
      prices.push({ product: cost.concept, unit: cost.unit, unitPrice: price, currency: "MXN",
        date: mexicoDateKey(cost.createdAt), source: `costos:${cost.id}`, cycle: `${cost.cycleSeason} ${cost.cycleYear}` });
  }
  for (const entry of entries) {
    if (!isActiveFieldLog(entry)) continue;
    const data = entry.structuredData as any;
    for (const item of data?.items || []) {
      if (item.category !== "input" || item.cost == null || !(Number(item.quantity) > 0) || !item.unit) continue;
      prices.push({ product: item.name, unit: item.unit, unitPrice: Number(item.cost) / Number(item.quantity),
        currency: item.currency || "MXN", date: data.occurredOn || mexicoDateKey(entry.occurredAt),
        source: `bitácora:${entry.id}`, cycle: data.observations || undefined });
    }
  }
  return prices.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
}
export function previousHarvests(entries: FieldLogEntry[]) {
  return entries.filter(isActiveFieldLog).flatMap(entry => {
    const data = entry.structuredData as any, items: any[] = data?.items || [];
    const sales = items.filter(item => item.category === "sale" && item.cost != null);
    if (!sales.length) return [];
    const revenue = sales.reduce((sum, item) => sum + Number(item.cost), 0);
    const cost = items.filter(item => item.category !== "sale" && item.cost != null).reduce((sum, item) => sum + Number(item.cost), 0);
    const currencies = new Set(items.filter(i => i.cost != null).map(i => i.currency || "MXN"));
    const byCurrency: Record<string, { revenue: number; cost: number; margin: number }> = {};
    for (const item of items.filter(i => i.cost != null)) {
      const totals = byCurrency[item.currency || "MXN"] ||= { revenue: 0, cost: 0, margin: 0 };
      totals[item.category === "sale" ? "revenue" : "cost"] += Number(item.cost);
      totals.margin = totals.revenue - totals.cost;
    }
    return [{ date: data.occurredOn || mexicoDateKey(entry.occurredAt), sales,
      cost: currencies.size === 1 ? cost : null, revenue: currencies.size === 1 ? revenue : null,
      margin: currencies.size === 1 ? revenue - cost : null, byCurrency,
      source: `bitácora:${entry.id}`, observations: data.observations }];
  }).slice(0, 12);
}

export const PLAN_COST_RULES = `COSTO DEL PLAN: enumera TODOS los insumos y sus cantidades (MAP, urea, KCl y los demás del plan), no solo el consultado.
Para cada insumo indica precio, unidad y fuente/fecha: precio del mensaje actual primero, después últimos precios propios, nunca un precio inventado.
Convierte bulto a kg usando su peso explícito: $1230/75 kg = $16.40/kg. Multiplica por la cantidad total del plan y suma todas las partidas en la misma moneda.
Si falta cantidad, peso del bulto o precio, presenta subtotal conocido y faltantes; no llames total a un cálculo incompleto.
Una bitácora vacía no impide calcular con precios que el productor proporcionó ni consultar el plan en la conversación.
Si no está el plan completo en el mensaje o la ficha, pide el desglose de cantidades de TODOS sus insumos (MAP, urea, KCl y demás), no solo la urea. Mientras tanto da el precio unitario comprobable, no inventes el total ni las cantidades.
No registres precios de referencia como gastos. Para comparar rentabilidad usa ingresos y costos históricos del mismo cultivo/ciclo y superficie comparable, distinguiendo dato y supuesto.`;

export function renderPlanCosting(items: { name: string; quantity: number | null; unit: string;
  unitPrice: number | null; currency: string; source: string }[]) {
  const totals: Record<string, number> = {};
  const incomplete = items.some(i => i.quantity == null || i.unitPrice == null);
  const lines = items.map(item => {
    const currency = item.currency || "MXN";
    const total = item.quantity == null || item.unitPrice == null ? null : Math.round(item.quantity * item.unitPrice * 100) / 100;
    if (total != null) totals[currency] = Math.round(((totals[currency] || 0) + total) * 100) / 100;
    return `${item.name}: ${item.quantity ?? "cantidad pendiente"} ${item.unit} × ${item.unitPrice == null ? "precio pendiente" : `$${item.unitPrice}/${item.unit}`} = ${total == null ? "pendiente" : `$${total.toLocaleString("es-MX")} ${currency}`} (fuente: ${item.source || "no disponible"}).`;
  });
  return `Desglose del plan:\n${lines.join("\n")}\n${incomplete ? "Subtotal conocido; faltan cantidades o precios, NO es el costo total" : "Total del plan"}: ${
    Object.entries(totals).map(([currency, total]) => `$${total.toLocaleString("es-MX")} ${currency}`).join("; ") || "sin partidas calculables"}.`;
}

/** The structured renderer is the sole source of monetary breakdowns. */
export function renderSinglePlanCosting(response: string, items: Parameters<typeof renderPlanCosting>[0]) {
  const prose = response.split(/\n|(?<=\.)\s+/).filter(line =>
    /no (?:apli|us)|etiqueta|seguridad/i.test(line) ||
    (!/\$|\bMXN\b|\bpesos\b|desglose|subtotal|total del plan/i.test(line) &&
    !items.some(item => line.toLowerCase().includes(item.name.toLowerCase()) && /\d/.test(line))));
  return `${prose.join("\n").trim()}\n${renderPlanCosting(items)}`.trim();
}

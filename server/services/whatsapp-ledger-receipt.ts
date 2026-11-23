import { fieldLogActivitySpanish } from "@shared/field-log-policy";
import { civilDateInstant } from "@shared/civil-date";

type ReceiptRecord = {
  activityType: string; occurredAt?: string | null;
  items: { name: string; quantity?: number | null; unit?: string | null;
    cost?: number | null; currency?: string | null }[];
};
const dateLabel = (date: Date) => new Intl.DateTimeFormat("es-MX", {
  timeZone: "America/Mexico_City", day: "2-digit", month: "2-digit", year: "numeric",
}).format(date);

/** The acknowledgement is derived from saved facts, never from the model's prose. */
export function whatsappLedgerReceipt(record: ReceiptRecord, messageAt: Date): string {
  const activity = fieldLogActivitySpanish(record.activityType);
  const items = record.items.slice(0, 3);
  const names = items.map(i => i.name.trim().slice(0, 40)).filter(Boolean);
  const newNames = names.filter(name => !activity.toLocaleLowerCase("es").includes(name.toLocaleLowerCase("es")));
  const title = `${activity}${newNames.length ? ` con ${newNames.join(", ")}` : ""}`;
  const amounts = items.filter(i => i.quantity != null).map(i =>
    `${items.length > 1 ? `${i.name.slice(0, 40)}: ` : ""}${i.quantity}${i.unit ? ` ${i.unit}` : ""}`);
  const totals = record.items.reduce<Record<string, number>>((result, item) => {
    if (item.cost != null && Number.isFinite(item.cost)) {
      const currency = (item.currency || "MXN").toUpperCase();
      result[currency] = (result[currency] || 0) + item.cost;
    }
    return result;
  }, {});
  const costs = Object.entries(totals).map(([currency, amount]) =>
    `${currency === "MXN" ? "" : `${currency} `}$${amount.toLocaleString("es-MX", {
      maximumFractionDigits: 2,
    })}`);
  const occurred = record.occurredAt ? civilDateInstant(record.occurredAt) : messageAt;
  const day = dateLabel(Number.isNaN(occurred.getTime()) ? messageAt : occurred);
  return `Anoté: ${[title, ...amounts, ...costs, `${day === dateLabel(messageAt) ? "hoy " : ""}${day}`].join(", ")}.`;
}

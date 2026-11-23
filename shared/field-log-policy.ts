import { mexicoDateKey } from "./civil-date";

/** A declared civil day takes precedence; otherwise interpret the event instant locally. */
export function fieldLogOccurredOn(entry: { occurredAt?: string | Date | null; structuredData?: unknown }): string {
  const data = entry.structuredData as { occurredOn?: string | null } | null;
  return data?.occurredOn && /^\d{4}-\d{2}-\d{2}$/.test(data.occurredOn)
    ? data.occurredOn : mexicoDateKey(entry.occurredAt ?? null);
}

export function canApplyFieldLogAction(status: string, action: "correct" | "confirm" | "reject"): boolean {
  return action === "confirm" ? ["pending", "corrected"].includes(status)
    : ["draft", "pending", "corrected", "confirmed"].includes(status);
}

/** Normalize model/provider identifiers without rewriting historical records. */
export function fieldLogActivitySpanish(value: string): string {
  const names: Record<string, string> = {
    fertilization: "fertilización", fertilisation: "fertilización", fertilizer_application: "fertilización",
    irrigation: "riego", watering: "riego", application: "aplicación", spraying: "aplicación",
    pesticide_application: "aplicación de plaguicida", harvest: "cosecha", harvesting: "cosecha",
    planting: "siembra", sowing: "siembra", sale: "venta", sales: "venta", expense: "gasto",
    observation: "observación", pest_observation: "observación de plaga", disease_observation: "observación de enfermedad",
    weather_damage: "observación de daño climático", scouting: "recorrido", labor: "labor", tillage: "labranza",
    soil_amendment: "enmienda", satellite_observation: "observación satelital", other: "otra labor",
  };
  const text = value.trim();
  return names[text.toLowerCase().replace(/[\s-]+/g, "_")] || text;
}

/** One operational ledger: automatic reports are valid, not explicit confirmations. */
export type FieldLogOrigin = "whatsapp_automatic" | "web_automatic" | "confirmed" | "corrected" | "satellite";

export function fieldLogOrigin(entry: { status: string; structuredData?: unknown }): FieldLogOrigin {
  const data = entry.structuredData as Record<string, unknown> | undefined;
  if (data?.source === "satellite") return "satellite";
  if (data?.lastAction === "corrected" || entry.status === "corrected") return "corrected";
  if (data?.channel === "web" && data?.registration === "automatic") return "web_automatic";
  return data?.registration === "automatic" ? "whatsapp_automatic" : "confirmed";
}

export function isActiveFieldLog(entry: { status: string; structuredData?: unknown }): boolean {
  if (entry.status === "confirmed") return true;
  const data = entry.structuredData as Record<string, unknown> | undefined;
  return entry.status === "corrected" && data?.registration === "automatic";
}

export const fieldLogOriginLabels: Record<FieldLogOrigin, string> = {
  whatsapp_automatic: "WhatsApp automático",
  web_automatic: "Chat web automático",
  confirmed: "Confirmado",
  corrected: "Corregido",
  satellite: "Satélite",
};

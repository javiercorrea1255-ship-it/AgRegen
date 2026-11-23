/** Date-only strings are civil dates; instants use the producer's timezone. */
export const MEXICO_TIME_ZONE = "America/Mexico_City";
export function mexicoDateKey(value: string | Date | null | undefined = new Date()): string {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (!Number.isFinite(+date)) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: MEXICO_TIME_ZONE,
    year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
export function formatMexicoDate(value: string | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = {}): string {
  if (!value) return "Sin fecha exacta";
  if (value instanceof Date && !Number.isFinite(+value)) return "Sin fecha exacta";
  // Date columns and legacy date inputs serialize at UTC midnight, not an instant.
  const civil = typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:T00:00:00(?:\.000)?Z)?$/.test(value)
    ? value.slice(0, 10) : value instanceof Date && value.toISOString().endsWith("T00:00:00.000Z")
      ? value.toISOString().slice(0, 10) : null;
  const date = civil ? new Date(`${civil}T12:00:00-06:00`) : new Date(value);
  if (!Number.isFinite(+date)) return "Sin fecha exacta";
  return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "long", year: "numeric",
    ...options, timeZone: MEXICO_TIME_ZONE }).format(date);
}
export function civilDateInstant(value: string): Date {
  const civil = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(civil ? `${value}T12:00:00-06:00` : value);
  return civil && Number.isFinite(+date) && date.toISOString().slice(0, 10) !== value ? new Date(NaN) : date;
}

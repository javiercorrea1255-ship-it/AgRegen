import type { FieldLogEntry } from "@shared/schema";
import { formatMexicoDate, mexicoDateKey } from "@shared/civil-date";

const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const units: Record<string, string> = {
  kg: "kg", kilo: "kg", kilos: "kg", kilogramo: "kg", kilogramos: "kg",
  g: "g", gr: "g", gramos: "g", gramo: "g",
  l: "l", lt: "l", litros: "l", litro: "l",
  h: "h", hr: "h", hrs: "h", hora: "h", horas: "h",
  ha: "ha", hectarea: "ha", hectareas: "ha",
};
const ignored = new Set(["corregir", "corrige", "fueron", "fue", "eran", "era", "cantidad", "registro",
  "cambiar", "cambio", "cancela", "cancelar", "ultimo", "anterior", "aplicacion", "insumo",
  "del", "los", "las", "una", "uno", "son", "por", "con", "para", "que", "no"]);
function tokens(text: string): string[] {
  return normalize(text).match(/[a-z]+/g) || [];
}
function labor(text: string) {
  const value = normalize(text);
  return [/rieg|regue|regar/, /fertiliz|abone|abonar/, /siembr|sembre/, /cosech/,
    /fumig/, /labran|barbech/, /vend[ií]|venta/].flatMap((pattern, i) => pattern.test(value) ? [i] : []);
}
export function newestFieldLogs(logs: FieldLogEntry[]) {
  return [...logs].sort((a, b) =>
    new Date(b.occurredAt || b.createdAt || 0).getTime() - new Date(a.occurredAt || a.createdAt || 0).getTime()
    || new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
}
export function fieldLogLabel(entry: FieldLogEntry) {
  const data = entry.structuredData as any;
  const name = String(data?.items?.[0]?.name || entry.activityType || data?.activityType || "registro").slice(0, 100);
  const date = data?.occurredOn || (entry.occurredAt ? mexicoDateKey(entry.occurredAt) : data?.occurredAt);
  return `${name}${date ? ` del ${formatMexicoDate(date)}` : " (sin fecha exacta)"}`;
}

/** Text actions only. Explicit button/state bindings always take precedence. */
export function selectCorrectionTarget(text: string, logs: FieldLogEntry[]) {
  const recent = newestFieldLogs(logs).slice(0, 15);
  const words = tokens(text);
  const requestedUnits = new Set(words.flatMap(t => units[t] ? [units[t]] : []));
  const products = words.filter(t => t.length > 2 && !ignored.has(t) && !units[t]);
  const requestedLabor = labor(text);
  const ranked = recent.map(entry => {
    const data = entry.structuredData as any;
    const names = tokens((data?.items || []).map((i: any) => i.name || "").join(" "));
    const entryUnits = (data?.items || []).flatMap((i: any) => tokens(i.unit || "").map(t => units[t] || t));
    const activity = `${entry.activityType || ""} ${data?.activityType || ""}`;
    const score = products.reduce((n, t) => n + (names.includes(t) ? 5 : 0), 0)
      + (entryUnits.some((t: string) => requestedUnits.has(t)) ? 2 : 0)
      + (labor(activity).some(t => requestedLabor.includes(t)) ? 3 : 0);
    return { entry, score };
  }).sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const candidates = best?.score > 0 ? ranked.filter(r => r.score === best.score).map(r => r.entry) : [];
  return { target: candidates.length === 1 ? candidates[0] : candidates.length ? undefined : recent[0],
    candidates: candidates.length > 1 ? candidates : [], matched: Boolean(best?.score > 0) };
}

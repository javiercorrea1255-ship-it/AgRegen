import type { IStorage } from "../storage";
import type { ForecastDay } from "./weather";
import { getWeatherForecast } from "./weather";
import { sendWhatsappProactiveAlert } from "./whatsapp-business";

export const WEATHER_ALERT_TYPES = ["frost", "rain", "wind", "heat"] as const;
export type WeatherAlertType = typeof WEATHER_ALERT_TYPES[number];
export type AlertThresholds = Partial<Record<WeatherAlertType, number>>;

const defaults: Record<WeatherAlertType, number> = { frost: 2, rain: 20, wind: 45, heat: 35 };

export function evaluateForecastAlerts(day: ForecastDay, thresholds: AlertThresholds = {}): WeatherAlertType[] {
  const threshold = { ...defaults, ...thresholds };
  const found: WeatherAlertType[] = [];
  if (day.tempMin <= threshold.frost) found.push("frost");
  if (day.precipitation >= threshold.rain) found.push("rain");
  if (day.windSpeed >= threshold.wind) found.push("wind");
  if (day.tempMax >= threshold.heat) found.push("heat");
  return found;
}

export function isQuietHours(now: Date, timezone: string, start: string | null, end: string | null): boolean {
  if (!start || !end || !/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return false;
  try {
    const local = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
    const value = local.replace(":", "");
    const from = start.replace(":", ""), to = end.replace(":", "");
    return from === to ? false : from < to ? value >= from && value < to : value >= from || value < to;
  } catch { return true; } // Invalid IANA zone: safest outcome is no proactive send.
}

function zonedLocalTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string,
): Date {
  const desiredAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = desiredAsUtc;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = formatter.formatToParts(new Date(candidate));
    const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
    const renderedAsUtc = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"));
    const adjustment = desiredAsUtc - renderedAsUtc;
    candidate += adjustment;
    if (adjustment === 0) break;
  }
  return new Date(candidate);
}

export function localMidnight(now: Date, timezone: string): Date {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
    return zonedLocalTimeToUtc(part("year"), part("month"), part("day"), 0, 0, timezone);
  } catch { return new Date(now.getTime() + 24 * 3600_000); }
}

export function weatherAlertText(type: WeatherAlertType, day: ForecastDay, parcelName: string): string {
  const detail = type === "frost" ? `mínima prevista de ${day.tempMin}°C` : type === "rain" ? `${day.precipitation} mm de lluvia prevista` : type === "wind" ? `viento máximo previsto de ${day.windSpeed} km/h` : `máxima prevista de ${day.tempMax}°C`;
  const advice = type === "frost"
    ? "Revisa cultivos sensibles y las medidas de protección disponibles."
    : type === "rain"
      ? "Revisa drenaje y evita aplicaciones que puedan lavarse o escurrir."
      : type === "wind"
        ? "Evita pulverizar y asegura estructuras o materiales sueltos."
        : "Revisa disponibilidad de agua y señales de estrés térmico.";
  return `Alerta meteorológica para ${parcelName}: ${detail} el ${day.date}. ${advice} Es un pronóstico preventivo, no una observación en campo.`;
}

export function createWeatherAlertSweep(deps: {
  storage: Pick<IStorage, "getActiveWeatherAlertPreferences" | "claimWeatherAlertDelivery" | "completeWeatherAlertDelivery" | "countWeatherAlertDeliveries" | "recordWeatherAlertEvaluation">;
  getForecast?: typeof getWeatherForecast;
  send?: typeof sendWhatsappProactiveAlert;
  now?: () => Date;
}) {
  let running = false;
  return async () => {
    if (running) return;
    running = true;
    try {
      const now = deps.now?.() || new Date();
      for (const pref of await deps.storage.getActiveWeatherAlertPreferences()) {
        try {
          if (!pref.connection.phoneNumber || isQuietHours(now, pref.timezone, pref.quietHoursStart, pref.quietHoursEnd)) continue;
          const latitude = Number(pref.parcel.latitude), longitude = Number(pref.parcel.longitude);
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || (latitude === 0 && longitude === 0)) {
            await deps.storage.recordWeatherAlertEvaluation(pref.id, { error: "La parcela no tiene coordenadas válidas" });
            continue;
          }
          let sent = await deps.storage.countWeatherAlertDeliveries(pref.connectionId, localMidnight(now, pref.timezone));
          if (sent >= pref.dailyCap) continue;
          const forecast = await (deps.getForecast || getWeatherForecast)(latitude, longitude);
          await deps.storage.recordWeatherAlertEvaluation(pref.id, {});
          const allowed = new Set(pref.alertTypes as WeatherAlertType[]);
          for (const day of forecast) for (const type of evaluateForecastAlerts(day, pref.thresholds as AlertThresholds)) {
            if (sent >= pref.dailyCap) break;
            if (!allowed.has(type)) continue;
            const delivery = await deps.storage.claimWeatherAlertDelivery({
              connectionId: pref.connectionId, preferenceId: pref.id, alertType: type, forecastDate: day.date,
              configVersion: pref.configVersion, localDayStart: localMidnight(now, pref.timezone), dailyCap: pref.dailyCap,
            });
            if (!delivery) continue;
            try {
              await (deps.send || sendWhatsappProactiveAlert)(pref.connection.phoneNumber, weatherAlertText(type, day, pref.parcel.name));
              await deps.storage.completeWeatherAlertDelivery(delivery.id, "sent");
              await deps.storage.recordWeatherAlertEvaluation(pref.id, { sent: true });
              sent += 1;
            } catch (error) {
              const message = error instanceof Error ? error.message : "No se pudo enviar la alerta";
              await deps.storage.completeWeatherAlertDelivery(delivery.id, "failed", message);
              await deps.storage.recordWeatherAlertEvaluation(pref.id, { error: message });
            }
          }
        } catch (error) {
          await deps.storage.recordWeatherAlertEvaluation(pref.id, {
            error: error instanceof Error ? error.message : "No se pudo evaluar el pronóstico",
          }).catch(() => undefined);
        }
      }
    } catch (error) {
      // This sweep runs from fire-and-forget timers. A failed initial query
      // must not become an unhandled rejection that terminates the web server.
      console.error("[weather-alerts] sweep failed:", error instanceof Error ? error.message : "unknown");
    } finally { running = false; }
  };
}
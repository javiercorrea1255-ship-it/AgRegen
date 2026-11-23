import { describe, expect, it, vi } from "vitest";
import { createWeatherAlertSweep, evaluateForecastAlerts, isQuietHours, localMidnight } from "../server/services/weather-alerts";

const day = { date: "2026-10-01", dayName: "jueves", tempMin: 2, tempMax: 35, precipitation: 20, windSpeed: 45, humidity: 50, weatherCode: 0, icon: "sun" as const };

function preference(id = "pref", overrides: Record<string, unknown> = {}) {
  return {
    id, connectionId: `conn-${id}`, parcelId: `parcel-${id}`, enabled: true,
    alertTypes: ["frost"], thresholds: {}, timezone: "America/Mexico_City",
    quietHoursStart: null, quietHoursEnd: null, dailyCap: 3, configVersion: 1,
    connection: { phoneNumber: "521234567890", status: "verified" },
    parcel: { latitude: "20", longitude: "-103", name: `Lote ${id}` },
    ...overrides,
  };
}

function sweepStorage(preferences: any[], count = 0) {
  return {
    getActiveWeatherAlertPreferences: vi.fn().mockResolvedValue(preferences),
    countWeatherAlertDeliveries: vi.fn().mockResolvedValue(count),
    claimWeatherAlertDelivery: vi.fn().mockResolvedValue({ id: "delivery-1" }),
    completeWeatherAlertDelivery: vi.fn().mockResolvedValue(undefined),
    recordWeatherAlertEvaluation: vi.fn().mockResolvedValue(undefined),
  };
}

describe("weather alert evaluator", () => {
  it("includes threshold boundaries and only forecast metrics", () => {
    expect(evaluateForecastAlerts(day)).toEqual(["frost", "rain", "wind", "heat"]);
    expect(evaluateForecastAlerts({ ...day, tempMin: 2.1, precipitation: 19, windSpeed: 44, tempMax: 34 })).toEqual([]);
  });

  it("honors an overnight IANA quiet period", () => {
    expect(isQuietHours(new Date("2026-10-01T05:00:00Z"), "America/Mexico_City", "22:00", "07:00")).toBe(true);
    expect(isQuietHours(new Date("2026-10-01T18:00:00Z"), "America/Mexico_City", "22:00", "07:00")).toBe(false);
  });

  it("uses the offset at local midnight on a DST transition day", () => {
    expect(localMidnight(new Date("2026-10-25T12:00:00Z"), "Europe/Madrid").toISOString())
      .toBe("2026-10-24T22:00:00.000Z");
    expect(localMidnight(new Date("2026-03-29T12:00:00Z"), "Europe/Madrid").toISOString())
      .toBe("2026-03-28T23:00:00.000Z");
  });

  it("does not send when a durable delivery cannot be claimed", async () => {
    const storage = sweepStorage([preference()]);
    storage.claimWeatherAlertDelivery.mockResolvedValue(undefined);
    const send = vi.fn();
    await createWeatherAlertSweep({ storage: storage as any, getForecast: vi.fn().mockResolvedValue([day]), send, now: () => new Date("2026-10-01T18:00:00Z") })();
    expect(send).not.toHaveBeenCalled();
  });

  it("sends an alert at its threshold and persists sent delivery/evaluation status", async () => {
    const storage = sweepStorage([preference()]);
    const send = vi.fn().mockResolvedValue(undefined);
    await createWeatherAlertSweep({ storage: storage as any, getForecast: vi.fn().mockResolvedValue([{ ...day, precipitation: 0, windSpeed: 0, tempMax: 20 }]), send, now: () => new Date("2026-10-01T18:00:00Z") })();
    expect(storage.claimWeatherAlertDelivery).toHaveBeenCalledWith(expect.objectContaining({
      alertType: "frost", forecastDate: "2026-10-01", dailyCap: 3, localDayStart: expect.any(Date),
    }));
    expect(send).toHaveBeenCalledWith("521234567890", expect.stringContaining("mínima prevista de 2°C"));
    expect(storage.completeWeatherAlertDelivery).toHaveBeenCalledWith("delivery-1", "sent");
    expect(storage.recordWeatherAlertEvaluation).toHaveBeenCalledWith("pref", { sent: true });
  });

  it("does not fetch or deliver after the per-connection daily cap", async () => {
    const storage = sweepStorage([preference()], 3);
    const forecast = vi.fn();
    await createWeatherAlertSweep({ storage: storage as any, getForecast: forecast, send: vi.fn(), now: () => new Date("2026-10-01T18:00:00Z") })();
    expect(forecast).not.toHaveBeenCalled();
    expect(storage.claimWeatherAlertDelivery).not.toHaveBeenCalled();
  });

  it("records one preference failure and continues evaluating later preferences", async () => {
    const storage = sweepStorage([preference("broken"), preference("healthy")]);
    const forecast = vi.fn()
      .mockRejectedValueOnce(new Error("weather unavailable"))
      .mockResolvedValueOnce([{ ...day, precipitation: 0, windSpeed: 0, tempMax: 20 }]);
    const send = vi.fn().mockResolvedValue(undefined);
    await createWeatherAlertSweep({ storage: storage as any, getForecast: forecast, send, now: () => new Date("2026-10-01T18:00:00Z") })();
    expect(storage.recordWeatherAlertEvaluation).toHaveBeenCalledWith("broken", { error: "weather unavailable" });
    expect(send).toHaveBeenCalledWith("521234567890", expect.stringContaining("Lote healthy"));
    expect(storage.completeWeatherAlertDelivery).toHaveBeenCalledWith("delivery-1", "sent");
  });

  it("rejects zero-zero coordinates without calling the forecast provider", async () => {
    const storage = sweepStorage([preference("zero", { parcel: { latitude: "0", longitude: "0", name: "Sin ubicación" } })]);
    const forecast = vi.fn();
    await createWeatherAlertSweep({ storage: storage as any, getForecast: forecast, send: vi.fn(), now: () => new Date("2026-10-01T18:00:00Z") })();
    expect(forecast).not.toHaveBeenCalled();
    expect(storage.recordWeatherAlertEvaluation).toHaveBeenCalledWith("zero", { error: "La parcela no tiene coordenadas válidas" });
  });

  it("does not overlap sweeps while an earlier reservation is still evaluating", async () => {
    const storage = sweepStorage([preference()]);
    let release!: () => void;
    const forecast = vi.fn().mockImplementation(() => new Promise<typeof day[]>((resolve) => { release = () => resolve([{ ...day, precipitation: 0, windSpeed: 0, tempMax: 20 }]); }));
    const sweep = createWeatherAlertSweep({ storage: storage as any, getForecast: forecast, send: vi.fn(), now: () => new Date("2026-10-01T18:00:00Z") });
    const first = sweep();
    await Promise.resolve();
    await sweep();
    expect(forecast).toHaveBeenCalledTimes(1);
    release();
    await first;
  });
});
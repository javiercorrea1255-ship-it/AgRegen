import { afterEach, describe, expect, it, vi } from "vitest";
import { getRecentObservedWeather } from "../server/services/weather";
afterEach(() => vi.unstubAllGlobals());
function payload() {
  return { daily: {
    time: ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17"],
    precipitation_sum: [1, 2, 0, 0, 1, 0, 3, 99],
    temperature_2m_min: [15, 15, 15, 15, 15, 15, 15, 0],
    temperature_2m_max: [25, 25, 25, 25, 25, 25, 25, 0],
  } };
}
describe("Recent climate evidence in the same parcel card", () => {
  it("uses only seven complete days, excluding today's forecast", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(payload()))));
    expect(await getRecentObservedWeather(20, -103)).toMatchObject({
      from: "2026-11-10", to: "2026-11-16", days: 7, rainMm: 7, tempMean: 20,
    });
  });
  it("does not turn a missing rainfall measurement into zero", async () => {
    const data = payload();
    data.daily.precipitation_sum[0] = null as any;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(data))));
    expect(await getRecentObservedWeather(20, -103)).toMatchObject({ rainMm: null });
  });
  it("returns unavailable rather than synthetic weather after a provider failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await getRecentObservedWeather(20, -103)).toBeNull();
  });
});

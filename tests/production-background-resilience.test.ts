import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWeatherAlertSweep } from "../server/services/weather-alerts";
import { registerWhatsappRoutes } from "../server/routes/whatsapp";

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Production background database failure resilience", () => {
  it("contains an initial weather query failure and allows the next sweep", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const storage = {
      getActiveWeatherAlertPreferences: vi.fn()
        .mockRejectedValueOnce(new Error("The endpoint has been disabled"))
        .mockResolvedValue([]),
    };
    const sweep = createWeatherAlertSweep({ storage: storage as any });
    await expect(sweep()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith("[weather-alerts] sweep failed:", "The endpoint has been disabled");
    await expect(sweep()).resolves.toBeUndefined();
    expect(storage.getActiveWeatherAlertPreferences).toHaveBeenCalledTimes(2);
  });

  it("keeps timer-triggered weather and follow-up failures from escaping, then retries on schedule", async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const storage = {
      claimWhatsappMessages: vi.fn().mockResolvedValue([]),
      getActiveWeatherAlertPreferences: vi.fn().mockRejectedValue(new Error("database unavailable")),
      claimDueInteractionStates: vi.fn()
        .mockRejectedValueOnce(new Error("database unavailable"))
        .mockResolvedValue([]),
    };
    const guard = (_req: any, _res: any, next: any) => next();
    registerWhatsappRoutes(express(), storage as any, guard, guard);
    await vi.advanceTimersByTimeAsync(30_001);
    expect(error).toHaveBeenCalledWith("[weather-alerts] sweep failed:", "database unavailable");
    expect(error).toHaveBeenCalledWith("[whatsapp] follow-up sweep failed:", "database unavailable");
    expect(storage.claimDueInteractionStates).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(storage.claimDueInteractionStates).toHaveBeenCalledTimes(2);
  });

  it("contains a failure to persist follow-up error state without sending or blind retries", async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const storage = {
      claimWhatsappMessages: vi.fn().mockResolvedValue([]),
      getActiveWeatherAlertPreferences: vi.fn().mockResolvedValue([]),
      claimDueInteractionStates: vi.fn().mockResolvedValue([{ id: "fixture", userId: "fixture-user", parcelId: "fixture-parcel", payload: {} }]),
      getWhatsappConnectionForUser: vi.fn().mockRejectedValue(new Error("read failure")),
      completeInteractionState: vi.fn().mockRejectedValue(new Error("write failure")),
    };
    const guard = (_req: any, _res: any, next: any) => next();
    registerWhatsappRoutes(express(), storage as any, guard, guard);
    await vi.advanceTimersByTimeAsync(30_001);
    expect(error).toHaveBeenCalledWith("[whatsapp] follow-up sweep failed:", "write failure");
    expect(storage.claimDueInteractionStates).toHaveBeenCalledTimes(1);
    expect(storage.completeInteractionState).toHaveBeenCalledWith("fixture", "failed", expect.objectContaining({ error: "read failure" }));
  });
});

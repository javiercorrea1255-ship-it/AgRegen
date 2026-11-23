import { beforeEach, describe, expect, it } from "vitest";
import {
  getWhatsappMetricsSnapshot,
  recordWhatsappMetric,
  resetWhatsappMetricsForTests,
  whatsappEndToEndDuration,
} from "../server/services/whatsapp-metrics";

beforeEach(resetWhatsappMetricsForTests);

describe("WhatsApp aggregate metrics", () => {
  it("calculates latency percentiles, success and token totals without message content", () => {
    for (const durationMs of [100, 200, 300, 400, 500]) {
      recordWhatsappMetric({ stage: "total", durationMs, success: durationMs < 500 });
    }
    recordWhatsappMetric({ stage: "model", durationMs: 250, success: true, model: "fast", inputTokens: 100, outputTokens: 25 });
    const snapshot = getWhatsappMetricsSnapshot();
    expect(snapshot.stages.total).toMatchObject({ count: 5, successRate: 0.8, p50Ms: 300, p95Ms: 400 });
    expect(snapshot.models.fast).toEqual({ calls: 1, inputTokens: 100, outputTokens: 25 });
    expect(JSON.stringify(snapshot)).not.toContain("message");
  });

  it("includes time spent waiting in the queue in end-to-end duration", () => {
    expect(whatsappEndToEndDuration(
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2026-01-01T00:00:05.250Z"),
    )).toBe(5250);
  });
});
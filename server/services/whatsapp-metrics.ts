type WhatsappMetric = {
  stage: "queue" | "media" | "context" | "model" | "map" | "send" | "total";
  durationMs: number;
  success: boolean;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
};

const MAX_SAMPLES = 1000;
const samples: WhatsappMetric[] = [];

export function recordWhatsappMetric(metric: WhatsappMetric): void {
  samples.push({ ...metric, durationMs: Math.max(0, Math.round(metric.durationMs)) });
  if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
  if (metric.stage === "total" && samples.filter((item) => item.stage === "total").length % 100 === 0) {
    console.info("[whatsapp] aggregate metrics", getWhatsappMetricsSnapshot());
  }
}

function percentile(values: number[], fraction: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

export function getWhatsappMetricsSnapshot() {
  const stages = Object.fromEntries(
    (["queue", "media", "context", "model", "map", "send", "total"] as const).map((stage) => {
      const entries = samples.filter((item) => item.stage === stage);
      const durations = entries.map((item) => item.durationMs);
      return [stage, {
        count: entries.length,
        successRate: entries.length ? entries.filter((item) => item.success).length / entries.length : 0,
        p50Ms: percentile(durations, 0.5),
        p95Ms: percentile(durations, 0.95),
      }];
    }),
  );
  const models: Record<string, { calls: number; inputTokens: number; outputTokens: number }> = {};
  for (const item of samples) {
    if (!item.model) continue;
    const aggregate = models[item.model] ||= { calls: 0, inputTokens: 0, outputTokens: 0 };
    aggregate.calls += 1;
    aggregate.inputTokens += item.inputTokens || 0;
    aggregate.outputTokens += item.outputTokens || 0;
  }
  return { sampleWindow: samples.length, stages, models };
}

export function resetWhatsappMetricsForTests(): void {
  samples.length = 0;
}

export function whatsappEndToEndDuration(createdAt: Date, completedAt = new Date()): number {
  return Math.max(0, completedAt.getTime() - createdAt.getTime());
}
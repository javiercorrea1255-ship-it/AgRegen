import type { Express } from "express";

/** Cheap process/web readiness; deliberately independent of SEO and Python. */
export function registerRuntimeHealth(app: Express, ready: () => boolean): void {
  app.get("/healthz", (_req, res) => {
    res.set("Cache-Control", "no-store").json({ status: "ok" });
  });
  app.get("/readyz", (_req, res) => {
    const available = ready();
    res.set("Cache-Control", "no-store").status(available ? 200 : 503)
      .json({ status: available ? "ready" : "starting" });
  });
}

/** Observe fatal errors, never swallow them or keep a damaged process alive. */
export function installRuntimeDiagnostics(runtime = process, logger = console): () => void {
  const fatal = (error: Error, origin: string) => {
    const message = error.message.split("\n")[0]
      .replace(/(postgres(?:ql)?:\/\/)[^@\s]+@/gi, "$1[redacted]@")
      .replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 500);
    logger.error("[runtime] fatal", {
      origin, name: error.name, message,
      frames: (error.stack || "").split("\n").filter(line => /^\s+at /.test(line)).slice(0, 12),
    });
  };
  const exit = (code: number) => logger.info("[runtime] exit", {
    code, pid: runtime.pid, uptimeSeconds: Math.round(runtime.uptime()),
  });
  runtime.on("uncaughtExceptionMonitor", fatal);
  runtime.on("exit", exit);
  return () => {
    runtime.removeListener("uncaughtExceptionMonitor", fatal);
    runtime.removeListener("exit", exit);
  };
}

/** Optional housekeeping cannot delay the listener or reject out of a timer. */
export async function runOptionalStartupTasks(
  tasks: { name: string; run: () => Promise<unknown> }[], logger = console,
): Promise<void> {
  for (const task of tasks) {
    try { await task.run(); }
    catch (error) {
      logger.error("[startup] optional task failed", {
        task: task.name, error: error instanceof Error ? error.message : "unknown",
      });
    }
  }
}

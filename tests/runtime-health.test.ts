import express from "express";
import request from "supertest";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { installRuntimeDiagnostics, registerRuntimeHealth, runOptionalStartupTasks } from "../server/runtime-health";

describe("Independent runtime health and startup", () => {
  it("keeps lightweight health independent of homepage failures and reports readiness accurately", async () => {
    const app = express();
    let ready = false;
    registerRuntimeHealth(app, () => ready);
    app.get("/", (_req, res) => res.sendStatus(500));
    expect((await request(app).get("/")).status).toBe(500);
    const health = await request(app).get("/healthz");
    expect(health.status).toBe(200);
    expect(health.headers["cache-control"]).toBe("no-store");
    expect((await request(app).get("/readyz")).status).toBe(503);
    ready = true;
    const readiness = await request(app).get("/readyz");
    expect(readiness.status).toBe(200);
    expect(readiness.body).toEqual({ status: "ready" });
  });

  it("does not block HTTP responses on an unresolved optional database task", async () => {
    let release!: () => void;
    const background = runOptionalStartupTasks([{
      name: "database-maintenance", run: () => new Promise<void>(resolve => { release = resolve; }),
    }]);
    const app = express();
    registerRuntimeHealth(app, () => true);
    try {
      expect((await request(app).get("/readyz")).status).toBe(200);
    } finally { release(); await background; }
  });

  it("contains a rejected optional task and still runs subsequent tasks", async () => {
    const logger = { error: vi.fn() } as any;
    const next = vi.fn().mockResolvedValue(undefined);
    await expect(runOptionalStartupTasks([
      { name: "database", run: vi.fn().mockRejectedValue(new Error("Authentication timed out")) },
      { name: "next", run: next },
    ], logger)).resolves.toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledWith("[startup] optional task failed", {
      task: "database", error: "Authentication timed out",
    });
  });

  it("records the fatal origin and exit without swallowing exceptions or rejections", () => {
    const runtime = Object.assign(new EventEmitter(), { pid: 123, uptime: () => 7.2 });
    const logger = { error: vi.fn(), info: vi.fn() } as any;
    const cleanup = installRuntimeDiagnostics(runtime as any, logger);
    const failure = new Error("connection lost");
    runtime.emit("uncaughtExceptionMonitor", failure, "unhandledRejection");
    runtime.emit("exit", 1);
    expect(logger.error).toHaveBeenCalledWith("[runtime] fatal", expect.objectContaining({
      origin: "unhandledRejection", message: "connection lost", frames: expect.any(Array),
    }));
    expect(logger.info).toHaveBeenCalledWith("[runtime] exit", { code: 1, pid: 123, uptimeSeconds: 7 });
    expect(runtime.listenerCount("uncaughtException")).toBe(0);
    expect(runtime.listenerCount("unhandledRejection")).toBe(0);
    cleanup();
    expect(runtime.listenerCount("uncaughtExceptionMonitor")).toBe(0);
    expect(runtime.listenerCount("exit")).toBe(0);
  });

  it("redacts credential-bearing URLs and bearer tokens from fatal diagnostics", () => {
    const runtime = Object.assign(new EventEmitter(), { pid: 1, uptime: () => 1 });
    const logger = { error: vi.fn(), info: vi.fn() } as any;
    const cleanup = installRuntimeDiagnostics(runtime as any, logger);
    runtime.emit("uncaughtExceptionMonitor",
      new Error("postgresql://user:test-only@db.invalid/example Bearer test-token"), "uncaughtException");
    const output = JSON.stringify(logger.error.mock.calls);
    expect(output).not.toContain("test-only");
    expect(output).not.toContain("test-token");
    expect(output).toContain("[redacted]");
    cleanup();
  });
});

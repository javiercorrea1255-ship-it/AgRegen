import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(), healthy: false, children: [] as any[],
  signals: new Map<string, (...args: any[]) => void>(),
}));
vi.mock("child_process", () => ({ spawn: mocks.spawn }));
vi.mock("fs", () => ({ existsSync: (path: string) => path.endsWith("main.py") }));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubEnv("GEO_SERVICE_URL", "");
  mocks.healthy = false;
  mocks.children = [];
  mocks.signals.clear();
  mocks.spawn.mockReset().mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(), stderr: new EventEmitter(), killed: false,
      kill: vi.fn().mockReturnValue(true),
    });
    mocks.children.push(child);
    mocks.healthy = true;
    return child;
  });
  vi.stubGlobal("fetch", vi.fn(async () => {
    if (!mocks.healthy) throw new Error("ECONNREFUSED");
    return new Response(JSON.stringify({ status: "ok", version: "3.1.1" }));
  }));
  // Do not install real process shutdown listeners from this isolated test.
  const originalOnce = process.once.bind(process);
  vi.spyOn(process, "once").mockImplementation(((event: string, listener: (...args: any[]) => void) => {
    if (event === "SIGINT" || event === "SIGTERM") {
      mocks.signals.set(event, listener); return process;
    }
    return originalOnce(event, listener);
  }) as any);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Idempotent local geo-service supervisor", () => {
  it("reuses a healthy listener on port 8000 instead of spawning a conflicting copy", async () => {
    mocks.healthy = true;
    const { spawnGeoServiceSidecar } = await import("../server/spawn-geo-service");
    await spawnGeoServiceSidecar();
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it("deduplicates simultaneous startup requests", async () => {
    const { spawnGeoServiceSidecar } = await import("../server/spawn-geo-service");
    await Promise.all([spawnGeoServiceSidecar(), spawnGeoServiceSidecar()]);
    expect(mocks.spawn).toHaveBeenCalledOnce();
  });

  it("recovers if a reused listener disappears, without killing the other process", async () => {
    mocks.healthy = true;
    const { spawnGeoServiceSidecar } = await import("../server/spawn-geo-service");
    await spawnGeoServiceSidecar();
    mocks.healthy = false;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.spawn).toHaveBeenCalledOnce();
    expect(mocks.children[0].kill).not.toHaveBeenCalled();
  });

  it("checks health again after a child exits, avoiding repeated port-in-use crashes", async () => {
    const { spawnGeoServiceSidecar } = await import("../server/spawn-geo-service");
    await spawnGeoServiceSidecar();
    // Another healthy process acquired the port between the check and bind.
    mocks.children[0].emit("exit", 1, null);
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.spawn).toHaveBeenCalledOnce();
  });

  it("recovers once from a spawn error even if exit is also emitted", async () => {
    const { spawnGeoServiceSidecar } = await import("../server/spawn-geo-service");
    await spawnGeoServiceSidecar();
    mocks.healthy = false;
    mocks.children[0].emit("error", new Error("spawn failed"));
    mocks.children[0].emit("exit", 1, null);
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.spawn).toHaveBeenCalledTimes(2);
  });

  it("does not start a local process when an external geo-service is configured", async () => {
    vi.stubEnv("GEO_SERVICE_URL", "https://geo.example.invalid");
    const { spawnGeoServiceSidecar } = await import("../server/spawn-geo-service");
    await spawnGeoServiceSidecar();
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("respects the restart budget even when the health watcher is running", async () => {
    const { spawnGeoServiceSidecar } = await import("../server/spawn-geo-service");
    await spawnGeoServiceSidecar();
    for (let attempt = 1; attempt <= 5; attempt++) {
      mocks.healthy = false;
      mocks.children[mocks.children.length - 1].emit("exit", 1, null);
      await vi.advanceTimersByTimeAsync(attempt * 1000);
    }
    expect(mocks.spawn).toHaveBeenCalledTimes(6);
    mocks.healthy = false;
    mocks.children[mocks.children.length - 1].emit("exit", 1, null);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(mocks.spawn).toHaveBeenCalledTimes(6);
    await vi.advanceTimersByTimeAsync(35_000);
    expect(mocks.spawn).toHaveBeenCalledTimes(7);
  });

  it("stops recovery on shutdown and only signals its own child", async () => {
    const { spawnGeoServiceSidecar } = await import("../server/spawn-geo-service");
    await spawnGeoServiceSidecar();
    mocks.signals.get("SIGTERM")!();
    expect(mocks.children[0].kill).toHaveBeenCalledWith("SIGTERM");
    mocks.children[0].emit("exit", 0, "SIGTERM");
    mocks.healthy = false;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.spawn).toHaveBeenCalledOnce();
  });
});

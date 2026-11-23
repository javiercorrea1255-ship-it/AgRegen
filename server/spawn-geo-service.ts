import { spawn, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

const HOST = "127.0.0.1";
const PORT = 8000;
const HEALTH_URL = `http://${HOST}:${PORT}/health`;

let child: ChildProcess | null = null;
let restartCount = 0;
const MAX_RESTARTS = 5;
const RESTART_WINDOW_MS = 60_000;
let restartWindowStart = Date.now();
let shuttingDown = false;
let signalsHooked = false;
let starting: Promise<void> | null = null;
let healthWatch: ReturnType<typeof setInterval> | null = null;

async function localServiceHealthy(): Promise<boolean> {
  try {
    const response = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(1000) });
    if (!response.ok) return false;
    const data = await response.json();
    return data?.status === "ok" && typeof data?.version === "string";
  } catch { return false; }
}

function watchLocalService(): void {
  if (healthWatch) return;
  // A reused listener is not our child. Never kill it; recover if it disappears.
  healthWatch = setInterval(() => {
    if (!shuttingDown && !child) void startChild().catch(error => {
      console.error("[geo-service] recovery failed:", error instanceof Error ? error.message : "unknown");
    });
  }, 10_000);
  healthWatch.unref();
}

function findPython(): string {
  const candidates = [
    join(process.cwd(), ".pythonlibs/bin/python3"),
    join(process.cwd(), ".pythonlibs/bin/python"),
    "/home/runner/workspace/.pythonlibs/bin/python3",
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return "python3";
}

function hookShutdownSignalsOnce() {
  if (signalsHooked) return;
  signalsHooked = true;
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.once(sig, () => {
      shuttingDown = true;
      if (healthWatch) clearInterval(healthWatch);
      if (child && !child.killed) {
        console.log(`[geo-service] forwarding ${sig} to child`);
        try { child.kill(sig); } catch { /* ignore */ }
      }
    });
  }
}

function spawnChild(): void {
  if (shuttingDown) return;
  if (child) return;

  const python = findPython();
  const cwd = join(process.cwd(), "geo-service");
  if (!existsSync(join(cwd, "main.py"))) {
    console.warn(`[geo-service] geo-service/main.py not found at ${cwd}; sidecar disabled`);
    return;
  }

  console.log(`[geo-service] spawning ${python} -m uvicorn main:app --host ${HOST} --port ${PORT} (cwd=${cwd})`);
  const ownedChild = spawn(python, ["-m", "uvicorn", "main:app", "--host", HOST, "--port", String(PORT), "--no-access-log"], {
    cwd,
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child = ownedChild;

  child.stdout?.on("data", (b) => process.stdout.write(`[geo-service] ${b}`));
  child.stderr?.on("data", (b) => process.stderr.write(`[geo-service] ${b}`));

  let ended = false;
  const exited = (code: number | null, signal: NodeJS.Signals | null) => {
    if (ended) return;
    ended = true;
    console.warn(`[geo-service] exited (code=${code} signal=${signal})`);
    if (child === ownedChild) child = null;
    if (shuttingDown) return;
    const now = Date.now();
    if (now - restartWindowStart > RESTART_WINDOW_MS) {
      restartWindowStart = now;
      restartCount = 0;
    }
    restartCount++;
    if (restartCount > MAX_RESTARTS) {
      console.error(`[geo-service] exceeded ${MAX_RESTARTS} restarts in ${RESTART_WINDOW_MS}ms; giving up`);
      return;
    }
    const delay = Math.min(1000 * restartCount, 10_000);
    console.log(`[geo-service] restarting in ${delay}ms (attempt ${restartCount}/${MAX_RESTARTS})`);
    setTimeout(() => void startChild().catch(error => {
      console.error("[geo-service] restart unavailable:", error instanceof Error ? error.message : "unknown");
    }), delay).unref();
  };
  child.on("exit", exited);

  child.on("error", (err) => {
    console.error(`[geo-service] spawn error:`, err);
    exited(null, null);
  });
}

async function startChild(): Promise<void> {
  if (starting) return starting;
  starting = (async () => {
    if (shuttingDown || child) return;
    if (await localServiceHealthy()) {
      console.log("[geo-service] reusing healthy local listener; no duplicate sidecar spawned");
      return;
    }
    if (Date.now() - restartWindowStart > RESTART_WINDOW_MS) {
      restartWindowStart = Date.now();
      restartCount = 0;
    }
    if (restartCount > MAX_RESTARTS) return;
    if (!shuttingDown) spawnChild();
  })();
  try { await starting; }
  finally { starting = null; }
}

/**
 * Spawn the Python geo-service sidecar (production only) and return a promise
 * that resolves when /health responds 200. The promise resolves (without
 * throwing) even on timeout so the Node server can still come up — late
 * requests will just see 502s until the child is ready.
 */
export async function spawnGeoServiceSidecar(opts: { readinessTimeoutMs?: number } = {}): Promise<void> {
  const url = process.env.GEO_SERVICE_URL;
  if (url && !/(?:localhost|127\.0\.0\.1|::1)/.test(url)) {
    console.log(`[geo-service] external GEO_SERVICE_URL set (${url}); not spawning sidecar`);
    return;
  }
  hookShutdownSignalsOnce();
  await startChild();
  watchLocalService();

  const timeoutMs = opts.readinessTimeoutMs ?? 30_000;
  const deadline = Date.now() + timeoutMs;
  const startedAt = Date.now();
  while (Date.now() < deadline) {
    try {
      if (await localServiceHealthy()) {
        console.log(`[geo-service] ready after ${Date.now() - startedAt}ms`);
        return;
      }
    } catch {
      /* not up yet */
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  console.warn(`[geo-service] not ready after ${timeoutMs}ms; continuing startup anyway`);
}

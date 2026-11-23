import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { ensureAdminUser } from "./ensure-admin";
import { syncConferences } from "./sync-conferences";
import { seedMexicoSoil } from "./seed-mexico-soil";
import { spawnGeoServiceSidecar } from "./spawn-geo-service";
import { apiLimiter } from "./rate-limit";
import { installRuntimeDiagnostics, registerRuntimeHealth, runOptionalStartupTasks } from "./runtime-health";

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
const httpServer = createServer(app);
let webReady = false;
installRuntimeDiagnostics();
registerRuntimeHealth(app, () => webReady);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: "6mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

app.use("/api", apiLimiter);

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Preserve privileged-account initialization before accepting sign-ups.
  await ensureAdminUser();
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // Any /api/* path that wasn't handled by a registered route should return
  // 404 JSON — never fall through to the SPA catch-all and return HTML.
  app.use("/api", (_req: Request, res: Response) => {
    res.status(404).json({ message: "Not found" });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      webReady = true;
      log(`serving on port ${port}`);
      // No database housekeeping or Python warm-up on the HTTP critical path.
      // A failed optional dependency must not turn the public site into a 500.
      void runOptionalStartupTasks([
        { name: "sync-conferences", run: syncConferences },
        { name: "soil-catalogue", run: seedMexicoSoil },
      ]);
      if (process.env.NODE_ENV === "production") {
        void spawnGeoServiceSidecar().catch(error => {
          console.error("[geo-service] startup unavailable:", error instanceof Error ? error.message : "unknown");
        });
      }
    },
  );
})();

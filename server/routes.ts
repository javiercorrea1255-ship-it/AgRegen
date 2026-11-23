import type { Express } from "express";
import expressApp from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { saveSoilBiologyRecord } from "./services/soil-biology-records";
import { hasSoilBiologyIndicator } from "@shared/soil-biology-input";
import { generateGrid as generateGridFallback } from "./grid-utils";
import session from "express-session";
import ConnectPgSimple from "connect-pg-simple";
import pkg from "pg";
const { Pool } = pkg;
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import bcrypt from "bcryptjs";
import multer from "multer";
import path from "path";
import fs from "fs";
import { insertUserSchema, insertParcelSchema, insertParcelDataSchema, insertAlertSchema, insertSoilAnalysisSchema, insertWaterAnalysisSchema, insertProductionCostSchema, insertCommunityPostSchema, insertCommunityCommentSchema, insertConferenceSchema, insertForumThreadSchema, insertForumReplySchema, insertNutritionProgramSchema, insertNutritionProgramProductSchema, insertSoilBiologySchema, insertCropCycleDetailSchema, insertPhenologyPromptSchema, insertParcelStageObservationSchema } from "@shared/schema";
import type { User, SamplingCampaignStatus, InsertNutritionProgramProduct, InsertParcelData, ParcelData } from "@shared/schema";
import { computeSampleSize } from "@shared/sample-size";
import { isValidPolygon, isSimplePolygon, pointInPolygon as pipLatLng, detectInvertedOrientation, type LatLng } from "@shared/polygon-utils";
import { registerSatelliteZoneRoutes } from "./routes/satellite-zones";
import { registerDroneZoneRoutes } from "./routes/drone-zones";
import { registerImportZoneRoutes } from "./routes/import-zones";
import { registerWhatsappRoutes } from "./routes/whatsapp";
import { registerFieldLogRoutes } from "./routes/field-logs";
import { projectParcelCosts, summarizeParcelEconomy, producerPriceHistory, previousHarvests } from "./services/parcel-economy";
import { getParcelClimatology } from "./services/parcel-climatology";
import { distinctSoilAnalyses, microbiologyEvidence, latestLabMicrobiology, nutritionResponseSafety } from "@shared/agronomic-evidence";
import { persistWebFieldLog } from "./services/web-field-log";
import type { FieldLogTurn } from "./services/field-log-turn";
import { registerSoilHealthRoutes } from "./routes/soil-health";
import { soilHealthRepository } from "./services/soil-health-repository";
import { startSoilHealthCleanup } from "./services/soil-health-cleanup";
import { authLimiter } from "./rate-limit";
import { getMarketPrices, getMarketPriceFlat, SUPPORTED_SNIIM_CROPS, getExchangeRate, getSniimPrice } from "./services/market-prices";
import { getInternationalPrices, INTERNATIONAL_CROPS } from "./services/international-prices";
import { getSIAPYieldBenchmark, inferStateFromText } from "./services/siap";
import { getFAOFertilizerPrices } from "./services/fao-fertilizer";
import { getVCMPrice } from "./services/carbon-market";
import { z as zSampling } from "zod";

// ── Whitelist of fields a client may PATCH on a sampling point. ──────────────
// Planned coordinates (latPlanned/lonPlanned) are intentionally NOT here:
// they belong to the sampling design and are edited only via the dedicated
// /planned-coords endpoint. Other write-protected fields (id, campaignId,
// pointIndex, createdAt, etc.) are also excluded. Unknown keys are dropped.
const samplingPointPatchSchema = zSampling.object({
  latActual: zSampling.coerce.number().min(-90).max(90).nullable().optional(),
  lonActual: zSampling.coerce.number().min(-180).max(180).nullable().optional(),
  value: zSampling.coerce.number().nullable().optional(),
  temperatureC: zSampling.coerce.number().nullable().optional(),
  nSubsamples: zSampling.coerce.number().int().min(1).max(20).nullable().optional(),
  soilCondition: zSampling.string().max(60).nullable().optional(),
  notes: zSampling.string().max(1000).nullable().optional(),
  photoUrl: zSampling.string().max(500).nullable().optional(),
  capturedAt: zSampling.coerce.date().nullable().optional(),
}).strict();
type SamplingPointPatch = zSampling.infer<typeof samplingPointPatchSchema>;
type ParsePatchResult =
  | { ok: true; data: SamplingPointPatch }
  | { ok: false; message: string };
function parseSamplingPointPatch(body: unknown): ParsePatchResult {
  // .strip() drops unknown keys silently so old clients sending extra fields
  // don't 400 — but typed/known fields are validated and surface real errors.
  const result = samplingPointPatchSchema.strip().safeParse(body ?? {});
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, message: fromZodError(result.error).message };
}

// Zod schema for one sampling point in a bulk insert.
const bulkSamplingPointSchema = zSampling.object({
  pointIndex: zSampling.coerce.number().int().min(0).optional(),
  latPlanned: zSampling.coerce.number().min(-90).max(90),
  lonPlanned: zSampling.coerce.number().min(-180).max(180),
  latActual: zSampling.coerce.number().min(-90).max(90).optional().nullable(),
  lonActual: zSampling.coerce.number().min(-180).max(180).optional().nullable(),
  value: zSampling.coerce.number().optional().nullable(),
  notes: zSampling.string().max(1000).optional().nullable(),
  nSubsamples: zSampling.coerce.number().int().min(1).max(20).optional().nullable(),
  soilCondition: zSampling.string().max(60).optional().nullable(),
  temperatureC: zSampling.coerce.number().optional().nullable(),
});
import { fromZodError } from "zod-validation-error";
import { 
  initializeEarthEngine, 
  isGEEAvailable, 
  getGEEStatus,
  getVegetationIndices,
  getLatestNDVIStats,
  getNDVIMapTiles,
  getIndexMapTiles,
  getChangeMapTiles,
  getAvailableSentinelImages,
  getIndexRaster,
  getDEMMapTiles,
} from "./services/earth-engine";
import { getFullWeatherData, getWeatherForecast } from "./services/weather";
import { calculateRegenerativeMetrics } from "./services/regenerative-metrics";
import { generateAlerts, generateRecommendedActions } from "./services/alerts-engine";
import { generateAIResponse, generateAgenticResponse, generateDiagnosisResponse, generateMemorySummary, generateProactiveAlert, extractProblemType, checkProviderAvailability, generatePrescriptions, generateSamplingInstructions, generateZonePrescription, interpretInterpolationMap, generateManagementReport, generatePeerAdvisorResponse, type ParcelContext, type ChatHistory, type ReasoningStep } from "./services/ai-assistant";
import type { PeerMatch } from "./storage";
import type { AIProvider } from "@shared/schema";
import { registerObjectStorageRoutes, ObjectStorageService, objectStorageClient } from "./replit_integrations/object_storage";

const objectStorageService = new ObjectStorageService();

async function uploadToPublicStorage(
  buffer: Buffer,
  contentType: string,
  subPath: string,
): Promise<string> {
  const publicPaths = (process.env.PUBLIC_OBJECT_SEARCH_PATHS || "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!publicPaths.length) {
    throw new Error("PUBLIC_OBJECT_SEARCH_PATHS not configured");
  }
  const basePath = publicPaths[0];
  const normalized = basePath.startsWith("/") ? basePath : `/${basePath}`;
  const parts = normalized.split("/").filter(Boolean);
  const bucketName = parts[0];
  const prefix = parts.slice(1).join("/");
  const objectName = prefix ? `${prefix}/${subPath}` : subPath;
  const file = objectStorageClient.bucket(bucketName).file(objectName);
  await file.save(buffer, { contentType });
  return `/api/media/public/${subPath}`;
}

async function verifyRecaptcha(token: string | undefined, action: string): Promise<boolean> {
  const secretKey = process.env.RECAPTCHA_SECRET_KEY;
  if (!secretKey) return true;
  if (!token) {
    console.warn("reCAPTCHA token not provided, allowing request (graceful degradation)");
    return true;
  }

  try {
    const response = await fetch("https://www.google.com/recaptcha/api/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `secret=${encodeURIComponent(secretKey)}&response=${encodeURIComponent(token)}`,
    });

    const data = await response.json();
    if (!data.success) {
      console.warn("reCAPTCHA verification failed:", data["error-codes"]);
      return true;
    }
    if (data.score !== undefined && data.score < 0.3) {
      console.warn(`reCAPTCHA low score: ${data.score} for action ${action}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error("reCAPTCHA verification error:", error);
    return true;
  }
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL!,
});

// node-postgres emits idle-client failures on the Pool itself. Without an
// error listener, EventEmitter treats them as uncaught and terminates Node.
pool.on("error", (error) => {
  console.error("[session pg pool] idle client error:", error.message);
});

const PgSession = ConnectPgSimple(session);

// Configure Passport Local Strategy
passport.use(
  new LocalStrategy(
    {
      usernameField: "email",
      passwordField: "password",
    },
    async (email, password, done) => {
      try {
        const user = await storage.getUserByEmail(email);
        if (!user) {
          return done(null, false, { message: "Email o contraseña incorrecta" });
        }

        const isValid = await bcrypt.compare(password, user.passwordHash);
        if (!isValid) {
          return done(null, false, { message: "Email o contraseña incorrecta" });
        }

        // Check if user is active
        if (!user.isActive) {
          return done(null, false, { message: "Cuenta desactivada - contacta al administrador" });
        }

        return done(null, user);
      } catch (error) {
        return done(error);
      }
    }
  )
);

passport.serializeUser((user: Express.User, done) => {
  done(null, (user as User).id);
});

passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await storage.getUser(id);
    done(null, user);
  } catch (error) {
    done(error);
  }
});

// Middleware to check if user is authenticated
function isAuthenticated(req: any, res: any, next: any) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ message: "No autenticado" });
}

// Middleware to check if user is admin
function isAdmin(req: any, res: any, next: any) {
  if (req.isAuthenticated() && req.user?.role === "admin") {
    return next();
  }
  res.status(403).json({ message: "Acceso denegado - se requiere rol de administrador" });
}

// Middleware to check if user is active
function isActiveUser(req: any, res: any, next: any) {
  if (req.isAuthenticated() && req.user?.isActive) {
    return next();
  }
  res.status(403).json({ message: "Cuenta desactivada - contacta al administrador" });
}

/**
 * Wrapper around `fetch` that aborts after `timeoutMs` milliseconds.
 * Used for all calls to the Python geo-service so a hung Kriging optimizer
 * cannot block an Express worker indefinitely.
 * Throws with `name === "AbortError"` on timeout.
 */
const GEO_TIMEOUT_MS = 120_000;
async function fetchWithTimeout(
  url: string,
  opts: RequestInit = {},
  timeoutMs = GEO_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── Module-level helper: auto-generate phenology prompts ───────────────────────
// cycleDurationDays: when provided, stage dates are scaled proportionally so
// the full curve fits the producer's variety-specific cycle length.
async function autoGeneratePhenologyPrompts(
  storage: import("./storage").IStorage,
  parcelId: string,
  crop: string,
  plantingDate: Date,
  cycleDurationDays?: number | null
): Promise<void> {
  const STAGE_PROMPTS: Record<string, string> = {
    "Germinación": "Registra la densidad de plantas emergidas y uniformidad de germinación",
    "Crecimiento Vegetativo": "Evalúa la cobertura vegetal y toma un análisis foliar si es posible",
    "Macollaje": "Cuenta los macollos por planta y evalúa el estado nutricional",
    "Encañado": "Registra altura de plantas y observa síntomas de enfermedades foliares",
    "Floración": "Registra el porcentaje de floración y condiciones climáticas del período crítico",
    "Espigado": "Evalúa el espigado y registra cualquier incidencia de fusarium u hongos",
    "Llenado de Grano": "Mide el contenido de humedad en grano y evalúa el llenado",
    "Madurez": "Registra la fecha de madurez fisiológica y planifica la cosecha",
    "Máximo Desarrollo": "Registra NDVI máximo e índice de área foliar",
    "Senescencia": "Evalúa el secado natural y estima la fecha de cosecha",
    "Crecimiento": "Registra altura de planta e índice de cobertura vegetal",
  };
  // Base curves with canonical stage days (reference duration = last stage's startDay).
  const CURVES: Record<string, { name: string; startDay: number }[]> = {
    soja:    [{ name:"Germinación",startDay:0},{ name:"Crecimiento Vegetativo",startDay:15},{ name:"Floración",startDay:45},{ name:"Llenado de Grano",startDay:70},{ name:"Madurez",startDay:100}],
    maiz:    [{ name:"Germinación",startDay:0},{ name:"Crecimiento Vegetativo",startDay:12},{ name:"Floración",startDay:50},{ name:"Llenado de Grano",startDay:75},{ name:"Madurez",startDay:115}],
    trigo:   [{ name:"Germinación",startDay:0},{ name:"Macollaje",startDay:20},{ name:"Encañado",startDay:60},{ name:"Espigado",startDay:90},{ name:"Llenado de Grano",startDay:110},{ name:"Madurez",startDay:135}],
    girasol: [{ name:"Germinación",startDay:0},{ name:"Crecimiento Vegetativo",startDay:15},{ name:"Floración",startDay:55},{ name:"Llenado de Grano",startDay:80},{ name:"Madurez",startDay:110}],
  };
  const DEFAULT_CURVE = [{ name:"Germinación",startDay:0},{ name:"Crecimiento",startDay:15},{ name:"Máximo Desarrollo",startDay:50},{ name:"Senescencia",startDay:80},{ name:"Madurez",startDay:120}];
  const accentMap: Record<string,string> = {á:"a",é:"e",í:"i",ó:"o",ú:"u"};
  const normalized = crop.toLowerCase().replace(/[áéíóú]/g, c => accentMap[c] || c);
  const baseCurve = Object.entries(CURVES).find(([k]) => normalized.includes(k))?.[1] || DEFAULT_CURVE;

  // Scale stage days proportionally to the producer's variety-specific cycle duration.
  // baseDuration = last stage's startDay (the canonical total cycle length for this crop).
  const baseDuration = baseCurve[baseCurve.length - 1].startDay;
  const scale = (cycleDurationDays && cycleDurationDays > 0 && baseDuration > 0)
    ? cycleDurationDays / baseDuration
    : 1;
  const curve = baseCurve.map(s => ({
    ...s,
    startDay: s.startDay === 0 ? 0 : Math.round(s.startDay * scale),
  }));

  const existing = await storage.getPhenologyPrompts(parcelId);
  const existingByStage = new Map((existing || []).map((p: any) => [p.stage, p]));

  for (const stage of curve) {
    const dueDate = new Date(plantingDate.getTime() + stage.startDay * 86400_000);
    const existingPrompt = existingByStage.get(stage.name);
    if (existingPrompt) {
      // Update dueDate for incomplete prompts so duration changes are reflected immediately.
      if (!existingPrompt.isCompleted) {
        await storage.updatePhenologyPromptDueDate(existingPrompt.id, dueDate);
      }
    } else {
      await storage.createPhenologyPrompt({
        parcelId,
        stage: stage.name,
        promptText: STAGE_PROMPTS[stage.name] || `Registra observaciones para la etapa ${stage.name}`,
        dueDate,
        isCompleted: false,
      });
    }
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // ─── SEO routes (robots.txt + sitemap.xml) ────────────────────────────────
  const { registerSitemapRoutes } = await import("./seo/sitemap");
  registerSitemapRoutes(app);

  // ─── Route path aliases (task-spec-compliant short paths) ─────────────────
  // Regex sub-path aliases are checked first (more specific), then prefix aliases.
  app.use((req, _res, next) => {
    // Regex aliases — must run before prefix aliases
    const regexAliases: [RegExp, string][] = [
      // POST /api/interpolations/:id/prescribe-all → prescribe
      [/^(\/api\/interpolations\/[^/?]+)\/prescribe-all(\?.*)?$/, "$1/prescribe$2"],
      // /api/parcels/:id/campaigns → /api/parcels/:id/sampling-campaigns
      [/^(\/api\/parcels\/[^/?]+)\/campaigns(\/[^?]*)?(\?.*)?$/, "$1/sampling-campaigns$2$3"],
    ];
    for (const [regex, replacement] of regexAliases) {
      if (regex.test(req.url)) {
        req.url = req.url.replace(regex, replacement);
        break;
      }
    }

    // Prefix aliases — applied after regex aliases
    const prefixAliases: [string, string][] = [
      ["/api/variables", "/api/master-variables"],
      ["/api/campaigns", "/api/sampling-campaigns"],
      ["/api/points", "/api/sampling-points"],
      ["/api/zones", "/api/management-zones"],
    ];
    const urlPath = req.url.split("?")[0];
    for (const [from, to] of prefixAliases) {
      if (urlPath === from || urlPath.startsWith(from + "/")) {
        req.url = to + req.url.slice(from.length);
        break;
      }
    }

    next();
  });

  // Session configuration
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret && process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET environment variable is required in production");
  }
  
  app.use(
    session({
      store: new PgSession({
        pool,
        tableName: "session",
        createTableIfMissing: true,
      }),
      secret: sessionSecret || "dev-only-secret-change-in-production",
      resave: false,
      saveUninitialized: false,
      cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
      },
    })
  );

  app.use(passport.initialize());
  app.use(passport.session());

  // ============ File Upload & Static Serving ============
  // Files are stored in Object Storage (GCS) — no local disk needed.
  // The /uploads static middleware is kept only for backward-compat with
  // old DB rows that still hold /uploads/... URLs; missing files return 404.
  const uploadsDir = path.join(process.cwd(), "uploads");
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  app.use("/uploads", expressApp.static(uploadsDir));

  // Proxy route for public Object Storage files (GCS bucket has UBLA — no direct public GCS URLs).
  // Files uploaded via uploadToPublicStorage() are stored under the PUBLIC_OBJECT_SEARCH_PATHS
  // prefix and served here without authentication, with long-lived cache headers.
  app.use("/api/media/public", async (req: any, res) => {
    try {
      const subPath = req.path.replace(/^\/+/, "");
      const publicPaths = (process.env.PUBLIC_OBJECT_SEARCH_PATHS || "")
        .split(",").map((p: string) => p.trim()).filter(Boolean);
      if (!publicPaths.length) return res.status(404).send("Not found");
      const basePath = publicPaths[0];
      const normalized = basePath.startsWith("/") ? basePath : `/${basePath}`;
      const parts = normalized.split("/").filter(Boolean);
      const bucketName = parts[0];
      const prefix = parts.slice(1).join("/");
      const objectName = prefix ? `${prefix}/${subPath}` : subPath;
      const file = objectStorageClient.bucket(bucketName).file(objectName);
      const [exists] = await file.exists();
      if (!exists) return res.status(404).send("Not found");
      const [metadata] = await file.getMetadata();
      res.set({
        "Content-Type": (metadata.contentType as string) || "application/octet-stream",
        "Cache-Control": "public, max-age=31536000, immutable",
      });
      file.createReadStream().on("error", (err: Error) => {
        console.error("[media/public] stream error:", err);
        if (!res.headersSent) res.status(500).send("Error");
      }).pipe(res);
    } catch (err) {
      console.error("[media/public] error:", err);
      if (!res.headersSent) res.status(500).send("Error");
    }
  });

  const communityUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const allowed = /\.(jpg|jpeg|png|gif|webp|mp4|webm|mov)$/i;
      if (allowed.test(path.extname(file.originalname))) {
        cb(null, true);
      } else {
        cb(new Error("Invalid file type"));
      }
    },
  });

  const avatarUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const allowed = /\.(jpg|jpeg|png|gif|webp)$/i;
      if (allowed.test(path.extname(file.originalname))) {
        cb(null, true);
      } else {
        cb(new Error("Solo imágenes (jpg, png, gif, webp)"));
      }
    },
  });

  registerObjectStorageRoutes(app);

  // Utility: fetch Open Graph image from a URL (for Facebook/external video pages)
  async function fetchOgImage(pageUrl: string): Promise<string | null> {
    try {
      const allowed = ["facebook.com", "fb.com", "fb.watch"];
      const host = new URL(pageUrl).hostname.replace(/^www\./, "");
      if (!allowed.some(d => host === d || host.endsWith("." + d))) return null;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const response = await fetch(pageUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; facebookexternalhit/1.1; +http://www.facebook.com/externalhit_uatext.php)",
          "Accept": "text/html,application/xhtml+xml",
          "Accept-Language": "es,en;q=0.9",
        },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!response.ok) return null;
      const html = await response.text();
      const match =
        html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
        html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
      const imageUrl = match ? match[1].replace(/&amp;/g, "&") : null;
      return imageUrl || null;
    } catch {
      return null;
    }
  }

  // Admin: fetch OG thumbnail for a video URL (used by the admin form)
  app.post("/api/conferences/fetch-og-image", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const { videoUrl } = req.body;
      if (!videoUrl || typeof videoUrl !== "string") {
        return res.status(400).json({ message: "videoUrl requerido" });
      }
      const imageUrl = await fetchOgImage(videoUrl);
      if (!imageUrl) {
        return res.status(404).json({ message: "No se encontró imagen OG para esta URL" });
      }
      res.json({ imageUrl });
    } catch (error) {
      console.error("Error fetching OG image:", error);
      res.status(500).json({ message: "Error al obtener miniatura" });
    }
  });

  app.post("/api/uploads/conference-thumbnail", isAuthenticated, async (req: any, res) => {
    try {
      if (req.user.role !== "admin") {
        return res.status(403).json({ message: "Solo administradores pueden subir miniaturas" });
      }
      const { name, size, contentType } = req.body;
      if (!name || !contentType) {
        return res.status(400).json({ message: "name y contentType son requeridos" });
      }
      const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
      if (!allowedTypes.includes(contentType)) {
        return res.status(400).json({ message: "Tipo de archivo no permitido. Use JPG, PNG, GIF o WebP" });
      }
      if (size && size > 5 * 1024 * 1024) {
        return res.status(400).json({ message: "El archivo no debe superar 5MB" });
      }
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
      res.json({ uploadURL, objectPath });
    } catch (error) {
      console.error("Error generating thumbnail upload URL:", error);
      res.status(500).json({ message: "Error al generar URL de subida" });
    }
  });

  // ============ Config Routes ============
  app.get("/api/platform/stats", async (_req, res) => {
    try {
      const stats = await storage.getPlatformStats();
      res.json(stats);
    } catch (error) {
      console.error("Error getting platform stats:", error);
      res.status(500).json({ message: "Error al obtener estadísticas" });
    }
  });

  app.get("/api/config/recaptcha", (_req, res) => {
    const siteKey = process.env.RECAPTCHA_SITE_KEY || "";
    res.json({ siteKey });
  });

  // ============ Authentication Routes ============

  // Register
  app.post("/api/auth/register", async (req, res) => {
    try {
      const { recaptchaToken, ...userData } = req.body;
      const isHuman = await verifyRecaptcha(recaptchaToken, "register");
      if (!isHuman) {
        return res.status(403).json({ message: "Verificación de seguridad fallida. Intenta de nuevo." });
      }

      const result = insertUserSchema.safeParse(userData);
      
      if (!result.success) {
        return res.status(400).json({ message: fromZodError(result.error).message });
      }

      const { 
        name, email, passwordHash: password, role,
        phone, age, gender, schoolingYears, farmingExperienceYears,
        state, municipality, locality,
        producerType, hasDrones, hasIoT, techLevel,
        farmingTypes, currentPractices
      } = result.data;

      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ message: "El email ya está registrado" });
      }

      const passwordHash = await bcrypt.hash(password, 10);

      const user = await storage.createUser({
        name,
        email,
        passwordHash,
        role,
        phone,
        age,
        gender,
        schoolingYears,
        farmingExperienceYears,
        state,
        municipality,
        locality,
        producerType,
        hasDrones,
        hasIoT,
        techLevel,
        farmingTypes: farmingTypes ?? undefined,
        currentPractices: currentPractices ?? undefined,
      });

      // Log in the user
      req.login(user, (err) => {
        if (err) {
          return res.status(500).json({ message: "Error al iniciar sesión" });
        }
        
        // Return user without password
        const { passwordHash: _, ...userWithoutPassword } = user;
        res.json({ user: userWithoutPassword });
      });
    } catch (error: any) {
      console.error("Registration error:", error);
      res.status(500).json({ message: "Error al crear usuario" });
    }
  });

  // Login
  app.post("/api/auth/login", authLimiter, async (req, res, next) => {
    try {
      const { recaptchaToken } = req.body;
      const isHuman = await verifyRecaptcha(recaptchaToken, "login");
      if (!isHuman) {
        return res.status(403).json({ message: "Verificación de seguridad fallida. Intenta de nuevo." });
      }

      passport.authenticate("local", (err: any, user: User | false, info: any) => {
        if (err) {
          return res.status(500).json({ message: "Error en el servidor" });
        }
        if (!user) {
          return res.status(401).json({ message: info.message || "Credenciales inválidas" });
        }

        req.login(user, (err) => {
          if (err) {
            return res.status(500).json({ message: "Error al iniciar sesión" });
          }
          
          const { passwordHash: _, ...userWithoutPassword } = user;
          res.json({ user: userWithoutPassword });
        });
      })(req, res, next);
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ message: "Error en el servidor" });
    }
  });

  // Logout
  app.post("/api/auth/logout", (req, res) => {
    req.logout((err) => {
      if (err) {
        return res.status(500).json({ message: "Error al cerrar sesión" });
      }
      res.json({ message: "Sesión cerrada exitosamente" });
    });
  });

  // Get current user
  app.get("/api/auth/me", (req, res) => {
    if (!req.user) {
      return res.status(401).json({ message: "No autenticado" });
    }
    
    const user = req.user as User;
    const { passwordHash: _, ...userWithoutPassword } = user;
    res.json({ user: userWithoutPassword });
  });

  app.post("/api/auth/avatar", isAuthenticated, avatarUpload.single("avatar"), async (req: any, res) => {
    try {
      const user = req.user as User;
      const file = req.file;
      if (!file) {
        return res.status(400).json({ message: "No se subió ningún archivo" });
      }
      const ext = path.extname(file.originalname) || ".jpg";
      const avatarUrl = await uploadToPublicStorage(
        file.buffer,
        file.mimetype || "image/jpeg",
        `avatars/${user.id}${ext}`,
      );
      const updated = await storage.updateUserAvatar(user.id, avatarUrl);
      if (!updated) {
        return res.status(404).json({ message: "Usuario no encontrado" });
      }
      const { passwordHash: _, ...userWithoutPassword } = updated;
      res.json({ user: userWithoutPassword });
    } catch (error: any) {
      console.error("Error uploading avatar:", error);
      res.status(500).json({ message: "Error al subir la foto de perfil" });
    }
  });

  app.patch("/api/auth/tech-profile", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const user = req.user as User;
      const { producerType, hasDrones, hasIoT, techLevel } = req.body;
      const updated = await storage.updateUserTechProfile(user.id, {
        producerType, hasDrones, hasIoT, techLevel,
      });
      if (!updated) {
        return res.status(404).json({ message: "Usuario no encontrado" });
      }
      const { passwordHash: _, ...userWithoutPassword } = updated;
      res.json({ user: userWithoutPassword });
    } catch (error: any) {
      console.error("Error updating tech profile:", error);
      res.status(500).json({ message: "Error al actualizar perfil tecnológico" });
    }
  });

  // ============ Parcel Routes ============

  app.get("/api/parcels", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const user = req.user as User;
      const parcels = await storage.getParcelsByUser(user.id);
      res.json({ parcels });
    } catch (error) {
      console.error("Error fetching parcels:", error);
      res.status(500).json({ message: "Error al obtener lotes" });
    }
  });

  // Get public parcels
  app.get("/api/parcels/public", async (req, res) => {
    try {
      const parcels = await storage.getPublicParcels();
      res.json({ parcels });
    } catch (error) {
      console.error("Error fetching public parcels:", error);
      res.status(500).json({ message: "Error al obtener lotes públicos" });
    }
  });

  // Get single parcel
  app.get("/api/parcels/:id", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) {
        return res.status(404).json({ message: "Lote no encontrado" });
      }

      const user = req.user as User;
      // Check if user owns the parcel, it's public, or the user is an admin
      if (parcel.userId !== user.id && !parcel.isPublic && (user as any).role !== "admin") {
        return res.status(403).json({ message: "No tienes permiso para ver este lote" });
      }

      res.json({ parcel });
    } catch (error) {
      console.error("Error fetching parcel:", error);
      res.status(500).json({ message: "Error al obtener lote" });
    }
  });

  // Create parcel
  app.post("/api/parcels", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const user = req.user as User;
      // Omit userId from validation - it comes from the authenticated session
      const clientParcelSchema = insertParcelSchema.omit({ userId: true });
      const result = clientParcelSchema.safeParse(req.body);
      
      if (!result.success) {
        return res.status(400).json({ message: fromZodError(result.error).message });
      }

      const parcel = await storage.createParcel({
        ...result.data,
        userId: user.id,
      });

      // Auto-generate phenology prompts if crop + plantingDate are provided
      if (parcel.crop && parcel.plantingDate) {
        try {
          await autoGeneratePhenologyPrompts(storage, parcel.id, parcel.crop, new Date(parcel.plantingDate));
        } catch (e) {
          console.error("Auto-generate prompts error (non-fatal):", e);
        }
      }

      res.status(201).json({ parcel });
    } catch (error) {
      console.error("Error creating parcel:", error);
      res.status(500).json({ message: "Error al crear lote" });
    }
  });

  // Update parcel
  app.patch("/api/parcels/:id", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const user = req.user as User;
      const existingParcel = await storage.getParcel(req.params.id);
      
      if (!existingParcel) {
        return res.status(404).json({ message: "Lote no encontrado" });
      }

      if (existingParcel.userId !== user.id) {
        return res.status(403).json({ message: "No tienes permiso para modificar este lote" });
      }

      const result = insertParcelSchema.partial().safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ message: fromZodError(result.error).message });
      }

      const parcel = await storage.updateParcel(req.params.id, result.data);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada después de actualizar" });

      // Only regenerate phenology prompts when crop or plantingDate actually changed
      const cropChanged = result.data.crop !== undefined && result.data.crop !== existingParcel.crop;
      const plantingDateChanged = result.data.plantingDate !== undefined &&
        String(result.data.plantingDate) !== String(existingParcel.plantingDate);
      if ((cropChanged || plantingDateChanged) && parcel.crop && parcel.plantingDate) {
        try {
          await autoGeneratePhenologyPrompts(storage, parcel.id, parcel.crop, new Date(parcel.plantingDate));
        } catch (e) {
          console.error("Auto-generate prompts on update (non-fatal):", e);
        }
      }

      res.json({ parcel });
    } catch (error) {
      console.error("Error updating parcel:", error);
      res.status(500).json({ message: "Error al actualizar lote" });
    }
  });

  // Update parcel polygon (T251)
  const polygonCoordSchema = zSampling.tuple([
    zSampling.number().min(-90).max(90),   // lat
    zSampling.number().min(-180).max(180), // lng
  ]);
  const updatePolygonBodySchema = zSampling.object({
    coordinates: zSampling.array(polygonCoordSchema).min(3, "Se requieren al menos 3 coordenadas para definir el polígono"),
  });

  app.patch("/api/parcels/:id/polygon", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const user = req.user as User;
      const existingParcel = await storage.getParcel(req.params.id);
      if (!existingParcel) return res.status(404).json({ message: "Lote no encontrado" });
      if (existingParcel.userId !== user.id && user.role !== "admin") {
        return res.status(403).json({ message: "No tienes permiso para modificar este lote" });
      }
      const parsed = updatePolygonBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: fromZodError(parsed.error).message });
      }
      const { coordinates } = parsed.data;
      // Calculate area in hectares using the shoelace formula on a sphere
      const R = 6371000;
      let total = 0;
      for (let i = 0; i < coordinates.length; i++) {
        const j = (i + 1) % coordinates.length;
        const lat1 = (coordinates[i][0] * Math.PI) / 180;
        const lat2 = (coordinates[j][0] * Math.PI) / 180;
        const lng1 = (coordinates[i][1] * Math.PI) / 180;
        const lng2 = (coordinates[j][1] * Math.PI) / 180;
        total += (lng2 - lng1) * (2 + Math.sin(lat1) + Math.sin(lat2));
      }
      const areaHa = Math.abs((total * R * R) / 2) / 10000;
      const parcel = await storage.updateParcelPolygon(req.params.id, coordinates, areaHa);
      if (!parcel) return res.status(404).json({ message: "Lote no encontrado" });
      res.json({ parcel });
    } catch (error) {
      console.error("Error updating parcel polygon:", error);
      res.status(500).json({ message: "Error al actualizar el polígono" });
    }
  });

  // Delete parcel polygon (T251)
  app.delete("/api/parcels/:id/polygon", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const user = req.user as User;
      const existingParcel = await storage.getParcel(req.params.id);
      if (!existingParcel) return res.status(404).json({ message: "Lote no encontrado" });
      if (existingParcel.userId !== user.id && user.role !== "admin") {
        return res.status(403).json({ message: "No tienes permiso para modificar este lote" });
      }
      const parcel = await storage.deleteParcelPolygon(req.params.id);
      if (!parcel) return res.status(404).json({ message: "Lote no encontrado" });
      res.json({ parcel });
    } catch (error) {
      console.error("Error deleting parcel polygon:", error);
      res.status(500).json({ message: "Error al eliminar el polígono" });
    }
  });

  // Delete parcel
  app.delete("/api/parcels/:id", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const user = req.user as User;
      const existingParcel = await storage.getParcel(req.params.id);
      
      if (!existingParcel) {
        return res.status(404).json({ message: "Lote no encontrado" });
      }

      if (existingParcel.userId !== user.id) {
        return res.status(403).json({ message: "No tienes permiso para eliminar este lote" });
      }

      await storage.deleteParcel(req.params.id);
      res.json({ message: "Lote eliminado exitosamente" });
    } catch (error) {
      console.error("Error deleting parcel:", error);
      res.status(500).json({ message: "Error al eliminar lote" });
    }
  });

  // ============ Parcel Data Routes ============

  // Get parcel data
  app.get("/api/parcels/:id/data", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const user = req.user as User;
      const parcel = await storage.getParcel(req.params.id);
      
      if (!parcel) {
        return res.status(404).json({ message: "Lote no encontrado" });
      }

      if (parcel.userId !== user.id && !parcel.isPublic) {
        return res.status(403).json({ message: "No tienes permiso para ver estos datos" });
      }

      const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
      const data = await storage.getParcelData(req.params.id, limit);
      
      res.json({ data });
    } catch (error) {
      console.error("Error fetching parcel data:", error);
      res.status(500).json({ message: "Error al obtener datos del lote" });
    }
  });

  // ============ Alert Routes ============

  // Get alerts for current user
  app.get("/api/alerts", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const user = req.user as User;
      const alerts = await storage.getAlertsByUser(user.id);
      res.json({ alerts });
    } catch (error) {
      console.error("Error fetching alerts:", error);
      res.status(500).json({ message: "Error al obtener alertas" });
    }
  });

  // Get alerts for a specific parcel (dynamic generation based on real data)
  app.get("/api/parcels/:id/alerts", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const user = req.user as User;
      const parcel = await storage.getParcel(req.params.id);
      
      if (!parcel) {
        return res.status(404).json({ message: "Lote no encontrado" });
      }

      if (parcel.userId !== user.id) {
        return res.status(403).json({ message: "No tienes permiso para ver estas alertas" });
      }

      const [parcelData, soilAnalysis, setupProgress, productionCosts, cycleDetail, phenologyPrompts] = await Promise.all([
        storage.getParcelData(req.params.id, 10),
        storage.getLatestSoilAnalysis(req.params.id),
        storage.getParcelSetupProgress(req.params.id).catch(() => null),
        storage.getProductionCostsByParcel(req.params.id).catch(() => []),
        storage.getLatestCropCycleDetail(req.params.id).catch(() => null),
        storage.getPhenologyPrompts(req.params.id).catch(() => []),
      ]);

      let weatherData: { temperature?: number; precipitation?: number; humidity?: number } | undefined;
      
      if (parcel.latitude && parcel.longitude) {
        try {
          const lat = parseFloat(parcel.latitude);
          const lng = parseFloat(parcel.longitude);
          const weather = await getFullWeatherData(
            lat, 
            lng, 
            parcel.plantingDate ? new Date(parcel.plantingDate) : null,
            parcel.crop || ""
          );
          if (weather && weather.current) {
            weatherData = {
              temperature: weather.current.temperature,
              precipitation: weather.current.precipitation,
              humidity: weather.current.humidity,
            };
          }
        } catch (e) {
          console.log("Could not fetch weather for alerts");
        }
      }

      // ── T176: Build profitability data for alert engine ───────────────────
      const totalCost = (productionCosts || []).reduce(
        (s: number, c: any) => s + parseFloat(String(c.totalCost) || "0"), 0
      );
      let profitabilityAlertInput = undefined;
      if (cycleDetail || totalCost > 0) {
        let grossMargin = null;
        let roi = null;
        let projectedRevenue = null;
        if (cycleDetail && cycleDetail.expectedYieldTon && cycleDetail.targetPricePerTon) {
          const area = parseFloat(parcel.area || "1");
          projectedRevenue = parseFloat(String(cycleDetail.expectedYieldTon)) * parseFloat(String(cycleDetail.targetPricePerTon)) * area;
          // totalCost is already the TOTAL for the field (not per-ha); do not multiply by area again.
          grossMargin = projectedRevenue - totalCost;
          roi = totalCost > 0 ? ((grossMargin / totalCost) * 100) : null;
        }
        profitabilityAlertInput = {
          grossMargin,
          roi,
          totalCost: totalCost > 0 ? totalCost : null,
          projectedRevenue,
          hasCycleDetail: !!cycleDetail,
        };
      }

      const latestParcelData = parcelData.length > 0 ? parcelData[0] : null;

      // Build overdue phenology prompts for alert engine
      const nowMs = Date.now();
      const overduePromptInputs = (phenologyPrompts || [])
        .filter((p: any) => !p.isCompleted && p.dueDate && new Date(p.dueDate).getTime() < nowMs)
        .map((p: any) => ({
          id: p.id,
          stage: p.stage,
          promptText: p.promptText,
          daysOverdue: Math.floor((nowMs - new Date(p.dueDate).getTime()) / (1000 * 60 * 60 * 24)),
        }))
        .filter((p: any) => p.daysOverdue >= 15);

      const generatedAlerts = generateAlerts({
        parcel,
        latestParcelData,
        recentParcelData: parcelData,
        soilAnalysis: soilAnalysis || null,
        weatherData,
        profitability: profitabilityAlertInput,
        setupProgress: setupProgress !== undefined ? setupProgress : null,
        cycleDurationDays: cycleDetail?.cycleDurationDays != null ? Number(cycleDetail.cycleDurationDays) : null,
        overduePrompts: overduePromptInputs.length > 0 ? overduePromptInputs : undefined,
      });

      const recommendedActions = generateRecommendedActions(generatedAlerts, parcel);

      const dynamicAlerts = generatedAlerts.map((alert, index) => ({
        id: `dynamic-${req.params.id}-${alert.source}-${index}`,
        parcelId: req.params.id,
        severity: alert.severity,
        title: alert.title,
        description: alert.description,
        isRead: false,
        createdAt: new Date(),
        source: alert.source,
        dataValue: alert.dataValue,
        threshold: alert.threshold,
        isDynamic: true,
      }));

      const persistedAlerts = await storage.getAlertsByParcel(req.params.id);
      
      const allAlerts = [
        ...dynamicAlerts,
        ...persistedAlerts.map(a => ({ ...a, isDynamic: false })),
      ].sort((a, b) => {
        const severityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
        return (severityOrder[a.severity] || 2) - (severityOrder[b.severity] || 2);
      });

      res.json({ 
        alerts: allAlerts,
        recommendedActions,
        dataSource: {
          hasParcelData: parcelData.length > 0,
          hasSoilAnalysis: !!soilAnalysis,
          hasWeatherData: !!weatherData,
        }
      });
    } catch (error) {
      console.error("Error fetching parcel alerts:", error);
      res.status(500).json({ message: "Error al obtener alertas del lote" });
    }
  });

  // Mark alert as read
  app.patch("/api/alerts/:id/read", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      await storage.markAlertAsRead(req.params.id);
      res.json({ message: "Alerta marcada como leída" });
    } catch (error) {
      console.error("Error marking alert as read:", error);
      res.status(500).json({ message: "Error al marcar alerta como leída" });
    }
  });

  // Mark proactive alert as applied or dismissed
  app.patch("/api/alerts/:id/action", isAuthenticated, isActiveUser, async (req: any, res) => {
    try {
      const { actionStatus } = req.body;
      if (!["applied", "dismissed"].includes(actionStatus)) {
        return res.status(400).json({ message: "actionStatus inválido" });
      }
      // Ownership check: verify alert belongs to a parcel owned by the authenticated user
      const alert = await storage.getAlertById(req.params.id);
      if (!alert) return res.status(404).json({ message: "Alerta no encontrada" });
      const parcel = await storage.getParcel(alert.parcelId);
      const isAdmin = (req.user as any)?.role === "admin";
      if (!isAdmin && (!parcel || parcel.userId !== (req.user as any)?.id)) {
        return res.status(403).json({ message: "No autorizado" });
      }
      const ok = await storage.updateAlertActionStatus(req.params.id, actionStatus);
      if (!ok) return res.status(404).json({ message: "Alerta no encontrada" });
      res.json({ message: "Estado actualizado" });
    } catch (error) {
      res.status(500).json({ message: "Error al actualizar alerta" });
    }
  });

  // ============ Admin Routes ============

  // Get all users (admin only)
  app.get("/api/admin/users", isAuthenticated, isActiveUser, isAdmin, async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      const usersWithoutPasswords = users.map(({ passwordHash, ...user }) => user);
      res.json({ users: usersWithoutPasswords });
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: "Error al obtener usuarios" });
    }
  });

  // Update user role (admin only)
  app.patch("/api/admin/users/:id/role", isAuthenticated, isActiveUser, isAdmin, async (req, res) => {
    try {
      const { role } = req.body;
      if (!role || !["admin", "farmer", "researcher"].includes(role)) {
        return res.status(400).json({ message: "Rol inválido" });
      }

      const user = await storage.updateUserRole(req.params.id, role);
      if (!user) {
        return res.status(404).json({ message: "Usuario no encontrado" });
      }

      const { passwordHash, ...userWithoutPassword } = user;
      res.json({ user: userWithoutPassword, message: "Rol actualizado exitosamente" });
    } catch (error) {
      console.error("Error updating user role:", error);
      res.status(500).json({ message: "Error al actualizar rol" });
    }
  });

  // Activate/deactivate user (admin only)
  app.patch("/api/admin/users/:id/status", isAuthenticated, isActiveUser, isAdmin, async (req, res) => {
    try {
      const { isActive } = req.body;
      if (typeof isActive !== "boolean") {
        return res.status(400).json({ message: "Estado inválido" });
      }

      // Prevent admin from deactivating themselves
      const adminUser = req.user as User;
      if (req.params.id === adminUser.id && !isActive) {
        return res.status(400).json({ message: "No puedes desactivar tu propia cuenta" });
      }

      const user = await storage.updateUserActive(req.params.id, isActive);
      if (!user) {
        return res.status(404).json({ message: "Usuario no encontrado" });
      }

      const { passwordHash, ...userWithoutPassword } = user;
      res.json({ 
        user: userWithoutPassword, 
        message: isActive ? "Usuario activado" : "Usuario desactivado" 
      });
    } catch (error) {
      console.error("Error updating user status:", error);
      res.status(500).json({ message: "Error al actualizar estado del usuario" });
    }
  });

  // Change user password (admin only)
  app.patch("/api/admin/users/:id/password", isAuthenticated, isActiveUser, isAdmin, async (req, res) => {
    try {
      const { password } = req.body;
      if (!password || typeof password !== "string" || password.length < 8) {
        return res.status(400).json({ message: "La contraseña debe tener al menos 8 caracteres" });
      }
      const user = await storage.getUser(req.params.id);
      if (!user) return res.status(404).json({ message: "Usuario no encontrado" });
      const passwordHash = await bcrypt.hash(password, 10);
      await storage.updateUserPassword(req.params.id, passwordHash);
      res.json({ message: "Contraseña actualizada exitosamente" });
    } catch (error) {
      console.error("Error updating user password:", error);
      res.status(500).json({ message: "Error al actualizar contraseña" });
    }
  });

  // Get all parcels with owner info and latest indicators (admin only)
  app.get("/api/admin/parcels", isAuthenticated, isActiveUser, isAdmin, async (req, res) => {
    try {
      const parcels = await storage.getAllParcelsForAdmin();
      res.json({ parcels });
    } catch (error) {
      console.error("Error fetching all parcels:", error);
      res.status(500).json({ message: "Error al obtener todos los lotes" });
    }
  });

  // Get system stats (admin only)
  app.get("/api/admin/stats", isAuthenticated, isActiveUser, isAdmin, async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      const parcels = await storage.getAllParcels();
      
      const stats = {
        totalUsers: users.length,
        activeUsers: users.filter(u => u.isActive).length,
        usersByRole: {
          admin: users.filter(u => u.role === "admin").length,
          farmer: users.filter(u => u.role === "farmer").length,
          researcher: users.filter(u => u.role === "researcher").length,
        },
        totalParcels: parcels.length,
        publicParcels: parcels.filter(p => p.isPublic).length,
        parcelsByStatus: {
          active: parcels.filter(p => p.status === "active").length,
          warning: parcels.filter(p => p.status === "warning").length,
          inactive: parcels.filter(p => p.status === "inactive").length,
        },
      };

      res.json({ stats });
    } catch (error) {
      console.error("Error fetching stats:", error);
      res.status(500).json({ message: "Error al obtener estadísticas" });
    }
  });

  // Recent platform activity (admin only)
  app.get("/api/admin/activity", isAuthenticated, isActiveUser, isAdmin, async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      const parcels = await storage.getAllParcels();
      const recentUsers = [...users]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 8)
        .map(({ passwordHash, ...u }) => ({ type: "user", id: u.id, label: u.name, sub: u.email, role: u.role, date: u.createdAt }));
      const recentParcels = [...parcels]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 8)
        .map(p => ({ type: "parcel", id: p.id, label: p.name, sub: p.location, crop: p.crop, date: p.createdAt }));
      const combined = [...recentUsers, ...recentParcels]
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, 12);
      res.json({ activity: combined });
    } catch (error) {
      res.status(500).json({ message: "Error al obtener actividad" });
    }
  });

  // Get parcels for a specific user (admin only)
  app.get("/api/admin/users/:id/parcels", isAuthenticated, isActiveUser, isAdmin, async (req, res) => {
    try {
      const parcels = await storage.getParcelsByUser(req.params.id);
      res.json({ parcels });
    } catch (error) {
      res.status(500).json({ message: "Error al obtener predios del usuario" });
    }
  });

  // Full digital dossier for a user (admin only)
  app.get("/api/admin/users/:id/dossier", isAuthenticated, isActiveUser, isAdmin, async (req, res) => {
    try {
      const user = await storage.getUser(req.params.id);
      if (!user) return res.status(404).json({ message: "Usuario no encontrado" });

      const [allAdminParcels, userAlerts, communityPosts] = await Promise.all([
        storage.getAllParcelsForAdmin(),
        storage.getAlertsByUser(req.params.id),
        storage.getCommunityPosts({ authorId: req.params.id, limit: 100 }),
      ]);

      const userParcels = allAdminParcels.filter((p: any) => p.userId === req.params.id);

      const parcelDetails = await Promise.all(userParcels.map(async (parcel: any) => {
        const [soilAnalyses, iotDevices, droneFlights] = await Promise.all([
          storage.getSoilAnalysisByParcel(parcel.id),
          storage.getIotDevicesByParcel(parcel.id),
          storage.getDroneFlightsByParcel(parcel.id),
        ]);
        const latestSoil = soilAnalyses.length > 0 ? soilAnalyses[soilAnalyses.length - 1] : null;
        return {
          ...parcel,
          latestSoilPh: latestSoil?.ph ?? null,
          latestOrganicMatter: latestSoil?.organicMatter ?? null,
          latestSoilDate: latestSoil?.analysisDate ?? null,
          iotDeviceCount: iotDevices.length,
          droneFlightCount: droneFlights.length,
          alertCount: userAlerts.filter((a: any) => a.parcelId === parcel.id).length,
        };
      }));

      const { passwordHash, ...userWithoutPassword } = user;
      const totalArea = parcelDetails.reduce((sum: number, p: any) => sum + parseFloat(p.area || "0"), 0);
      const ndviValues = parcelDetails.filter((p: any) => p.latestNdvi).map((p: any) => parseFloat(p.latestNdvi));
      const avgNdvi = ndviValues.length > 0 ? ndviValues.reduce((s: number, v: number) => s + v, 0) / ndviValues.length : null;
      const crops: string[] = Array.from(new Set(parcelDetails.map((p: any) => p.crop).filter(Boolean)));

      res.json({
        user: userWithoutPassword,
        parcels: parcelDetails,
        stats: {
          totalParcels: parcelDetails.length,
          totalArea: Math.round(totalArea * 10) / 10,
          uniqueCrops: crops,
          avgNdvi: avgNdvi !== null ? Math.round(avgNdvi * 1000) / 1000 : null,
          alertCount: userAlerts.length,
          communityPostsCount: communityPosts.length,
        },
        recentPosts: communityPosts.slice(0, 5).map((p: any) => ({
          id: p.id,
          content: typeof p.content === "string" ? p.content.substring(0, 150) : "",
          type: p.type,
          createdAt: p.createdAt,
          likesCount: p.likesCount || 0,
        })),
      });
    } catch (error) {
      console.error("Error fetching user dossier:", error);
      res.status(500).json({ message: "Error al obtener expediente" });
    }
  });

  // Update parcel status/visibility (admin only)
  app.patch("/api/admin/parcels/:id", isAuthenticated, isActiveUser, isAdmin, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) return res.status(404).json({ message: "Predio no encontrado" });
      const allowedFields: Record<string, boolean> = { status: true, isPublic: true };
      const updates: any = {};
      for (const key of Object.keys(req.body)) {
        if (allowedFields[key]) updates[key] = req.body[key];
      }
      const updated = await storage.updateParcel(req.params.id, updates);
      res.json({ parcel: updated });
    } catch (error) {
      res.status(500).json({ message: "Error al actualizar predio" });
    }
  });

  // ============ Google Earth Engine Routes ============

  // Initialize Earth Engine on server start
  initializeEarthEngine().then((success) => {
    if (success) {
      console.log("Google Earth Engine ready for satellite data");
    } else {
      console.log("Google Earth Engine not available - using mock data");
    }
  });

  // Get GEE status
  app.get("/api/gee/status", (req, res) => {
    const status = getGEEStatus();
    res.json(status);
  });

  // Get vegetation indices for a parcel
  app.get("/api/parcels/:id/indices", isAuthenticated, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) {
        return res.status(404).json({ message: "Parcela no encontrada" });
      }

      const SENTINEL_LAUNCH = "2015-06-23"; // Sentinel-2A launch date
      const customStart = req.query.startDate as string | undefined;
      const customEnd   = req.query.endDate   as string | undefined;

      let endDate  = new Date();
      let startDate = new Date();

      if (customStart && customEnd) {
        // Custom date range — clamp to Sentinel-2 availability
        startDate = new Date(customStart < SENTINEL_LAUNCH ? SENTINEL_LAUNCH : customStart);
        endDate   = new Date(customEnd);
      } else {
        const period = req.query.period as string || "month";
        switch (period) {
          case "quarter":   startDate.setMonth(startDate.getMonth() - 3);       break;
          case "year":      startDate.setFullYear(startDate.getFullYear() - 1);  break;
          case "2y":        startDate.setFullYear(startDate.getFullYear() - 2);  break;
          case "5y":        startDate.setFullYear(startDate.getFullYear() - 5);  break;
          case "10y":       startDate.setFullYear(startDate.getFullYear() - 10); break;
          case "since2015": startDate = new Date(SENTINEL_LAUNCH);               break;
          default:          startDate.setMonth(startDate.getMonth() - 1);
        }
      }

      let coordinates: [number, number][] = [];
      if (parcel.polygonCoordinates && Array.isArray(parcel.polygonCoordinates)) {
        coordinates = parcel.polygonCoordinates as [number, number][];
      } else if (parcel.latitude && parcel.longitude) {
        const lat = Number(parcel.latitude);
        const lng = Number(parcel.longitude);
        const offset = 0.01;
        coordinates = [
          [lat - offset, lng - offset],
          [lat - offset, lng + offset],
          [lat + offset, lng + offset],
          [lat + offset, lng - offset],
        ];
      }

      const indices = await getVegetationIndices(
        { coordinates },
        startDate.toISOString().split("T")[0],
        endDate.toISOString().split("T")[0]
      );

      // Cache the average NDVI from real satellite data for carbon estimation
      if (isGEEAvailable() && indices.length > 0) {
        const ndviValues = indices.map(x => x.ndvi).filter(v => typeof v === "number" && v > 0);
        if (ndviValues.length > 0) {
          const ndviMean = ndviValues.reduce((a, b) => a + b, 0) / ndviValues.length;
          const latestDate = indices[indices.length - 1]?.date ?? new Date().toISOString().split("T")[0];
          storage.cacheParcelSatelliteNdvi(parcel.id, ndviMean, latestDate).catch(() => {});
        }
      }

      res.json({ 
        indices,
        source: isGEEAvailable() ? "satellite" : "simulated",
        parcelId: parcel.id,
      });
    } catch (error) {
      console.error("Error fetching indices:", error);
      res.status(500).json({ message: "Error al obtener índices vegetativos" });
    }
  });

  // Get latest NDVI stats for a parcel
  app.get("/api/parcels/:id/ndvi-stats", isAuthenticated, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) {
        return res.status(404).json({ message: "Parcela no encontrada" });
      }

      let coordinates: [number, number][] = [];
      if (parcel.polygonCoordinates && Array.isArray(parcel.polygonCoordinates)) {
        coordinates = parcel.polygonCoordinates as [number, number][];
      } else if (parcel.latitude && parcel.longitude) {
        const lat = Number(parcel.latitude);
        const lng = Number(parcel.longitude);
        const offset = 0.01;
        coordinates = [
          [lat - offset, lng - offset],
          [lat - offset, lng + offset],
          [lat + offset, lng + offset],
          [lat + offset, lng - offset],
        ];
      }

      const stats = await getLatestNDVIStats({ coordinates });

      // Cache mean NDVI from real satellite fetch
      if (isGEEAvailable() && stats.hasData && stats.mean > 0) {
        storage.cacheParcelSatelliteNdvi(parcel.id, stats.mean, stats.date).catch(() => {});
      }

      res.json({ 
        stats,
        source: isGEEAvailable() ? "satellite" : "simulated",
        parcelId: parcel.id
      });
    } catch (error) {
      console.error("Error fetching NDVI stats:", error);
      res.status(500).json({ message: "Error al obtener estadísticas NDVI" });
    }
  });

  // Get NDVI map tiles URL for a parcel
  app.get("/api/parcels/:id/ndvi-tiles", isAuthenticated, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) {
        return res.status(404).json({ message: "Parcela no encontrada" });
      }

      if (!isGEEAvailable()) {
        return res.json({ 
          available: false, 
          message: "Google Earth Engine no configurado" 
        });
      }

      let coordinates: [number, number][] = [];
      if (parcel.polygonCoordinates && Array.isArray(parcel.polygonCoordinates)) {
        coordinates = parcel.polygonCoordinates as [number, number][];
      } else if (parcel.latitude && parcel.longitude) {
        const lat = Number(parcel.latitude);
        const lng = Number(parcel.longitude);
        const offset = 0.01;
        coordinates = [
          [lat - offset, lng - offset],
          [lat - offset, lng + offset],
          [lat + offset, lng + offset],
          [lat + offset, lng - offset],
        ];
      }

      const tiles = await getNDVIMapTiles({ coordinates });

      if (tiles) {
        res.json({ 
          available: true,
          ...tiles,
          parcelId: parcel.id
        });
      } else {
        res.json({ 
          available: false,
          message: "No se pudieron generar tiles NDVI"
        });
      }
    } catch (error) {
      console.error("Error fetching NDVI tiles:", error);
      res.status(500).json({ message: "Error al obtener tiles NDVI" });
    }
  });

  // Get map tiles for any vegetation index (NDVI, EVI, NDMI)
  app.get("/api/parcels/:id/sentinel-images", isAuthenticated, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) {
        return res.status(404).json({ message: "Parcela no encontrada" });
      }

      let coordinates: [number, number][] = [];
      if (parcel.polygonCoordinates && Array.isArray(parcel.polygonCoordinates)) {
        coordinates = parcel.polygonCoordinates as [number, number][];
      } else if (parcel.latitude && parcel.longitude) {
        const lat = Number(parcel.latitude);
        const lng = Number(parcel.longitude);
        const offset = 0.01;
        coordinates = [
          [lat - offset, lng - offset],
          [lat - offset, lng + offset],
          [lat + offset, lng + offset],
          [lat + offset, lng - offset],
        ];
      }

      const months = parseInt(req.query.months as string) || 3;
      const images = await getAvailableSentinelImages({ coordinates }, months);

      res.json({
        images,
        source: isGEEAvailable() ? "satellite" : "simulated",
        parcelId: parcel.id,
      });
    } catch (error) {
      console.error("Error fetching sentinel images:", error);
      res.status(500).json({ message: "Error al obtener imágenes disponibles" });
    }
  });

  app.get("/api/parcels/:id/index-tiles", isAuthenticated, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) {
        return res.status(404).json({ message: "Parcela no encontrada" });
      }

      if (!isGEEAvailable()) {
        return res.json({ 
          available: false, 
          message: "Google Earth Engine no configurado" 
        });
      }

      const indexTypeParam = (req.query.index as string) || "ndvi";
      const validIndexes = ["ndvi", "evi", "ndmi"];
      const indexType = validIndexes.includes(indexTypeParam.toLowerCase()) 
        ? indexTypeParam.toLowerCase() 
        : "ndvi";
      const specificDate = req.query.date as string | undefined;

      let coordinates: [number, number][] = [];
      if (parcel.polygonCoordinates && Array.isArray(parcel.polygonCoordinates)) {
        coordinates = parcel.polygonCoordinates as [number, number][];
      } else if (parcel.latitude && parcel.longitude) {
        const lat = Number(parcel.latitude);
        const lng = Number(parcel.longitude);
        const offset = 0.01;
        coordinates = [
          [lat - offset, lng - offset],
          [lat - offset, lng + offset],
          [lat + offset, lng + offset],
          [lat + offset, lng - offset],
        ];
      }

      const tiles = await getIndexMapTiles({ coordinates }, indexType, specificDate);

      if (tiles) {
        res.json({ 
          available: true,
          ...tiles,
          parcelId: parcel.id,
          indexType
        });
      } else {
        res.json({ 
          available: false,
          message: `No se pudieron generar tiles ${indexType.toUpperCase()}`
        });
      }
    } catch (error) {
      console.error("Error fetching index tiles:", error);
      res.status(500).json({ message: "Error al obtener tiles de índice" });
    }
  });

  // ── Mexico National Soil Analysis Dataset ─────────────────────────────────
  app.get("/api/mexico-soil-samples", isAuthenticated, async (req, res) => {
    try {
      const lat = parseFloat(req.query.lat as string);
      const lng = parseFloat(req.query.lng as string);
      const radiusKm = parseFloat((req.query.radiusKm as string) || "100");
      if (isNaN(lat) || isNaN(lng)) {
        return res.status(400).json({ message: "Se requieren parámetros lat y lng" });
      }
      const rows = await storage.getMexicoSoilSamples(lat, lng, radiusKm);
      const features = rows.map((r) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [parseFloat(r.lng as string), parseFloat(r.lat as string)] },
        properties: {
          id: r.id,
          labNumber: r.labNumber,
          estado: r.estado,
          municipio: r.municipio,
          localidad: r.localidad,
          loteu: r.loteu,
          pH: r.ph !== null ? parseFloat(r.ph as string) : null,
          ce: r.ce !== null ? parseFloat(r.ce as string) : null,
          dap: r.dap !== null ? parseFloat(r.dap as string) : null,
          mo: r.mo !== null ? parseFloat(r.mo as string) : null,
          n: r.n !== null ? parseFloat(r.n as string) : null,
          metP: r.metP,
          p: r.p !== null ? parseFloat(r.p as string) : null,
          k: r.k !== null ? parseFloat(r.k as string) : null,
          ca: r.ca !== null ? parseFloat(r.ca as string) : null,
          mg: r.mg !== null ? parseFloat(r.mg as string) : null,
          fe: r.fe !== null ? parseFloat(r.fe as string) : null,
          zn: r.zn !== null ? parseFloat(r.zn as string) : null,
          b: r.b !== null ? parseFloat(r.b as string) : null,
          mn: r.mn !== null ? parseFloat(r.mn as string) : null,
          cu: r.cu !== null ? parseFloat(r.cu as string) : null,
          arcilla: r.arcilla !== null ? parseFloat(r.arcilla as string) : null,
          limo: r.limo !== null ? parseFloat(r.limo as string) : null,
          arena: r.arena !== null ? parseFloat(r.arena as string) : null,
          na: r.na !== null ? parseFloat(r.na as string) : null,
          cic: r.cic !== null ? parseFloat(r.cic as string) : null,
          textura: r.textura,
        },
      }));
      res.json({ type: "FeatureCollection", features });
    } catch (error) {
      console.error("Error fetching Mexico soil samples:", error);
      res.status(500).json({ message: "Error al obtener muestras de suelo" });
    }
  });

  // ── Mexico National Soil Interpolated Raster ───────────────────────────────
  // Cache: key = variable+method+estado, value = { ts, data }
  const mexicoRasterCache = new Map<string, { ts: number; data: Record<string, unknown> }>();
  const MEXICO_RASTER_TTL_MS = 30 * 60 * 1000;

  // Load state border polygons (simplified from INEGI shapefile)
  let mexicoStatePolygons: Record<string, [number, number][]> = {};
  try {
    // Use process.cwd() — tsx runs as ESM where __dirname is not defined
    const candidates = [
      path.join(process.cwd(), "server/data/mexico-states-polygons.json"),
      path.resolve("server/data/mexico-states-polygons.json"),
    ];
    let loaded = false;
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        mexicoStatePolygons = JSON.parse(fs.readFileSync(p, "utf8"));
        console.log(`[mexico-states] Loaded ${Object.keys(mexicoStatePolygons).length} state polygons from ${p}`);
        loaded = true;
        break;
      }
    }
    if (!loaded) {
      console.warn("[mexico-states] Tried paths:", candidates);
      console.warn("[mexico-states] __dirname =", __dirname, "cwd =", process.cwd());
    }
  } catch (e) {
    console.error("[mexico-states] Error loading polygons:", e);
  }

  // Graham-scan convex hull on [lng, lat] points with optional degree buffer.
  function mexicoConvexHull(
    pts: { lat: number; lng: number }[],
    bufferDeg = 0.3,
  ): [number, number][] {
    if (pts.length < 3) {
      const lngs = pts.map(p => p.lng), lats = pts.map(p => p.lat);
      const [mn0, mx0] = [Math.min(...lngs) - bufferDeg, Math.max(...lngs) + bufferDeg];
      const [mn1, mx1] = [Math.min(...lats) - bufferDeg, Math.max(...lats) + bufferDeg];
      return [[mn0, mn1],[mx0, mn1],[mx0, mx1],[mn0, mx1],[mn0, mn1]];
    }
    const ps: [number, number][] = pts.map(p => [p.lng, p.lat]);
    const start = ps.reduce((a, b) => b[1] < a[1] || (b[1] === a[1] && b[0] < a[0]) ? b : a);
    const cross2 = (o: [number,number], a: [number,number], b: [number,number]) =>
      (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0]);
    const sorted = [...ps].sort((a, b) => {
      const ax = a[0]-start[0], ay = a[1]-start[1];
      const bx = b[0]-start[0], by = b[1]-start[1];
      const c = ax*by - ay*bx;
      return Math.abs(c) > 1e-12 ? (c > 0 ? -1 : 1) : Math.hypot(ax,ay) - Math.hypot(bx,by);
    });
    const hull: [number,number][] = [];
    for (const p of sorted) {
      while (hull.length >= 2 && cross2(hull[hull.length-2], hull[hull.length-1], p) <= 0) hull.pop();
      hull.push(p);
    }
    // Apply buffer: scale each hull vertex away from centroid by bufferDeg
    const cx = hull.reduce((s,p)=>s+p[0],0)/hull.length;
    const cy = hull.reduce((s,p)=>s+p[1],0)/hull.length;
    const buffered = hull.map(([x,y]): [number,number] => {
      const dx = x-cx, dy = y-cy, d = Math.hypot(dx,dy);
      if (d < 1e-12) return [x+bufferDeg, y+bufferDeg];
      return [x + (dx/d)*bufferDeg, y + (dy/d)*bufferDeg];
    });
    buffered.push(buffered[0]);
    return buffered;
  }

  // GET /api/mexico-estados — list of distinct estados (public)
  app.get("/api/mexico-estados", async (_req, res) => {
    try {
      const estados = await storage.getMexicoEstados();
      res.json({ estados });
    } catch (e) {
      res.status(500).json({ message: "Error al obtener estados" });
    }
  });

  // GET /api/mexico-soil-map-points — sample points for map overlay (public)
  // Returns decimated points for a given variable, optionally filtered by estado.
  app.get("/api/mexico-soil-map-points", async (req, res) => {
    try {
      const variable = (req.query.variable as string) || "pH";
      const estado   = (req.query.estado   as string) || "";
      const VALID_VARS = ["pH","CE","MO","N","P","K","Ca","Mg","Fe","Zn","Cu","Mn","B","CIC","Na"];
      if (!VALID_VARS.includes(variable)) {
        return res.status(400).json({ message: "Variable no válida" });
      }
      const raw = await storage.getMexicoSoilForInterpolation(variable, estado || undefined);
      // Decimate for map overlay: keep at most 2000 points
      const MAX = 2000;
      let pts = raw;
      if (raw.length > MAX) {
        const step = Math.ceil(raw.length / MAX);
        pts = raw.filter((_, i) => i % step === 0);
      }
      res.json({ points: pts });
    } catch (e) {
      res.status(500).json({ message: "Error al obtener puntos" });
    }
  });

  app.get("/api/mexico-soil-raster", async (req, res) => {
    try {
      const variable = (req.query.variable as string) || "pH";
      const estado   = (req.query.estado   as string) || "";

      const VALID_VARS = ["pH","CE","MO","N","P","K","Ca","Mg","Fe","Zn","Cu","Mn","B","CIC","Na"];
      if (!VALID_VARS.includes(variable)) {
        return res.status(400).json({ message: "Variable no válida" });
      }

      // Always use RF+Kriging — most accurate ML method available
      const method = "rfk";
      const cacheKey = `${variable}:${method}:${estado}`;
      const cached = mexicoRasterCache.get(cacheKey);
      if (cached && Date.now() - cached.ts < MEXICO_RASTER_TTL_MS) {
        return res.json(cached.data);
      }

      // 1. Fetch all points
      const rawPoints = await storage.getMexicoSoilForInterpolation(variable, estado || undefined);
      if (rawPoints.length < 20) {
        return res.status(422).json({ message: `Datos insuficientes para ${variable} (${rawPoints.length} puntos, mínimo 20 para RF+Kriging)` });
      }

      // 2a. Coarse grid decimation for convex hull (≤ 4000 pts, accurate shape)
      const gridDecimate = (src: typeof rawPoints, gridN: number, gridM: number) => {
        const lts = src.map(p => p.lat), lgs = src.map(p => p.lng);
        const mn0 = Math.min(...lts), mx0 = Math.max(...lts);
        const mn1 = Math.min(...lgs), mx1 = Math.max(...lgs);
        const cell = new Map<string, typeof src[0]>();
        for (const pt of src) {
          const ci = Math.min(gridN-1, Math.floor((pt.lat-mn0)/(mx0-mn0+1e-9)*gridN));
          const cj = Math.min(gridM-1, Math.floor((pt.lng-mn1)/(mx1-mn1+1e-9)*gridM));
          const k = `${ci},${cj}`;
          if (!cell.has(k)) cell.set(k, pt);
        }
        return Array.from(cell.values());
      };

      // 2b. Build convex hull from coarsely-decimated points (≤ 4000)
      const hullSource = rawPoints.length > 4000 ? gridDecimate(rawPoints, 70, 60) : rawPoints;
      const polygon = mexicoConvexHull(hullSource, 0.3);

      // 2c. Fine subsample for RFK interpolation:
      //  - Nacional: 150 pts  → LOOCV completes in ~30-40 s well within 120 s timeout
      //  - Por estado: 500 pts → smaller footprint, Kriging fast
      const RFK_MAX = estado ? 500 : 150;
      const [gN, gM] = estado ? [25, 20] : [13, 12];
      const points = rawPoints.length > RFK_MAX ? gridDecimate(rawPoints, gN, gM) : rawPoints;

      const resolution = estado ? 130 : 120;
      const geoServiceUrl = process.env.GEO_SERVICE_URL || "http://127.0.0.1:8000";
      const geoPayload = {
        points: points.map(p => ({ lat: p.lat, lon: p.lng, value: p.value })),
        method: "rfk",
        polygon,
        resolution,
        n_zones: 3,
        transform: "auto",
      };

      const geoRes = await fetchWithTimeout(
        `${geoServiceUrl}/interpolate`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(geoPayload) },
        120_000,
      );
      if (!geoRes.ok) {
        const err = await geoRes.json().catch(() => ({})) as Record<string, unknown>;
        return res.status(502).json({ message: (err.detail as string) || "Error en geo-service" });
      }
      const geoData = await geoRes.json() as Record<string, unknown>;

      // 4. Compute bbox and statistics from raw points
      let bboxMinLat = Infinity, bboxMaxLat = -Infinity;
      let bboxMinLng = Infinity, bboxMaxLng = -Infinity;
      for (const p of rawPoints) {
        if (p.lat < bboxMinLat) bboxMinLat = p.lat;
        if (p.lat > bboxMaxLat) bboxMaxLat = p.lat;
        if (p.lng < bboxMinLng) bboxMinLng = p.lng;
        if (p.lng > bboxMaxLng) bboxMaxLng = p.lng;
      }
      bboxMinLat -= 0.3; bboxMaxLat += 0.3;
      bboxMinLng -= 0.3; bboxMaxLng += 0.3;

      const vals = rawPoints.map(p => p.value).sort((a, b) => a - b);
      const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
      const std  = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
      const median = vals.length % 2 === 0
        ? (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2
        : vals[Math.floor(vals.length / 2)];

      const result = {
        variable,
        method,
        estado: estado || null,
        n: rawPoints.length,
        nUsed: points.length,
        stats: { min: vals[0], max: vals[vals.length - 1], mean, std, median },
        rasterPng: geoData.raster_png_b64,
        bbox: { minLat: bboxMinLat, maxLat: bboxMaxLat, minLng: bboxMinLng, maxLng: bboxMaxLng },
        displayVmin: geoData.display_vmin,
        displayVmax: geoData.display_vmax,
        gridStats: geoData.grid_stats,
      };
      mexicoRasterCache.set(cacheKey, { ts: Date.now(), data: result });
      res.json(result);
    } catch (error) {
      console.error("Error generating Mexico soil raster:", error);
      res.status(500).json({ message: "Error al generar mapa interpolado" });
    }
  });

  // ── Shared helper: compute one state raster and persist it ──────────────────
  // Adaptive method thresholds (based on raw point count):
  //   ≥ 400 pts → RF+Kriging   (sufficient training data for the RF component)
  //   150–399  → kriging        (ordinary kriging, stable variogram)
  //   < 150    → idw            (robust with very sparse data; LOOCV tunes k & power)
  // For states with < 200 raw points, neighboring state points within an 80 km
  // bbox buffer are blended in as soft boundary conditions.
  async function computeAndCacheStateRaster(variable: string, estado: string): Promise<Record<string, unknown>> {
    const polygon = mexicoStatePolygons[estado];
    if (!polygon || polygon.length < 3) throw Object.assign(new Error(`Sin polígono disponible para ${estado}`), { status: 404 });

    // 1. State-only points
    const rawPoints = await storage.getMexicoSoilForInterpolation(variable, estado);

    // 2. Compute state bbox from polygon
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const [lng, lat] of polygon) {
      if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
    }

    // 3. Cross-state blending for sparse states (< 200 pts)
    //    Fetch all samples within the state bbox + 0.8° (~80 km) buffer.
    //    Neighbor points fill edge zones so kriging/IDW doesn't extrapolate wildly.
    const BLEND_THRESHOLD = 200;
    const BBOX_BUFFER_DEG = 0.8;
    let blendedPoints = rawPoints as { lat: number; lng: number; value: number; estado?: string | null; municipio?: string | null }[];
    let neighborCount = 0;

    if (rawPoints.length < BLEND_THRESHOLD) {
      const bboxPts = await storage.getMexicoSoilInBbox(
        variable,
        minLat - BBOX_BUFFER_DEG, maxLat + BBOX_BUFFER_DEG,
        minLng - BBOX_BUFFER_DEG, maxLng + BBOX_BUFFER_DEG,
      );
      // Merge: state points first, then neighbor points not already included
      const stateSet = new Set(rawPoints.map(p => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`));
      const neighbors = bboxPts.filter(p => p.estado !== estado && !stateSet.has(`${p.lat.toFixed(6)},${p.lng.toFixed(6)}`));
      neighborCount = neighbors.length;
      blendedPoints = [...rawPoints, ...neighbors];
    }

    if (blendedPoints.length < 5) throw Object.assign(
      new Error(`Insuficientes muestras en ${estado}: ${rawPoints.length} puntos propios (mínimo 5)`), { status: 422 });

    // 4. Adaptive method selection (based on state-only raw point count)
    const geoMethod: string =
      rawPoints.length >= 400 ? "rfk" :
      rawPoints.length >= 150 ? "kriging" :
      "idw";

    // 5. Grid-decimate to speed up geo-service (keep spatial coverage)
    function gridDecimate<T extends { lat: number; lng: number }>(src: T[], gN: number, gM: number): T[] {
      let mn0 = Infinity, mx0 = -Infinity, mn1 = Infinity, mx1 = -Infinity;
      for (const p of src) {
        if (p.lat < mn0) mn0 = p.lat; if (p.lat > mx0) mx0 = p.lat;
        if (p.lng < mn1) mn1 = p.lng; if (p.lng > mx1) mx1 = p.lng;
      }
      const cell = new Map<string, T>();
      for (const pt of src) {
        const ci = Math.min(gN-1, Math.floor((pt.lat-mn0)/(mx0-mn0+1e-9)*gN));
        const cj = Math.min(gM-1, Math.floor((pt.lng-mn1)/(mx1-mn1+1e-9)*gM));
        const k = `${ci},${cj}`;
        if (!cell.has(k)) cell.set(k, pt);
      }
      return Array.from(cell.values());
    }

    // Cap sizes: rfk→500, kriging→350 (matrix O(n²)), idw→250
    const CAP = geoMethod === "rfk" ? 500 : geoMethod === "kriging" ? 350 : 250;
    const GRID_N = geoMethod === "rfk" ? 10 : 8;
    const points = blendedPoints.length > CAP ? gridDecimate(blendedPoints, GRID_N, GRID_N) : blendedPoints;

    const geoServiceUrl = process.env.GEO_SERVICE_URL || "http://127.0.0.1:8000";
    const geoRes = await fetchWithTimeout(
      `${geoServiceUrl}/interpolate`,
      { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          points: points.map(p => ({ lat: p.lat, lon: p.lng, value: p.value })),
          method: geoMethod, polygon, resolution: 80, n_zones: 3, transform: "auto",
        }) },
      120_000,
    );
    if (!geoRes.ok) {
      const err = await geoRes.json().catch(() => ({})) as Record<string, unknown>;
      throw Object.assign(new Error((err.detail as string) || "Error en geo-service"), { status: 502 });
    }
    const geoData = await geoRes.json() as Record<string, unknown>;

    // Stats computed from state-only raw points (not blended neighbors)
    const vals = rawPoints.map(p => p.value).sort((a, b) => a - b);
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    const std  = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
    const median = vals.length % 2 === 0
      ? (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2
      : vals[Math.floor(vals.length / 2)];

    const result: Record<string, unknown> = {
      variable, method: geoMethod, estado,
      n: rawPoints.length, nUsed: points.length,
      neighborCount,
      stats: { min: vals[0], max: vals[vals.length - 1], mean, std, median },
      rasterPng: geoData.raster_png_b64,
      bbox: { minLat, maxLat, minLng, maxLng },
      displayVmin: geoData.display_vmin,
      displayVmax: geoData.display_vmax,
      gridValues: geoData.grid_values,
      rasterVmin: geoData.raster_vmin,
      rasterVmax: geoData.raster_vmax,
    };

    // Persist to DB and warm in-memory cache
    await storage.setMexicoRasterCache(estado, variable, result).catch(e =>
      console.error(`[mexico-raster-cache] Failed to persist ${estado}/${variable}:`, e));
    const cacheKey = `bystate:${variable}:${estado}`;
    mexicoRasterCache.set(cacheKey, { ts: Date.now(), data: result });
    return result;
  }

  // GET /api/mexico-soil-raster-by-state — per-state RF+Kriging, DB-cached (public)
  app.get("/api/mexico-soil-raster-by-state", async (req, res) => {
    try {
      const variable = (req.query.variable as string) || "pH";
      const estado   = (req.query.estado   as string) || "";

      const VALID_VARS = ["pH","CE","MO","N","P","K","Ca","Mg","Fe","Zn","Cu","Mn","B","CIC","Na"];
      if (!VALID_VARS.includes(variable)) return res.status(400).json({ message: "Variable no válida" });
      if (!estado) return res.status(400).json({ message: "Parámetro 'estado' requerido" });

      // 1. In-memory cache (fastest)
      const cacheKey = `bystate:${variable}:${estado}`;
      const memCached = mexicoRasterCache.get(cacheKey);
      if (memCached && Date.now() - memCached.ts < MEXICO_RASTER_TTL_MS) {
        return res.json(memCached.data);
      }

      // 2. DB persistent cache (survives restarts)
      const dbCached = await storage.getMexicoRasterCache(estado, variable);
      if (dbCached) {
        mexicoRasterCache.set(cacheKey, { ts: Date.now(), data: dbCached });
        return res.json(dbCached);
      }

      // 3. Compute fresh, persist, respond
      const result = await computeAndCacheStateRaster(variable, estado);
      res.json(result);
    } catch (error: unknown) {
      const status = (error as { status?: number }).status ?? 500;
      const message = (error as Error).message || "Error al generar mapa por estado";
      if (status === 500) console.error("Error generating per-state soil raster:", error);
      res.status(status).json({ message });
    }
  });

  // GET /api/mexico-soil-raster-cache/status — how many of the 390 slots are cached (public)
  app.get("/api/mexico-soil-raster-cache/status", async (_req, res) => {
    try {
      const rows = await storage.getMexicoRasterCacheStatus();
      const VALID_VARS = ["pH","CE","MO","N","P","K","Ca","Mg","Fe","Zn","Cu","Mn","B","CIC","Na"];
      const estados = Object.keys(mexicoStatePolygons);
      const total = estados.length * VALID_VARS.length;
      res.json({ cached: rows.length, total, entries: rows });
    } catch (e) {
      res.status(500).json({ message: "Error al obtener estado del caché" });
    }
  });

  // POST /api/mexico-soil-raster-cache/warm — build missing cache entries in background (admin)
  app.post("/api/mexico-soil-raster-cache/warm", isAuthenticated, isAdmin, async (req, res) => {
    const VALID_VARS = ["pH","CE","MO","N","P","K","Ca","Mg","Fe","Zn","Cu","Mn","B","CIC","Na"];
    const forceRebuild = req.body?.force === true;
    const estados = Object.keys(mexicoStatePolygons);

    // Identify missing (or all if force) slots
    const existing = forceRebuild ? [] : await storage.getMexicoRasterCacheStatus();
    const existingKeys = new Set(existing.map(e => `${e.estado}:${e.variable}`));
    const missing: { estado: string; variable: string }[] = [];
    for (const est of estados) {
      for (const v of VALID_VARS) {
        if (!existingKeys.has(`${est}:${v}`)) missing.push({ estado: est, variable: v });
      }
    }

    // Respond immediately and process in background
    res.json({ message: `Calentando caché: ${missing.length} combinaciones pendientes`, pending: missing.length });

    // Background: process sequentially to avoid overwhelming geo-service
    (async () => {
      let ok = 0, fail = 0;
      for (const { estado, variable } of missing) {
        try {
          await computeAndCacheStateRaster(variable, estado);
          ok++;
          console.log(`[mexico-raster-warm] ✓ ${estado}/${variable} (${ok}/${missing.length})`);
        } catch (e) {
          fail++;
          console.warn(`[mexico-raster-warm] ✗ ${estado}/${variable}: ${(e as Error).message}`);
        }
      }
      console.log(`[mexico-raster-warm] Done: ${ok} ok, ${fail} failed`);
    })();
  });

  // DELETE /api/mexico-soil-raster-cache — invalidate cache (admin)
  app.delete("/api/mexico-soil-raster-cache", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const estado   = req.query.estado   as string | undefined;
      const variable = req.query.variable as string | undefined;
      const n = await storage.clearMexicoRasterCache(estado, variable);
      // Also clear in-memory
      for (const key of Array.from(mexicoRasterCache.keys())) {
        if (key.startsWith("bystate:")) {
          const parts = key.split(":");
          const kVar = parts[1], kEst = parts[2];
          if ((!variable || kVar === variable) && (!estado || kEst === estado)) {
            mexicoRasterCache.delete(key);
          }
        }
      }
      res.json({ message: `Caché limpiado: ${n} entradas eliminadas` });
    } catch (e) {
      res.status(500).json({ message: "Error al limpiar caché" });
    }
  });

  // ── DEM tiles (Copernicus GLO-30) ─────────────────────────────────────────
  app.get("/api/parcels/:id/dem-tiles", isAuthenticated, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });

      if (!isGEEAvailable()) {
        return res.json({ available: false, message: "Google Earth Engine no configurado" });
      }

      const validTypes = ["elevation", "hillshade", "slope"];
      const typeParam = (req.query.type as string) || "elevation";
      const demType = validTypes.includes(typeParam.toLowerCase()) ? typeParam.toLowerCase() : "elevation";

      let coordinates: [number, number][] = [];
      if (parcel.polygonCoordinates && Array.isArray(parcel.polygonCoordinates)) {
        coordinates = parcel.polygonCoordinates as [number, number][];
      } else if (parcel.latitude && parcel.longitude) {
        const lat = Number(parcel.latitude);
        const lng = Number(parcel.longitude);
        const offset = 0.01;
        coordinates = [
          [lat - offset, lng - offset],
          [lat - offset, lng + offset],
          [lat + offset, lng + offset],
          [lat + offset, lng - offset],
        ];
      }

      const result = await getDEMMapTiles({ coordinates }, demType);
      if (result) {
        res.json({ available: true, ...result, parcelId: parcel.id });
      } else {
        res.json({ available: false, message: "No se pudieron generar tiles DEM" });
      }
    } catch (error) {
      console.error("Error fetching DEM tiles:", error);
      res.status(500).json({ message: "Error al obtener tiles DEM" });
    }
  });

  app.get("/api/parcels/:id/change-map", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) {
        return res.status(404).json({ message: "Parcela no encontrada" });
      }

      if (!isGEEAvailable()) {
        return res.json({ available: false, message: "Google Earth Engine no configurado" });
      }

      const indexType = (req.query.index as string) || "ndvi";
      const dateA = req.query.dateA as string;
      const dateB = req.query.dateB as string;

      if (!dateA || !dateB) {
        return res.status(400).json({ message: "Se requieren dateA y dateB" });
      }

      let coordinates: [number, number][] = [];
      if (parcel.polygonCoordinates && Array.isArray(parcel.polygonCoordinates)) {
        coordinates = parcel.polygonCoordinates as [number, number][];
      } else if (parcel.latitude && parcel.longitude) {
        const lat = Number(parcel.latitude);
        const lng = Number(parcel.longitude);
        const offset = 0.01;
        coordinates = [
          [lat - offset, lng - offset],
          [lat - offset, lng + offset],
          [lat + offset, lng + offset],
          [lat + offset, lng - offset],
        ];
      }

      const result = await getChangeMapTiles({ coordinates }, indexType, dateA, dateB);

      if (result) {
        res.json({ available: true, ...result, indexType });
      } else {
        res.json({ available: false, message: "No se pudo generar el mapa de cambios" });
      }
    } catch (error) {
      console.error("Error generating change map:", error);
      res.status(500).json({ message: "Error al generar mapa de cambios" });
    }
  });

  // Weather data endpoint
  app.get("/api/parcels/:id/weather", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) {
        return res.status(404).json({ message: "Parcela no encontrada" });
      }

      // Check ownership or public visibility
      const user = req.user as User;
      if (parcel.userId !== user.id && !parcel.isPublic && user.role !== "admin") {
        return res.status(403).json({ message: "No tienes permiso para acceder a esta parcela" });
      }

      const latitude = parseFloat(parcel.latitude || "0");
      const longitude = parseFloat(parcel.longitude || "0");

      if (!isFinite(latitude) || !isFinite(longitude) || (latitude === 0 && longitude === 0)) {
        return res.status(400).json({ message: "Coordenadas de parcela no válidas" });
      }

      const plantingDate = parcel.plantingDate ? new Date(parcel.plantingDate) : null;
      const crop = parcel.crop || "Maíz";

      const weatherData = await getFullWeatherData(latitude, longitude, plantingDate, crop);

      res.json(weatherData);
    } catch (error) {
      console.error("Error fetching weather data:", error);
      res.status(500).json({ message: "Error al obtener datos climáticos" });
    }
  });

  // Regenerative metrics endpoint
  app.get("/api/parcels/:id/regenerative-metrics", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) {
        return res.status(404).json({ message: "Parcela no encontrada" });
      }

      const user = req.user as User;
      if (parcel.userId !== user.id && !parcel.isPublic && user.role !== "admin") {
        return res.status(403).json({ message: "No tienes permiso para acceder a esta parcela" });
      }

      const [tillage, rotations, animal, livelihoodData, soilAnalyses, cycleDetail] = await Promise.all([
        storage.getTillagePracticesByParcel(req.params.id),
        storage.getCropRotationByParcel(req.params.id),
        storage.getAnimalIntegrationByParcel(req.params.id),
        storage.getLivelihoodByParcel(req.params.id),
        storage.getSoilAnalysisByParcel(req.params.id),
        storage.getLatestCropCycleDetail(req.params.id).catch(() => null),
      ]);

      const areaHectares = parseFloat(parcel.area || "1");

      // Use Sentinel-2 NDVI cached from the last time the user loaded satellite indices
      const satelliteNdvi = parcel.lastSatelliteNdvi
        ? parseFloat(String(parcel.lastSatelliteNdvi))
        : null;
      const ndviSource = satelliteNdvi !== null ? "satellite" : "none";

      const metrics = calculateRegenerativeMetrics(
        areaHectares,
        satelliteNdvi,
        tillage,
        rotations,
        animal || null,
        livelihoodData || null,
        soilAnalyses || [],
        (cycleDetail as any)?.practicesJson ?? null
      );

      res.json({
        ...metrics,
        ndviSource,
        satelliteNdvi,
        satelliteNdviDate: parcel.lastSatelliteNdviDate ?? null,
      });
    } catch (error) {
      console.error("Error calculating regenerative metrics:", error);
      res.status(500).json({ message: "Error al calcular métricas regenerativas" });
    }
  });

  // GET /api/parcels/:id/carbon-value
  // Returns estimated economic value of the parcel's sequestered carbon in USD and MXN.
  // Uses VCM (Voluntary Carbon Market) spot price and the Banxico exchange rate.
  app.get("/api/parcels/:id/carbon-value", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });

      const user = req.user as User;
      if (parcel.userId !== user.id && !parcel.isPublic && user.role !== "admin") {
        return res.status(403).json({ message: "No tienes permiso para acceder a esta parcela" });
      }

      const [tillage, rotations, animal, livelihoodData, soilAnalyses, cycleDetail, vcmPrice, exchange] = await Promise.all([
        storage.getTillagePracticesByParcel(req.params.id),
        storage.getCropRotationByParcel(req.params.id),
        storage.getAnimalIntegrationByParcel(req.params.id),
        storage.getLivelihoodByParcel(req.params.id),
        storage.getSoilAnalysisByParcel(req.params.id),
        storage.getLatestCropCycleDetail(req.params.id).catch(() => null),
        getVCMPrice(),
        getExchangeRate(),
      ]);

      const areaHectares = parseFloat(parcel.area || "1");
      const satelliteNdvi = parcel.lastSatelliteNdvi ? parseFloat(String(parcel.lastSatelliteNdvi)) : null;

      const metrics = calculateRegenerativeMetrics(
        areaHectares,
        satelliteNdvi,
        tillage,
        rotations,
        animal || null,
        livelihoodData || null,
        soilAnalyses || [],
        (cycleDetail as any)?.practicesJson ?? null
      );

      const tons = metrics.carbonSequestered;

      if (!vcmPrice) {
        // Live source unavailable — return zeroed payload so the UI hides the line
        return res.json({
          tons,
          pricePerTon: null,
          totalUsd: 0,
          totalMxn: null,
          usdMxn: exchange?.usdMxn ?? null,
          source: null,
          date: null,
          available: false,
        });
      }

      const totalUsd = Math.round(tons * vcmPrice.price * 100) / 100;
      const usdMxn = exchange?.usdMxn ?? null;
      const totalMxn = usdMxn !== null ? Math.round(totalUsd * usdMxn * 100) / 100 : null;

      res.json({
        tons,
        pricePerTon: vcmPrice.price,
        totalUsd,
        totalMxn,
        usdMxn,
        source: vcmPrice.source,
        date: vcmPrice.date,
        available: true,
      });
    } catch (error) {
      console.error("Error calculating carbon value:", error);
      res.status(500).json({ message: "Error al calcular valor de carbono" });
    }
  });

  // Regenerative practice recommendations (AI-powered, per crop)
  app.post("/api/parcels/:id/regenerative-recommendations", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) {
        return res.status(404).json({ message: "Parcela no encontrada" });
      }

      const user = req.user as User;
      if (parcel.userId !== user.id && !parcel.isPublic && user.role !== "admin") {
        return res.status(403).json({ message: "No tienes permiso para acceder a esta parcela" });
      }

      const latestData = await storage.getParcelData(parcel.id, 3);
      const latestNdvi = latestData[0]?.ndvi ? parseFloat(latestData[0].ndvi) : null;
      const latestSoilMoisture = latestData[0]?.soilMoisture ? parseFloat(latestData[0].soilMoisture) : null;

      const contextLines = [
        `Cultivo: ${parcel.crop}`,
        `Etapa fenológica: ${parcel.phenologicalStage || "no especificada"}`,
        `Área: ${parcel.area} ha`,
        `Tipo de suelo: ${parcel.soilType || "no especificado"}`,
        `Sistema de riego: ${parcel.irrigationSystem || "no especificado"}`,
        latestNdvi !== null ? `NDVI más reciente: ${latestNdvi.toFixed(3)}` : null,
        latestSoilMoisture !== null ? `Humedad de suelo: ${latestSoilMoisture.toFixed(1)}%` : null,
      ].filter(Boolean).join("\n");

      const prompt = `Eres un experto en agricultura regenerativa. Basado en la siguiente información de un predio:

${contextLines}

Genera exactamente 5 recomendaciones de prácticas regenerativas específicas para este cultivo y situación. Devuelve SOLO un JSON válido con este formato exacto (sin texto adicional, sin markdown):
{"recommendations":[
  {
    "title": "Título corto de la práctica",
    "description": "Descripción concisa de 1-2 oraciones explicando cómo aplicarla y su beneficio regenerativo.",
    "priority": "alta",
    "category": "suelo"
  }
]}

Valores válidos para priority: alta, media, baja. Valores válidos para category: suelo, agua, biodiversidad, carbono, nutricion.
Las recomendaciones deben ser prácticas, accionables y específicas para ${parcel.crop}.`;

      const OpenAI = (await import("openai")).default;
      const openai = new OpenAI({
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
        ...(process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ? { baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL } : {}),
      });

      const completion = await openai.chat.completions.create({
        model: "gpt-5.4",
        messages: [{ role: "user", content: prompt }],
        max_completion_tokens: 800,
        response_format: { type: "json_object" },
      });

      const rawContent = completion.choices[0]?.message?.content || "[]";
      let recommendations: any[];
      try {
        const parsed = JSON.parse(rawContent);
        recommendations = Array.isArray(parsed) ? parsed : parsed.recommendations || [];
      } catch {
        recommendations = [];
      }

      res.json({ recommendations, crop: parcel.crop });
    } catch (error) {
      console.error("Error generating regenerative recommendations:", error);
      res.status(500).json({ message: "Error al generar recomendaciones" });
    }
  });

  // Soil Analysis endpoints
  app.get("/api/parcels/:id/soil-analysis", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) {
        return res.status(404).json({ message: "Parcela no encontrada" });
      }

      const user = req.user as User;
      if (parcel.userId !== user.id && !parcel.isPublic && user.role !== "admin") {
        return res.status(403).json({ message: "No tienes permiso para acceder a esta parcela" });
      }

      const analyses = await storage.getSoilAnalysisByParcel(req.params.id);
      res.json({ analyses });
    } catch (error) {
      console.error("Error fetching soil analysis:", error);
      res.status(500).json({ message: "Error al obtener análisis de suelo" });
    }
  });

  app.post("/api/parcels/:id/soil-analysis", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) {
        return res.status(404).json({ message: "Parcela no encontrada" });
      }

      const user = req.user as User;
      if (parcel.userId !== user.id && user.role !== "admin") {
        return res.status(403).json({ message: "No tienes permiso para modificar esta parcela" });
      }

      const validationResult = insertSoilAnalysisSchema.safeParse({
        ...req.body,
        ...Object.fromEntries(Object.entries(req.body).filter(([, value]) => value === "").map(([key]) => [key, null])),
        parcelId: req.params.id,
      });

      if (!validationResult.success) {
        return res.status(400).json({
          message: "Datos de análisis inválidos",
          errors: fromZodError(validationResult.error).message,
        });
      }

      const analysis = await storage.createSoilAnalysis(validationResult.data);

      // Generate alerts based on soil analysis values
      const alerts = generateSoilAlerts(analysis, parcel.crop);
      for (const alertData of alerts) {
        await storage.createAlert({
          parcelId: req.params.id,
          ...alertData,
        });
      }

      res.status(201).json({ analysis, alertsGenerated: alerts.length });
    } catch (error) {
      console.error("Error creating soil analysis:", error);
      res.status(500).json({ message: "Error al guardar análisis de suelo" });
    }
  });

  app.delete("/api/soil-analysis/:id", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const deleted = await storage.deleteSoilAnalysis(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Análisis no encontrado" });
      }
      res.json({ message: "Análisis eliminado correctamente" });
    } catch (error) {
      console.error("Error deleting soil analysis:", error);
      res.status(500).json({ message: "Error al eliminar análisis de suelo" });
    }
  });

  // ── Soil Biology endpoints (T172) ──────────────────────────────────────────
  app.get("/api/parcels/:id/soil-biology", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
      const user = req.user as User;
      if (parcel.userId !== user.id && !parcel.isPublic && user.role !== "admin") {
        return res.status(403).json({ message: "Sin permiso para acceder a esta parcela" });
      }
      const records = await storage.getSoilBiologyByParcel(req.params.id);
      res.json({ records: records.map(record => ({ ...record,
        trichodermaFusariumRatio: microbiologyEvidence(record)?.trichodermaFusariumRatio ?? null })) });
    } catch (error) {
      console.error("Error fetching soil biology:", error);
      res.status(500).json({ message: "Error al obtener registros de biología del suelo" });
    }
  });

  app.post("/api/parcels/:id/soil-biology", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
      const user = req.user as User;
      if (parcel.userId !== user.id && user.role !== "admin") {
        return res.status(403).json({ message: "Sin permiso para modificar esta parcela" });
      }
      const result = insertSoilBiologySchema.safeParse({
        ...req.body,
        parcelId: req.params.id,
        userId: user.id,
      });
      if (!result.success) {
        return res.status(400).json({ message: "Datos inválidos", errors: fromZodError(result.error).message });
      }
      if (!hasSoilBiologyIndicator(result.data)) return res.status(400).json({ message: "Captura al menos un indicador biológico." });
      const { record, created } = await saveSoilBiologyRecord(result.data);
      res.status(created ? 201 : 200).json({ record: { ...record,
        trichodermaFusariumRatio: microbiologyEvidence(record)?.trichodermaFusariumRatio ?? null } });
    } catch (error) {
      console.error("Error creating soil biology record:", error);
      res.status(500).json({ message: "Error al guardar registro de biología del suelo" });
    }
  });

  app.patch("/api/parcels/:id/soil-biology/:recordId", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
      const user = req.user as User;
      if (parcel.userId !== user.id && user.role !== "admin") return res.status(403).json({ message: "Sin permiso" });
      const current = await storage.getSoilBiology(req.params.recordId);
      if (!current || current.parcelId !== parcel.id) return res.status(404).json({ message: "Análisis no encontrado" });
      const result = insertSoilBiologySchema.safeParse({ ...current, ...req.body,
        parcelId: parcel.id, userId: current.userId });
      if (!result.success) return res.status(400).json({ message: fromZodError(result.error).message });
      if (!hasSoilBiologyIndicator(result.data)) return res.status(400).json({ message: "Captura al menos un indicador biológico." });
      const { record } = await saveSoilBiologyRecord(result.data, current.id);
      res.json({ record: { ...record, trichodermaFusariumRatio:
        microbiologyEvidence(record)?.trichodermaFusariumRatio ?? null } });
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : "No se pudo actualizar el análisis." });
    }
  });

  // Satellite estimation: extract Sentinel-2 indices and apply pedotransfer functions
  app.post("/api/parcels/:id/soil-biology/estimate-from-satellite", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
      const user = req.user as User;
      if (parcel.userId !== user.id && user.role !== "admin") {
        return res.status(403).json({ message: "Sin permiso para modificar esta parcela" });
      }

      // Build parcel polygon coordinates
      let coordinates: [number, number][] = [];
      if (parcel.polygonCoordinates && Array.isArray(parcel.polygonCoordinates)) {
        coordinates = parcel.polygonCoordinates as [number, number][];
      } else if (parcel.latitude && parcel.longitude) {
        const lat = Number(parcel.latitude);
        const lng = Number(parcel.longitude);
        const offset = 0.005;
        coordinates = [
          [lat - offset, lng - offset],
          [lat - offset, lng + offset],
          [lat + offset, lng + offset],
          [lat + offset, lng - offset],
        ];
      }
      if (coordinates.length === 0) {
        return res.status(422).json({ message: "La parcela no tiene geometría registrada. Añade coordenadas GPS primero." });
      }

      // ── Shared pedotransfer helper ────────────────────────────────────────────
      // Based on: Sainju et al. 2014; Jin et al. 2020; García-Ruiz et al. 2008;
      // Geisseler & Scow 2014; Dose et al. 2015
      const applyPedotransfer = (raw: { ndvi?: number; evi?: number; ndmi?: number; date: string }) => {
        const safeNum = (v: number | undefined | null, fallback = 0) =>
          (v == null || !isFinite(v) || isNaN(v)) ? fallback : v;
        const ndvi    = Math.max(0, Math.min(1, safeNum(raw.ndvi)));
        const evi     = Math.max(0, Math.min(1, safeNum(raw.evi)));
        const ndmi    = Math.max(-1, Math.min(1, safeNum(raw.ndmi)));
        const ndmiPos = Math.max(0, ndmi);
        const mbc = Math.min(800, Math.max(50,  450 * ndvi + 80  * evi + 20));
        const mr  = Math.min(10,  Math.max(0.2, mbc * 0.006 + 0.3 * ndmiPos));
        const bg  = Math.min(650, Math.max(20,  280 * ndvi + 150 * evi + 100 * ndmiPos + 15));
        const nag = Math.min(280, Math.max(15,  bg / 2.2));
        const dna = Math.min(65,  Math.max(3,   40  * ndvi + 20  * evi + 3));
        const src = isGEEAvailable() ? "satellite" : "estimated";
        const note = isGEEAvailable()
          ? `Estimado desde imagen Sentinel-2 del ${raw.date} · NDVI=${ndvi.toFixed(3)} EVI=${evi.toFixed(3)} NDMI=${ndmi.toFixed(3)} · Incertidumbre ±30%`
          : `Estimado con índices simulados del ${raw.date} · NDVI=${ndvi.toFixed(3)} EVI=${evi.toFixed(3)} NDMI=${ndmi.toFixed(3)} · Incertidumbre ±30%`;
        return { ndvi, evi, ndmi, mbc, mr, bg, nag, dna, src, note };
      };

      const { targetDate, dateFrom, dateTo } = req.body as {
        targetDate?: string;
        dateFrom?: string;
        dateTo?: string;
      };
      const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
      const today = new Date();

      // ══════════════════════════════════════════════════════════════════════════
      // MODE A — Period: dateFrom + dateTo → one record per available image
      // ══════════════════════════════════════════════════════════════════════════
      if (dateFrom && dateTo && ISO_RE.test(dateFrom) && ISO_RE.test(dateTo)) {
        const from = new Date(dateFrom);
        const to   = new Date(dateTo) > today ? today : new Date(dateTo);
        if (from >= to) {
          return res.status(422).json({ message: "La fecha de inicio debe ser anterior a la fecha de fin." });
        }
        // Limit to 2 years to avoid runaway GEE requests
        const diffDays = (to.getTime() - from.getTime()) / 86_400_000;
        if (diffDays > 730) {
          return res.status(422).json({ message: "El período máximo permitido es de 2 años." });
        }

        const indicesArr = await getVegetationIndices(
          { coordinates },
          from.toISOString().split("T")[0],
          to.toISOString().split("T")[0]
        );
        if (!indicesArr || indicesArr.length === 0) {
          return res.status(422).json({ message: "No se encontraron imágenes satelitales en ese período. Prueba con un rango más amplio." });
        }

        // Create one record per image (sequential to avoid DB race conditions)
        const createdRecords = [];
        for (const img of indicesArr) {
          const p = applyPedotransfer(img);
          const parsedImgDate = new Date(img.date);
          if (isNaN(parsedImgDate.getTime())) {
            console.warn(`Skipping image with invalid date: ${img.date}`);
            continue;
          }
          const rec = await storage.createSoilBiology({
            parcelId: req.params.id,
            userId: user.id,
            sampleDate: parsedImgDate,
            depthCm: 20,
            dataSource: p.src as "satellite" | "estimated",
            mbc: p.mbc, mr: p.mr, bg: p.bg, nag: p.nag, dnaYield: p.dna,
            notes: p.note,
          });
          createdRecords.push(rec);
        }

        return res.status(201).json({
          mode: "period",
          count: createdRecords.length,
          records: createdRecords,
          summary: {
            dateFrom: from.toISOString().split("T")[0],
            dateTo:   to.toISOString().split("T")[0],
            imagesFound: indicesArr.length,
            source: isGEEAvailable() ? "sentinel2" : "simulated",
          },
        });
      }

      // ══════════════════════════════════════════════════════════════════════════
      // MODE B — Single date: targetDate (±20 days) or latest 90 days
      // ══════════════════════════════════════════════════════════════════════════
      let endDate: Date, startDate: Date;
      if (targetDate && ISO_RE.test(targetDate)) {
        const center = new Date(targetDate);
        startDate = new Date(center); startDate.setDate(center.getDate() - 20);
        endDate   = new Date(center); endDate.setDate(center.getDate() + 20);
        if (endDate > today) endDate = today;
      } else {
        endDate = today;
        startDate = new Date(); startDate.setDate(today.getDate() - 90);
      }

      let indicesArr = await getVegetationIndices(
        { coordinates },
        startDate.toISOString().split("T")[0],
        endDate.toISOString().split("T")[0]
      );
      if (!indicesArr || indicesArr.length === 0) {
        if (!targetDate) {
          startDate.setDate(endDate.getDate() - 180);
          indicesArr = await getVegetationIndices(
            { coordinates },
            startDate.toISOString().split("T")[0],
            endDate.toISOString().split("T")[0]
          );
        }
      }
      if (!indicesArr || indicesArr.length === 0) {
        return res.status(422).json({ message: "No se encontraron imágenes satelitales para esa fecha. Prueba con otra fecha o un rango más amplio." });
      }

      // Pick closest image to targetDate (or most recent)
      let best = indicesArr[indicesArr.length - 1];
      if (targetDate) {
        const centerMs = new Date(targetDate).getTime();
        best = indicesArr.reduce((prev, cur) =>
          Math.abs(new Date(cur.date).getTime() - centerMs) <
          Math.abs(new Date(prev.date).getTime() - centerMs) ? cur : prev
        );
      }
      const parsedBestDate = new Date(best.date);
      if (isNaN(parsedBestDate.getTime())) {
        return res.status(422).json({ message: `Fecha de imagen inválida recibida de satélite: "${best.date}". Intenta con otro rango de fechas.` });
      }
      const p = applyPedotransfer(best);
      const record = await storage.createSoilBiology({
        parcelId: req.params.id,
        userId: user.id,
        sampleDate: parsedBestDate,
        depthCm: 20,
        dataSource: p.src as "satellite" | "estimated",
        mbc: p.mbc, mr: p.mr, bg: p.bg, nag: p.nag, dnaYield: p.dna,
        notes: p.note,
      });

      res.status(201).json({
        mode: "single",
        record,
        satellite: { date: best.date, ndvi: p.ndvi, evi: p.evi, ndmi: p.ndmi, source: isGEEAvailable() ? "sentinel2" : "simulated" },
      });
    } catch (error: any) {
      const msg   = error?.message ?? String(error);
      const code  = error?.code ?? error?.cause?.code ?? "";
      const stack = error?.stack ?? "";
      console.error(
        `[soil-biology/estimate-from-satellite] 500 — parcel=${req.params.id} user=${(req.user as any)?.id}\n` +
        `  message: ${msg}\n  pgCode: ${code}\n  stack: ${stack}`
      );
      res.status(500).json({ message: "Error al estimar parámetros desde satélite", detail: msg });
    }
  });

  // Parcel-scoped delete (canonical endpoint) — authorization by parcel ownership/admin,
  // then deletes by record id only so admins and parcel owners can remove any record.
  app.delete("/api/parcels/:parcelId/soil-biology/:recordId", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.parcelId);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
      const user = req.user as User;
      if (parcel.userId !== user.id && user.role !== "admin") {
        return res.status(403).json({ message: "Sin permiso para modificar esta parcela" });
      }
      // Confirm the record belongs to this parcel before deleting
      const record = await storage.getSoilBiology(req.params.recordId);
      if (!record || record.parcelId !== req.params.parcelId) {
        return res.status(404).json({ message: "Registro no encontrado en esta parcela" });
      }
      // Delete by id only — parcel-level auth already enforced above
      const deleted = await storage.deleteSoilBiologyById(req.params.recordId);
      if (!deleted) return res.status(404).json({ message: "Registro no encontrado" });
      res.json({ message: "Registro eliminado correctamente" });
    } catch (error) {
      console.error("Error deleting soil biology:", error);
      res.status(500).json({ message: "Error al eliminar registro" });
    }
  });

  // Legacy non-scoped delete (backward compat — still validates ownership via userId)
  app.delete("/api/soil-biology/:id", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const user = req.user as User;
      const deleted = await storage.deleteSoilBiology(req.params.id, user.id);
      if (!deleted) return res.status(404).json({ message: "Registro no encontrado o sin permiso" });
      res.json({ message: "Registro eliminado correctamente" });
    } catch (error) {
      console.error("Error deleting soil biology:", error);
      res.status(500).json({ message: "Error al eliminar registro" });
    }
  });

  // CSV export of all soil biology records for a parcel
  app.get("/api/parcels/:id/soil-biology/export", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
      const user = req.user as User;
      if (parcel.userId !== user.id && !parcel.isPublic && user.role !== "admin") {
        return res.status(403).json({ message: "Sin permiso" });
      }
      const records = await storage.getSoilBiologyByParcel(req.params.id);
      const header = "id,fecha_muestreo,profundidad_cm,fuente,mbc_ug_C_g,mr_ug_C_g_d,bg_nmol_g_h,nag_nmol_g_h,dna_yield_ug_g,notas\n";
      const rows = records.map(r =>
        [
          r.id,
          new Date(r.sampleDate).toISOString().split("T")[0],
          r.depthCm,
          r.dataSource,
          r.mbc ?? "",
          r.mr ?? "",
          r.bg ?? "",
          r.nag ?? "",
          r.dnaYield ?? "",
          (r.notes ?? "").replace(/,/g, ";").replace(/\n/g, " "),
        ].join(",")
      ).join("\n");
      const fileName = `biologia-suelo-${parcel.name.replace(/\s+/g, "-").slice(0, 30)}-${new Date().toISOString().split("T")[0]}.csv`;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      res.send("\uFEFF" + header + rows); // BOM for Excel UTF-8 compatibility
    } catch (error) {
      console.error("Error exporting soil biology CSV:", error);
      res.status(500).json({ message: "Error al exportar datos" });
    }
  });

  app.get("/api/parcels/:id/report", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
      const user = req.user as User;
      if (parcel.userId !== user.id && !parcel.isPublic && user.role !== "admin") {
        return res.status(403).json({ message: "Sin permiso" });
      }
      const [soilBiologyRecords, soilAnalyses, tillagePractices, cropRotations, parcelData, alerts] = await Promise.all([
        storage.getSoilBiologyByParcel(req.params.id),
        storage.getSoilAnalysisByParcel(req.params.id),
        storage.getTillagePracticesByParcel(req.params.id),
        storage.getCropRotationByParcel(req.params.id),
        storage.getParcelData(req.params.id),
        storage.getAlertsByParcel(req.params.id),
      ]);
      res.json({
        parcel: { id: parcel.id, name: parcel.name, crop: parcel.crop, area: parcel.area, location: parcel.location },
        generatedAt: new Date().toISOString(),
        soilBiology: soilBiologyRecords,
        soilAnalysis: soilAnalyses,
        tillagePractices,
        cropRotations,
        parcelDataCount: parcelData.length,
        latestNdvi: parcelData[0]?.ndvi ?? null,
        recentAlerts: alerts.slice(0, 10),
      });
    } catch (error) {
      console.error("Error generating parcel report:", error);
      res.status(500).json({ message: "Error al generar informe" });
    }
  });

  app.post("/api/soil-biology/:id/interpret", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const record = await storage.getSoilBiology(req.params.id);
      if (!record) return res.status(404).json({ message: "Registro no encontrado" });

      // Authorization: verify requester owns the parcel or is admin
      const parcel = await storage.getParcel(record.parcelId);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
      const user = req.user as User;
      if (parcel.userId !== user.id && user.role !== "admin") {
        return res.status(403).json({ message: "Sin permiso para interpretar este registro" });
      }

      // Fetch management practices to enrich AI context
      const [tillagePractices, cropRotation, animalIntegration] = await Promise.all([
        storage.getTillagePracticesByParcel(record.parcelId),
        storage.getCropRotationByParcel(record.parcelId),
        storage.getAnimalIntegrationByParcel(record.parcelId),
      ]);

      const { crop } = req.body;
      const cropName = crop || parcel.crop || "cultivo no especificado";

      const mbcVal = record.mbc ? parseFloat(String(record.mbc)) : null;
      const mrVal = record.mr ? parseFloat(String(record.mr)) : null;
      const bgVal = record.bg ? parseFloat(String(record.bg)) : null;
      const nagVal = record.nag ? parseFloat(String(record.nag)) : null;
      const dnaVal = record.dnaYield ? parseFloat(String(record.dnaYield)) : null;

      // Build management practices context using correct schema fields
      const latestTillage = tillagePractices[0];
      const latestRotation = cropRotation.slice(0, 2);
      const animals = animalIntegration;

      // Derive animal types from boolean flags
      const animalTypes: string[] = [];
      if (animals?.hasBovinos) animalTypes.push("bovinos");
      if (animals?.hasOvinos) animalTypes.push("ovinos");
      if (animals?.hasCaprinos) animalTypes.push("caprinos");
      if (animals?.hasAves) animalTypes.push("aves");
      if (animals?.hasPorcinos) animalTypes.push("porcinos");
      if (animals?.hasEquinos) animalTypes.push("equinos");
      if (animals?.otherAnimals) animalTypes.push(animals.otherAnimals);

      // Derive rotation crops from cropSequence (T154) or legacy fields
      const rotationCrops = latestRotation.flatMap(r => {
        if (Array.isArray(r.cropSequence)) {
          return (r.cropSequence as Array<{ crop?: string }>).map(e => e.crop).filter(Boolean);
        }
        return [r.springCrops, r.fallCrops].filter(Boolean);
      }).slice(0, 4);

      const practicesSection = [
        latestTillage ? `- Labranza: ${latestTillage.cycleSeason || "no especificada"}, ciclo ${latestTillage.cycleYear}, rastreos: ${latestTillage.rastra ?? 0}, barbecho: ${latestTillage.barbecho ?? 0} pases, quema: ${latestTillage.burnsResidues ? "sí" : "no"}, rastrojo dejado: ${latestTillage.residuePercentLeft ?? "?"}%` : "",
        rotationCrops.length > 0 ? `- Rotación reciente: ${rotationCrops.join(" → ")}` : "",
        animals && animalTypes.length > 0 ? `- Integración animal: ${animalTypes.join(", ")}, sistema: ${animals.grazingSystem || "no especificado"}, carga: ${animals.animalLoadPerHa ?? "?"} cabezas/ha` : "",
        animals?.manureUse?.length ? `- Uso de estiércol: ${animals.manureUse.join(", ")}` : "",
      ].filter(Boolean).join("\n");

      const dataSourceNote: Record<string, string> = {
        lab: "análisis de laboratorio (alta confiabilidad)",
        nir: "espectroscopía NIR (confiabilidad moderada, requiere calibración local)",
        mir: "espectroscopía MIR (confiabilidad moderada-alta con calibración adecuada)",
        estimated: "estimado (baja confiabilidad, usar como referencia orientativa)",
      };

      const prompt = `Eres un experto en biología y microbiología del suelo para agricultura regenerativa en Latinoamérica.
Analiza los indicadores biológicos del suelo para una parcela de ${cropName} y proporciona una interpretación agronómica práctica en español.

DATOS DE LA MUESTRA:
- Fecha: ${record.sampleDate ? new Date(String(record.sampleDate)).toLocaleDateString("es-MX") : "no especificada"}
- Profundidad: ${record.depthCm ?? 20} cm
- Fuente de datos: ${dataSourceNote[record.dataSource ?? "lab"] ?? record.dataSource}
${mbcVal !== null ? `- Biomasa Microbiana del Carbono (MBC): ${mbcVal} μg C g⁻¹ suelo (referencia: >300 bueno, >600 excelente)` : ""}
${mrVal !== null ? `- Respiración Microbiana (MR): ${mrVal} μg C g⁻¹ d⁻¹ (referencia: >2.0 bueno, >5.0 excelente)` : ""}
${bgVal !== null ? `- β-Glucosidasa (BG): ${bgVal} nmol g⁻¹ h⁻¹ (referencia: >150 bueno, >400 excelente)` : ""}
${nagVal !== null ? `- N-Acetil-Glucosaminidasa (NAG): ${nagVal} nmol g⁻¹ h⁻¹ (referencia: >80 bueno, >200 excelente)` : ""}
${dnaVal !== null ? `- Rendimiento de ADN metagenómico: ${dnaVal} μg ADN g⁻¹ (referencia: >30 bueno, >60 excelente)` : ""}
${mbcVal !== null && mrVal !== null ? `- Cociente metabólico (qMR = MR/MBC): ${(mrVal / mbcVal).toFixed(4)} (valor bajo = comunidad eficiente; >0.02 indica estrés)` : ""}
${bgVal !== null && nagVal !== null ? `- Relación BG/NAG: ${(bgVal / nagVal).toFixed(2)} (1–3 = equilibrio C:N óptimo; <1 = exceso N relativo; >3 = limitación N)` : ""}

PRÁCTICAS DE MANEJO DE LA PARCELA:
${practicesSection || "- Sin prácticas de manejo registradas"}

Proporciona un análisis estructurado:
1. Estado biológico general (1-2 oraciones directas)
2. Puntos fuertes detectados (si los hay)
3. Áreas de atención prioritarias basadas en los valores registrados y las prácticas de manejo
4. 2-3 recomendaciones concretas de manejo regenerativo (bioinsumos, cobertura vegetal, rotaciones, enmiendas orgánicas) considerando las prácticas actuales

Sé conciso y práctico. Máximo 300 palabras. Evita tecnicismos innecesarios.`;

      const OpenAI = (await import("openai")).default;
      const oaiClient = new OpenAI({
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
        ...(process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ? { baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL } : {}),
      });
      const completion = await oaiClient.chat.completions.create({
        model: "gpt-5.4",
        messages: [{ role: "user", content: prompt }],
        max_completion_tokens: 600,
      });
      const interpretation = completion.choices[0]?.message?.content ?? "No se pudo generar interpretación.";

      const updated = await storage.updateSoilBiologyInterpretation(req.params.id, interpretation);
      res.json({ record: updated, interpretation });
    } catch (error) {
      console.error("Error interpreting soil biology:", error);
      res.status(500).json({ message: "Error al generar interpretación" });
    }
  });

  app.get("/api/parcels/:id/history/indices", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
      const user = req.user as User;
      if (parcel.userId !== user.id && !parcel.isPublic && user.role !== "admin") {
        return res.status(403).json({ message: "Sin permiso" });
      }
      const rawData = await storage.getParcelData(req.params.id);
      let data = [...rawData].reverse();
      const desde = req.query.desde as string | undefined;
      const hasta = req.query.hasta as string | undefined;
      const campaignYear = req.query.campaignYear as string | undefined;
      if (desde) {
        const desdeMs = new Date(desde).getTime();
        data = data.filter(d => new Date(d.date).getTime() >= desdeMs);
      }
      if (hasta) {
        const hastaEnd = new Date(hasta);
        hastaEnd.setHours(23, 59, 59, 999);
        data = data.filter(d => new Date(d.date).getTime() <= hastaEnd.getTime());
      }
      if (campaignYear) {
        const yr = parseInt(campaignYear, 10);
        if (!isNaN(yr)) {
          data = data.filter(d => new Date(d.date).getFullYear() === yr);
        }
      }
      const normalized = data.map(d => ({
        id: d.id,
        date: d.date,
        ndvi: d.ndvi != null ? parseFloat(String(d.ndvi)) : null,
        evi: d.evi != null ? parseFloat(String(d.evi)) : null,
        soilMoisture: d.soilMoisture != null ? parseFloat(String(d.soilMoisture)) : null,
        temperature: d.temperature != null ? parseFloat(String(d.temperature)) : null,
        precipitation: d.precipitation != null ? parseFloat(String(d.precipitation)) : null,
      }));
      res.json({ data: normalized });
    } catch (error) {
      console.error("Error fetching history indices:", error);
      res.status(500).json({ message: "Error al obtener historial de índices" });
    }
  });

  app.get("/api/parcels/:id/history/soil", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
      const user = req.user as User;
      if (parcel.userId !== user.id && !parcel.isPublic && user.role !== "admin") {
        return res.status(403).json({ message: "Sin permiso" });
      }
      const rawAnalyses = await storage.getSoilAnalysisByParcel(req.params.id);
      const { desde, hasta, campaignYear } = req.query as Record<string, string | undefined>;
      const filtered = rawAnalyses.filter(a => {
        const d = a.analysisDate instanceof Date ? a.analysisDate : new Date(String(a.analysisDate));
        const dateStr = d.toISOString().slice(0, 10);
        if (desde && dateStr < desde) return false;
        if (hasta && dateStr > hasta) return false;
        if (campaignYear && campaignYear !== "all" && d.getFullYear() !== parseInt(campaignYear)) return false;
        return true;
      });
      const analyses = [...filtered].reverse();
      const NUTRIENT_FIELDS = [
        "organicMatter", "totalCarbon", "nitrogenTotal", "phosphorus", "potassium",
        "calcium", "magnesium", "sulfur", "ph", "electricConductivity", "cec",
        "iron", "zinc", "manganese", "copper", "boron", "sand", "silt", "clay",
      ] as const;
      const result = analyses.map((a, i) => {
        const delta: Record<string, number | null> = {};
        if (i > 0) {
          const prev = analyses[i - 1];
          for (const field of NUTRIENT_FIELDS) {
            const curr = (a as Record<string, unknown>)[field] != null
              ? parseFloat(String((a as Record<string, unknown>)[field]))
              : null;
            const prevVal = (prev as Record<string, unknown>)[field] != null
              ? parseFloat(String((prev as Record<string, unknown>)[field]))
              : null;
            if (curr !== null && prevVal !== null && prevVal !== 0) {
              delta[field] = parseFloat((((curr - prevVal) / Math.abs(prevVal)) * 100).toFixed(1));
            } else {
              delta[field] = null;
            }
          }
        }
        return {
          id: a.id,
          analysisDate: a.analysisDate,
          labName: a.labName,
          notes: a.notes,
          organicMatter: a.organicMatter != null ? parseFloat(String(a.organicMatter)) : null,
          totalCarbon: a.totalCarbon != null ? parseFloat(String(a.totalCarbon)) : null,
          nitrogenTotal: a.nitrogenTotal != null ? parseFloat(String(a.nitrogenTotal)) : null,
          phosphorus: a.phosphorus != null ? parseFloat(String(a.phosphorus)) : null,
          potassium: a.potassium != null ? parseFloat(String(a.potassium)) : null,
          calcium: a.calcium != null ? parseFloat(String(a.calcium)) : null,
          magnesium: a.magnesium != null ? parseFloat(String(a.magnesium)) : null,
          sulfur: a.sulfur != null ? parseFloat(String(a.sulfur)) : null,
          ph: a.ph != null ? parseFloat(String(a.ph)) : null,
          electricConductivity: a.electricConductivity != null ? parseFloat(String(a.electricConductivity)) : null,
          cec: a.cec != null ? parseFloat(String(a.cec)) : null,
          iron: a.iron != null ? parseFloat(String(a.iron)) : null,
          zinc: a.zinc != null ? parseFloat(String(a.zinc)) : null,
          manganese: a.manganese != null ? parseFloat(String(a.manganese)) : null,
          copper: a.copper != null ? parseFloat(String(a.copper)) : null,
          boron: a.boron != null ? parseFloat(String(a.boron)) : null,
          sand: a.sand != null ? parseFloat(String(a.sand)) : null,
          silt: a.silt != null ? parseFloat(String(a.silt)) : null,
          clay: a.clay != null ? parseFloat(String(a.clay)) : null,
          delta,
        };
      });
      res.json({ analyses: result });
    } catch (error) {
      console.error("Error fetching soil history:", error);
      res.status(500).json({ message: "Error al obtener historial de suelo" });
    }
  });

  // =====================
  // WATER ANALYSIS
  // =====================

  app.get("/api/parcels/:id/water-analysis", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
      const user = req.user as User;
      if (parcel.userId !== user.id && !parcel.isPublic && user.role !== "admin") {
        return res.status(403).json({ message: "Sin permiso" });
      }
      const analyses = await storage.getWaterAnalysisByParcel(req.params.id);
      res.json({ analyses });
    } catch (error) {
      console.error("Error fetching water analysis:", error);
      res.status(500).json({ message: "Error al obtener análisis de agua" });
    }
  });

  app.post("/api/parcels/:id/water-analysis", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
      const user = req.user as User;
      if (parcel.userId !== user.id && user.role !== "admin") {
        return res.status(403).json({ message: "Sin permiso" });
      }
      const validationResult = insertWaterAnalysisSchema.safeParse({
        ...req.body,
        parcelId: req.params.id,
      });
      if (!validationResult.success) {
        return res.status(400).json({
          message: "Datos de análisis inválidos",
          errors: fromZodError(validationResult.error).message,
        });
      }
      const analysis = await storage.createWaterAnalysis(validationResult.data);
      // Generate and persist water quality alerts (FAO 29 thresholds)
      const waterAlerts = generateWaterAlerts(analysis);
      for (const alertData of waterAlerts) {
        await storage.createAlert({ parcelId: req.params.id, ...alertData });
      }
      res.status(201).json({ analysis, alertsGenerated: waterAlerts.length });
    } catch (error) {
      console.error("Error creating water analysis:", error);
      res.status(500).json({ message: "Error al guardar análisis de agua" });
    }
  });

  app.delete("/api/parcels/:id/water-analysis/:aid", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcelId = req.params.id;
      const analysisId = req.params.aid;
      const userId = (req.user as any)?.id;
      const isAdmin = (req.user as any)?.role === "admin";
      // Verify parcel ownership before deleting
      const parcel = await storage.getParcel(parcelId);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
      if (!isAdmin && parcel.userId !== userId) {
        return res.status(403).json({ message: "No tienes permiso para modificar esta parcela" });
      }
      const deleted = await storage.deleteWaterAnalysis(analysisId, parcelId);
      if (!deleted) return res.status(404).json({ message: "Análisis no encontrado" });
      res.json({ message: "Análisis de agua eliminado correctamente" });
    } catch (error) {
      console.error("Error deleting water analysis:", error);
      res.status(500).json({ message: "Error al eliminar análisis de agua" });
    }
  });

  // Plant Tissue Analysis endpoints
  app.get("/api/parcels/:id/tissue-analysis", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
      const userId = (req.user as any)?.id;
      const isAdmin = (req.user as any)?.role === "admin";
      if (!isAdmin && parcel.userId !== userId) return res.status(403).json({ message: "Sin permiso" });
      const records = await storage.getPlantTissueAnalysisByParcel(req.params.id);
      res.json({ records });
    } catch (error) {
      res.status(500).json({ message: "Error al obtener análisis de tejidos" });
    }
  });

  app.post("/api/parcels/:id/tissue-analysis", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
      const userId = (req.user as any)?.id;
      const isAdmin = (req.user as any)?.role === "admin";
      if (!isAdmin && parcel.userId !== userId) return res.status(403).json({ message: "Sin permiso" });
      const { insertPlantTissueAnalysisSchema } = await import("@shared/schema");
      const parsed = insertPlantTissueAnalysisSchema.safeParse({ ...req.body, parcelId: req.params.id, userId });
      if (!parsed.success) return res.status(400).json({ message: "Datos inválidos", errors: parsed.error.flatten() });
      const record = await storage.createPlantTissueAnalysis(parsed.data);
      res.status(201).json({ record });
    } catch (error) {
      console.error("Error creating tissue analysis:", error);
      res.status(500).json({ message: "Error al guardar análisis de tejidos" });
    }
  });

  app.delete("/api/parcels/:id/tissue-analysis/:aid", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
      const userId = (req.user as any)?.id;
      const isAdmin = (req.user as any)?.role === "admin";
      if (!isAdmin && parcel.userId !== userId) return res.status(403).json({ message: "Sin permiso" });
      const deleted = await storage.deletePlantTissueAnalysis(req.params.aid, req.params.id);
      if (!deleted) return res.status(404).json({ message: "Registro no encontrado" });
      res.json({ message: "Análisis eliminado" });
    } catch (error) {
      res.status(500).json({ message: "Error al eliminar análisis de tejidos" });
    }
  });

  // =====================
  // SURVEY MODULES - Tillage, Crop Rotation, Animals, Livelihood
  // =====================

  // Tillage Practices endpoints
  app.get("/api/parcels/:id/tillage", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) {
        return res.status(404).json({ message: "Parcela no encontrada" });
      }
      const user = req.user as User;
      if (parcel.userId !== user.id && !parcel.isPublic && user.role !== "admin") {
        return res.status(403).json({ message: "Sin permiso para ver esta parcela" });
      }
      const practices = await storage.getTillagePracticesByParcel(req.params.id);
      res.json({ practices });
    } catch (error) {
      console.error("Error fetching tillage practices:", error);
      res.status(500).json({ message: "Error al obtener prácticas de labranza" });
    }
  });

  app.post("/api/parcels/:id/tillage", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) {
        return res.status(404).json({ message: "Parcela no encontrada" });
      }
      const user = req.user as User;
      if (parcel.userId !== user.id && user.role !== "admin") {
        return res.status(403).json({ message: "Sin permiso para modificar esta parcela" });
      }
      const practice = await storage.createTillagePractices({ ...req.body, parcelId: req.params.id });
      res.status(201).json({ practice });
    } catch (error) {
      console.error("Error creating tillage practices:", error);
      res.status(500).json({ message: "Error al guardar prácticas de labranza" });
    }
  });

  app.put("/api/tillage/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const practice = await storage.updateTillagePractices(req.params.id, req.body);
      if (!practice) {
        return res.status(404).json({ message: "Registro no encontrado" });
      }
      res.json({ practice });
    } catch (error) {
      console.error("Error updating tillage practices:", error);
      res.status(500).json({ message: "Error al actualizar prácticas de labranza" });
    }
  });

  app.delete("/api/tillage/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const deleted = await storage.deleteTillagePractices(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Registro no encontrado" });
      }
      res.json({ message: "Registro eliminado correctamente" });
    } catch (error) {
      console.error("Error deleting tillage practices:", error);
      res.status(500).json({ message: "Error al eliminar prácticas de labranza" });
    }
  });

  // Crop Rotation endpoints
  app.get("/api/parcels/:id/rotation", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) {
        return res.status(404).json({ message: "Parcela no encontrada" });
      }
      const user = req.user as User;
      if (parcel.userId !== user.id && !parcel.isPublic && user.role !== "admin") {
        return res.status(403).json({ message: "Sin permiso para ver esta parcela" });
      }
      const rotations = await storage.getCropRotationByParcel(req.params.id);
      res.json({ rotations });
    } catch (error) {
      console.error("Error fetching crop rotation:", error);
      res.status(500).json({ message: "Error al obtener rotación de cultivos" });
    }
  });

  // T154: Sequence endpoint with monoculture detection
  app.get("/api/parcels/:id/rotation/sequence", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
      const user = req.user as User;
      if (parcel.userId !== user.id && !parcel.isPublic && user.role !== "admin") {
        return res.status(403).json({ message: "Sin permiso" });
      }
      const rotations = await storage.getCropRotationByParcel(req.params.id);

      // Helper: resolve canonical year from a rotation record
      // campaignYear (T154) takes precedence over legacy year field
      const effectiveYearOf = (r: (typeof rotations)[number]) => r.campaignYear ?? r.year;

      // Sort ascending by effective (canonical) year for analysis
      const sorted = [...rotations].sort((a, b) => effectiveYearOf(a) - effectiveYearOf(b));

      // Build flat (effectiveYear, primaryCrop) tuples for monoculture analysis
      const yearCrops: { year: number; primaryCrop: string | null }[] = sorted.map((r) => {
        const effectiveYear = effectiveYearOf(r);
        let primary: string | null = null;
        if (Array.isArray(r.cropSequence) && r.cropSequence.length > 0) {
          const first = r.cropSequence[0];
          if (first && typeof first === "object" && "crop" in first && typeof (first as { crop: unknown }).crop === "string") {
            primary = (first as { crop: string }).crop;
          }
        }
        if (!primary) primary = r.springCrops ?? r.fallCrops ?? null;
        return { year: effectiveYear, primaryCrop: primary };
      });

      // Detect monoculture: same primary crop ≥ 3 CONSECUTIVE calendar years
      // (year gap must be exactly 1 between adjacent records using effectiveYear)
      const monocultivoYears = new Set<number>();
      for (let i = 2; i < yearCrops.length; i++) {
        const c = yearCrops[i].primaryCrop?.toLowerCase().trim();
        if (!c) continue;
        const yearsAreConsecutive =
          yearCrops[i].year === yearCrops[i - 1].year + 1 &&
          yearCrops[i - 1].year === yearCrops[i - 2].year + 1;
        if (
          yearsAreConsecutive &&
          yearCrops[i - 1].primaryCrop?.toLowerCase().trim() === c &&
          yearCrops[i - 2].primaryCrop?.toLowerCase().trim() === c
        ) {
          monocultivoYears.add(yearCrops[i - 2].year);
          monocultivoYears.add(yearCrops[i - 1].year);
          monocultivoYears.add(yearCrops[i].year);
        }
      }

      // Annotate each record using effectiveYear so flag matches detection set
      const sequence = sorted.map((r) => ({
        ...r,
        monocultivo: monocultivoYears.has(effectiveYearOf(r)),
      }));

      // Determine global regenerative status
      const hasMonocultivo = monocultivoYears.size > 0;
      const lastPrimary = yearCrops[yearCrops.length - 1]?.primaryCrop;
      const prevPrimary = yearCrops[yearCrops.length - 2]?.primaryCrop;
      const twoYearRepeat = lastPrimary && prevPrimary &&
        lastPrimary.toLowerCase() === prevPrimary.toLowerCase();

      const status = hasMonocultivo ? "rojo" : twoYearRepeat ? "amarillo" : "verde";

      res.json({ sequence, status });
    } catch (error) {
      console.error("Error fetching rotation sequence:", error);
      res.status(500).json({ message: "Error al obtener secuencia de rotación" });
    }
  });

  app.post("/api/parcels/:id/rotation", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) {
        return res.status(404).json({ message: "Parcela no encontrada" });
      }
      const user = req.user as User;
      if (parcel.userId !== user.id && user.role !== "admin") {
        return res.status(403).json({ message: "Sin permiso para modificar esta parcela" });
      }
      const rotation = await storage.createCropRotation({ ...req.body, parcelId: req.params.id });
      res.status(201).json({ rotation });
    } catch (error) {
      console.error("Error creating crop rotation:", error);
      res.status(500).json({ message: "Error al guardar rotación de cultivos" });
    }
  });

  // T154: Owner-scoped PUT/DELETE
  app.put("/api/parcels/:id/rotation/:recordId", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
      const user = req.user as User;
      if (parcel.userId !== user.id && user.role !== "admin") return res.status(403).json({ message: "Sin permiso" });
      const rotation = await storage.updateCropRotationByOwner(req.params.recordId, req.params.id, req.body);
      if (!rotation) return res.status(404).json({ message: "Registro no encontrado" });
      res.json({ rotation });
    } catch (error) {
      console.error("Error updating crop rotation:", error);
      res.status(500).json({ message: "Error al actualizar rotación de cultivos" });
    }
  });

  app.delete("/api/parcels/:id/rotation/:recordId", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
      const user = req.user as User;
      if (parcel.userId !== user.id && user.role !== "admin") return res.status(403).json({ message: "Sin permiso" });
      const deleted = await storage.deleteCropRotationByOwner(req.params.recordId, req.params.id);
      if (!deleted) return res.status(404).json({ message: "Registro no encontrado" });
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting crop rotation:", error);
      res.status(500).json({ message: "Error al eliminar rotación de cultivos" });
    }
  });

  app.put("/api/rotation/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const rotation = await storage.updateCropRotation(req.params.id, req.body);
      if (!rotation) {
        return res.status(404).json({ message: "Registro no encontrado" });
      }
      res.json({ rotation });
    } catch (error) {
      console.error("Error updating crop rotation:", error);
      res.status(500).json({ message: "Error al actualizar rotación de cultivos" });
    }
  });

  app.delete("/api/rotation/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const deleted = await storage.deleteCropRotation(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Registro no encontrado" });
      }
      res.json({ message: "Registro eliminado correctamente" });
    } catch (error) {
      console.error("Error deleting crop rotation:", error);
      res.status(500).json({ message: "Error al eliminar rotación de cultivos" });
    }
  });

  // Animal Integration endpoints
  app.get("/api/parcels/:id/animals", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) {
        return res.status(404).json({ message: "Parcela no encontrada" });
      }
      const user = req.user as User;
      if (parcel.userId !== user.id && !parcel.isPublic && user.role !== "admin") {
        return res.status(403).json({ message: "Sin permiso para ver esta parcela" });
      }
      const animals = await storage.getAnimalIntegrationByParcel(req.params.id);
      res.json({ animals });
    } catch (error) {
      console.error("Error fetching animal integration:", error);
      res.status(500).json({ message: "Error al obtener integración animal" });
    }
  });

  app.post("/api/parcels/:id/animals", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) {
        return res.status(404).json({ message: "Parcela no encontrada" });
      }
      const user = req.user as User;
      if (parcel.userId !== user.id && user.role !== "admin") {
        return res.status(403).json({ message: "Sin permiso para modificar esta parcela" });
      }
      // Check if already exists, if so update instead
      const existing = await storage.getAnimalIntegrationByParcel(req.params.id);
      if (existing) {
        const animals = await storage.updateAnimalIntegration(existing.id, req.body);
        return res.json({ animals });
      }
      const animals = await storage.createAnimalIntegration({ ...req.body, parcelId: req.params.id });
      res.status(201).json({ animals });
    } catch (error) {
      console.error("Error creating animal integration:", error);
      res.status(500).json({ message: "Error al guardar integración animal" });
    }
  });

  // Livelihood endpoints
  app.get("/api/parcels/:id/livelihood", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) {
        return res.status(404).json({ message: "Parcela no encontrada" });
      }
      const user = req.user as User;
      if (parcel.userId !== user.id && !parcel.isPublic && user.role !== "admin") {
        return res.status(403).json({ message: "Sin permiso para ver esta parcela" });
      }
      const livelihood = await storage.getLivelihoodByParcel(req.params.id);
      res.json({ livelihood });
    } catch (error) {
      console.error("Error fetching livelihood:", error);
      res.status(500).json({ message: "Error al obtener medios de vida" });
    }
  });

  app.post("/api/parcels/:id/livelihood", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) {
        return res.status(404).json({ message: "Parcela no encontrada" });
      }
      const user = req.user as User;
      if (parcel.userId !== user.id && user.role !== "admin") {
        return res.status(403).json({ message: "Sin permiso para modificar esta parcela" });
      }
      // Check if already exists, if so update instead
      const existing = await storage.getLivelihoodByParcel(req.params.id);
      if (existing) {
        const livelihood = await storage.updateLivelihood(existing.id, req.body);
        return res.json({ livelihood });
      }
      const livelihood = await storage.createLivelihood({ ...req.body, parcelId: req.params.id });
      res.status(201).json({ livelihood });
    } catch (error) {
      console.error("Error creating livelihood:", error);
      res.status(500).json({ message: "Error al guardar medios de vida" });
    }
  });

  // ============ Production Costs Routes ============
  app.get("/api/parcels/:id/costs", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
      const user = req.user as User;
      if (parcel.userId !== user.id && user.role !== "admin") {
        return res.status(403).json({ message: "No tienes acceso a esta parcela" });
      }
      await storage.promoteLegacyFieldLogs(parcel.userId, parcel.id);
      const [manualCosts, entries, cycle] = await Promise.all([
        storage.getProductionCostsByParcel(parcel.id),
        storage.getActiveFieldLogs(parcel.userId, parcel.id),
        storage.getLatestCropCycleDetail(parcel.id),
      ]);
      const costs = projectParcelCosts(manualCosts, entries, cycle);
      res.json({ costs, economy: summarizeParcelEconomy(costs, cycle?.totalPlannedCost) });
    } catch (error) {
      console.error("Error fetching costs:", error);
      res.status(500).json({ message: "Error al obtener costos" });
    }
  });

  app.post("/api/parcels/:id/costs", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
      const user = req.user as User;
      if (parcel.userId !== user.id && user.role !== "admin") {
        return res.status(403).json({ message: "No tienes acceso a esta parcela" });
      }
      const data = { ...req.body, parcelId: req.params.id };
      const result = insertProductionCostSchema.safeParse(data);
      if (!result.success) {
        return res.status(400).json({ message: fromZodError(result.error).message });
      }
      const cost = await storage.createProductionCost(result.data);
      res.json({ cost });
    } catch (error) {
      console.error("Error creating cost:", error);
      res.status(500).json({ message: "Error al guardar costo" });
    }
  });

  app.delete("/api/parcels/:id/costs/:costId", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
      const user = req.user as User;
      if (parcel.userId !== user.id && user.role !== "admin") {
        return res.status(403).json({ message: "No tienes acceso a esta parcela" });
      }
      const deleted = await storage.deleteProductionCost(req.params.costId);
      if (!deleted) return res.status(404).json({ message: "Costo no encontrado" });
      res.json({ message: "Costo eliminado" });
    } catch (error) {
      console.error("Error deleting cost:", error);
      res.status(500).json({ message: "Error al eliminar costo" });
    }
  });

  // Register chat API endpoints
  registerChatEndpoints(app, isAuthenticated, isActiveUser);
  registerWhatsappRoutes(app, storage, isAuthenticated, isActiveUser);
  registerFieldLogRoutes(app, storage, isAuthenticated, isActiveUser);
  registerSoilHealthRoutes(app, storage, soilHealthRepository, isAuthenticated, isActiveUser);
  startSoilHealthCleanup(soilHealthRepository);

  // ============ Community Routes ============

  // Media Upload
  app.post("/api/community/upload", isAuthenticated, isActiveUser, communityUpload.array("files", 5), async (req: any, res) => {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({ message: "No files uploaded" });
    }
    try {
      const urls = await Promise.all(
        files.map(async (f) => {
          const ext = path.extname(f.originalname) || ".jpg";
          const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
          return uploadToPublicStorage(f.buffer, f.mimetype || "image/jpeg", `community/${uniqueName}`);
        }),
      );
      res.json({ urls });
    } catch (err) {
      console.error("[community/upload] Error uploading to Object Storage:", err);
      res.status(500).json({ message: "Error al subir las imágenes" });
    }
  });

  // Shared peer-matching helpers used by both routes below
  const CROP_KEYWORD_MAP: Record<string, string> = {
    soja: "soja", soy: "soja", soybean: "soja",
    maiz: "maíz", maíz: "maíz", corn: "maíz",
    trigo: "trigo", wheat: "trigo",
    girasol: "girasol", sunflower: "girasol",
    algodon: "algodón", algodón: "algodón", cotton: "algodón",
    arroz: "arroz", rice: "arroz",
  };

  function detectCropFromMessage(message: string, userCrops: string[]): string | undefined {
    const normalize = (s: string) =>
      s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const lower = normalize(message);
    for (const [kw, canonical] of Object.entries(CROP_KEYWORD_MAP)) {
      if (lower.includes(normalize(kw))) return canonical;
    }
    return userCrops.find((uc) => lower.includes(normalize(uc)));
  }

  async function fetchPeerMatchesForUser(
    userId: string,
    explicitCrop?: string,
    messageText?: string,
    limit = 3,
  ): Promise<{ matches: PeerMatch[]; userCrops: string[]; resolvedCrop: string | null; isFallback: boolean }> {
    const allParcels = await storage.getParcelsByUser(userId);
    const userCrops = Array.from(new Set(allParcels.map((p) => p.crop)));
    const detectedCrop = messageText ? detectCropFromMessage(messageText, userCrops) : undefined;

    // If a specific crop was requested (explicit param or detected in message) search only that crop
    const manualCrop = (explicitCrop?.trim() || undefined) ?? detectedCrop;
    if (manualCrop) {
      const matches = await storage.getPeerMatches(manualCrop, userId, limit);
      return { matches, userCrops, resolvedCrop: manualCrop, isFallback: false };
    }

    // Auto-mode: try each of the user's crops until we find at least one match
    for (const crop of userCrops) {
      const matches = await storage.getPeerMatches(crop, userId, limit);
      if (matches.length > 0) {
        return { matches, userCrops, resolvedCrop: crop, isFallback: false };
      }
    }

    // No crop or no match for any crop → show top contributors as fallback
    const matches = await storage.getTopContributors(userId, limit);
    return { matches, userCrops, resolvedCrop: null, isFallback: true };
  }

  // Peer match — find community members with same crop + success indicators
  app.get("/api/community/peer-match", isAuthenticated, async (req: any, res) => {
    try {
      const userId: string = req.user.id;
      const explicitCrop = (req.query.crop as string | undefined)?.trim();
      const { matches, userCrops, resolvedCrop, isFallback } = await fetchPeerMatchesForUser(userId, explicitCrop, undefined, 5);
      res.json({ matches, userCrops, resolvedCrop, isFallback });
    } catch (error) {
      console.error("Error fetching peer matches:", error);
      res.status(500).json({ message: "Error al buscar pares" });
    }
  });

  // Community peer advisor — AI chat endpoint
  const chatHistorySchema = zSampling.array(
    zSampling.object({
      role: zSampling.enum(["user", "assistant"]),
      content: zSampling.string().max(4000),
    })
  ).max(20).default([]);

  app.post("/api/community/advisor", isAuthenticated, async (req: any, res) => {
    try {
      const userId: string = req.user.id;
      const { message, crop } = req.body;
      const chatHistoryResult = chatHistorySchema.safeParse(req.body.chatHistory ?? []);
      const chatHistory = chatHistoryResult.success ? chatHistoryResult.data : [];

      if (!message || typeof message !== "string" || message.trim().length === 0) {
        return res.status(400).json({ message: "Mensaje requerido" });
      }

      const { matches, userCrops, resolvedCrop, isFallback } = await fetchPeerMatchesForUser(
        userId,
        typeof crop === "string" ? crop : undefined,
        message.trim(),
      );

      const response = await generatePeerAdvisorResponse(
        message.trim(),
        chatHistory,
        userCrops,
        matches,
        isFallback,
      );

      res.json({ response, matches, userCrops, detectedCrop: resolvedCrop, isFallback });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Error al consultar el asesor";
      console.error("Error in community advisor:", error);
      res.status(500).json({ message: msg });
    }
  });

  // Get community posts feed
  app.get("/api/community/posts", async (req, res) => {
    try {
      const { limit, offset, tag, type, search, authorId } = req.query;
      const posts = await storage.getCommunityPosts({
        limit: limit ? parseInt(limit as string) : 20,
        offset: offset ? parseInt(offset as string) : 0,
        tag: tag as string,
        type: type as string,
        search: search as string,
        authorId: authorId as string,
      });

      const enriched = await Promise.all(posts.map(async (post) => {
        const author = await storage.getUser(post.userId);
        let parcel = null;
        if (post.parcelId) {
          parcel = await storage.getParcel(post.parcelId);
        }
        let userLiked = false;
        if (req.isAuthenticated()) {
          userLiked = await storage.hasUserLiked((req.user as any).id, post.id);
        }
        return {
          ...post,
          author: author ? { id: author.id, name: author.name, role: author.role, avatarUrl: author.avatarUrl } : null,
          parcel: parcel ? { id: parcel.id, name: parcel.name, crop: parcel.crop, area: parcel.area, location: parcel.location } : null,
          userLiked,
        };
      }));

      res.json(enriched);
    } catch (error) {
      console.error("Error fetching community posts:", error);
      res.status(500).json({ message: "Error fetching posts" });
    }
  });

  // Get user's public parcels for sharing
  app.get("/api/community/user-parcels", isAuthenticated, isActiveUser, async (req: any, res) => {
    try {
      const parcels = await storage.getParcelsByUser(req.user.id);
      const publicParcels = parcels.filter((p: any) => p.isPublic);
      res.json(publicParcels);
    } catch (error) {
      console.error("Error fetching user parcels:", error);
      res.status(500).json({ message: "Error fetching parcels" });
    }
  });

  // Create community post
  app.post("/api/community/posts", isAuthenticated, isActiveUser, async (req: any, res) => {
    try {
      const parsed = insertCommunityPostSchema.safeParse({
        ...req.body,
        userId: req.user.id,
      });
      if (!parsed.success) {
        return res.status(400).json({ message: fromZodError(parsed.error).message });
      }
      if (parsed.data.parcelId) {
        const parcel = await storage.getParcel(parsed.data.parcelId);
        if (!parcel || parcel.userId !== req.user.id) {
          return res.status(403).json({ message: "Cannot share a parcel you don't own" });
        }
        if (!parcel.isPublic) {
          return res.status(400).json({ message: "Parcel must be public to share" });
        }
      }
      const post = await storage.createCommunityPost(parsed.data);
      res.status(201).json(post);
    } catch (error) {
      console.error("Error creating community post:", error);
      res.status(500).json({ message: "Error creating post" });
    }
  });

  // Get single community post with comments
  app.get("/api/community/posts/:id", async (req, res) => {
    try {
      const post = await storage.getCommunityPost(req.params.id);
      if (!post) return res.status(404).json({ message: "Post not found" });

      const author = await storage.getUser(post.userId);
      const comments = await storage.getCommunityComments(post.id);

      const enrichedComments = await Promise.all(comments.map(async (comment) => {
        const commentAuthor = await storage.getUser(comment.userId);
        let userLiked = false;
        if (req.isAuthenticated()) {
          userLiked = await storage.hasUserLiked((req.user as any).id, undefined, comment.id);
        }
        return {
          ...comment,
          author: commentAuthor ? { id: commentAuthor.id, name: commentAuthor.name, role: commentAuthor.role, avatarUrl: commentAuthor.avatarUrl } : null,
          userLiked,
        };
      }));

      let parcel = null;
      if (post.parcelId) {
        parcel = await storage.getParcel(post.parcelId);
      }

      let userLiked = false;
      if (req.isAuthenticated()) {
        userLiked = await storage.hasUserLiked((req.user as any).id, post.id);
      }

      res.json({
        ...post,
        author: author ? { id: author.id, name: author.name, role: author.role, avatarUrl: author.avatarUrl } : null,
        parcel,
        comments: enrichedComments,
        userLiked,
      });
    } catch (error) {
      console.error("Error fetching post:", error);
      res.status(500).json({ message: "Error fetching post" });
    }
  });

  // Add comment to post
  app.post("/api/community/posts/:id/comments", isAuthenticated, isActiveUser, async (req: any, res) => {
    try {
      const parsed = insertCommunityCommentSchema.safeParse({
        ...req.body,
        postId: req.params.id,
        userId: req.user.id,
      });
      if (!parsed.success) {
        return res.status(400).json({ message: fromZodError(parsed.error).message });
      }
      const comment = await storage.createCommunityComment(parsed.data);
      const author = await storage.getUser(comment.userId);
      res.status(201).json({
        ...comment,
        author: author ? { id: author.id, name: author.name, role: author.role, avatarUrl: author.avatarUrl } : null,
        userLiked: false,
      });
    } catch (error) {
      console.error("Error creating comment:", error);
      res.status(500).json({ message: "Error creating comment" });
    }
  });

  // Toggle like on post
  app.post("/api/community/posts/:id/like", isAuthenticated, isActiveUser, async (req: any, res) => {
    try {
      const liked = await storage.toggleCommunityLike(req.user.id, req.params.id);
      res.json({ liked });
    } catch (error) {
      console.error("Error toggling like:", error);
      res.status(500).json({ message: "Error toggling like" });
    }
  });

  // Toggle like on comment
  app.post("/api/community/comments/:id/like", isAuthenticated, isActiveUser, async (req: any, res) => {
    try {
      const liked = await storage.toggleCommunityLike(req.user.id, undefined, req.params.id);
      res.json({ liked });
    } catch (error) {
      console.error("Error toggling like:", error);
      res.status(500).json({ message: "Error toggling like" });
    }
  });

  const translateRateLimit = new Map<string, { count: number; resetAt: number }>();
  app.post("/api/community/translate", async (req, res) => {
    try {
      const { texts, targetLang } = req.body;
      if (!texts || !targetLang || !Array.isArray(texts) || texts.length === 0) {
        return res.status(400).json({ message: "texts (array) and targetLang required" });
      }
      if (texts.length > 5) {
        return res.status(400).json({ message: "Maximum 5 texts per request" });
      }
      const totalChars = texts.reduce((sum: number, t: string) => sum + (t?.length || 0), 0);
      if (totalChars > 5000) {
        return res.status(400).json({ message: "Total text length exceeds 5000 characters" });
      }

      const clientIp = (req as any).ip || "unknown";
      const now = Date.now();
      const rateInfo = translateRateLimit.get(clientIp);
      if (rateInfo && rateInfo.resetAt > now) {
        if (rateInfo.count >= 30) {
          return res.status(429).json({ message: "Too many translation requests. Please wait." });
        }
        rateInfo.count++;
      } else {
        translateRateLimit.set(clientIp, { count: 1, resetAt: now + 60000 });
      }

      const langNames: Record<string, string> = {
        es: "Spanish", en: "English", pt: "Portuguese", zh: "Chinese (Simplified)"
      };
      const langName = langNames[targetLang];
      if (!langName) {
        return res.status(400).json({ message: "Unsupported target language" });
      }

      const OpenAI = (await import("openai")).default;
      const openai = new OpenAI({
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
        ...(process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ? { baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL } : {}),
      });

      const numberedTexts = texts.map((t: string, i: number) => `[${i}] ${t}`).join("\n---\n");

      const completion = await openai.chat.completions.create({
        model: "gpt-5.4",
        messages: [
          {
            role: "system",
            content: `You are a translator for an agricultural platform. Translate the following ${texts.length} text(s) to ${langName}. Each text is prefixed with [index]. Return a JSON object with key "translations" containing an array of exactly ${texts.length} translated strings in the same order. Keep agricultural/technical terms accurate. Do not add explanations.`
          },
          { role: "user", content: numberedTexts }
        ],
        response_format: { type: "json_object" },
      });

      const content = completion.choices[0]?.message?.content || "{}";
      let parsed: any;
      try {
        parsed = JSON.parse(content);
      } catch {
        return res.status(500).json({ message: "Translation parse error" });
      }

      const translations = parsed.translations;
      if (!Array.isArray(translations) || translations.length !== texts.length) {
        return res.status(500).json({ message: "Translation format error" });
      }

      res.json({ translations });
    } catch (error: any) {
      console.error("Translation error:", error);
      res.status(500).json({ message: error.message || "Translation failed" });
    }
  });

  app.get("/api/community/stats", async (_req, res) => {
    try {
      const stats = await storage.getCommunityStats();
      res.json(stats);
    } catch (error) {
      console.error("Error fetching community stats:", error);
      res.status(500).json({ message: "Error fetching stats" });
    }
  });

  // Delete community post
  app.delete("/api/community/posts/:id", isAuthenticated, isActiveUser, async (req: any, res) => {
    try {
      const post = await storage.getCommunityPost(req.params.id);
      if (!post) return res.status(404).json({ message: "Post not found" });
      if (post.userId !== req.user.id && req.user.role !== "admin") {
        return res.status(403).json({ message: "Not authorized" });
      }
      await storage.deleteCommunityPost(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting post:", error);
      res.status(500).json({ message: "Error deleting post" });
    }
  });

  // ============ Conference Routes ============

  // Public: List published conferences
  app.get("/api/conferences", async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
      const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;
      const tag = req.query.tag as string | undefined;
      const search = req.query.search as string | undefined;
      const featured = req.query.featured === "true" ? true : req.query.featured === "false" ? false : undefined;

      const conferences = await storage.getConferences({
        limit,
        offset,
        status: "published",
        tag,
        search,
        featured,
      });

      const threadCounts = await storage.getConferenceThreadCounts(conferences.map(c => c.id));
      const conferencesWithThreadCount = conferences.map(conf => ({
        ...conf,
        threadsCount: threadCounts[conf.id] || 0,
      }));
      res.json({ conferences: conferencesWithThreadCount });
    } catch (error) {
      console.error("Error fetching conferences:", error);
      res.status(500).json({ message: "Error al obtener conferencias" });
    }
  });

  // Admin: Create conference
  app.post("/api/conferences", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const body = { ...req.body, createdBy: (req.user as User).id };
      // Auto-fetch OG thumbnail for Facebook videos when no thumbnail provided
      if (body.videoUrl && !body.thumbnailUrl) {
        const ogImage = await fetchOgImage(body.videoUrl);
        if (ogImage) body.thumbnailUrl = ogImage;
      }
      const result = insertConferenceSchema.safeParse(body);
      if (!result.success) {
        return res.status(400).json({ message: fromZodError(result.error).message });
      }

      const conference = await storage.createConference(result.data);
      res.status(201).json({ conference });
    } catch (error) {
      console.error("Error creating conference:", error);
      res.status(500).json({ message: "Error al crear conferencia" });
    }
  });

  // Admin: List ALL conferences (including draft/archived)
  app.get("/api/admin/conferences", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const conferences = await storage.getConferences({});
      res.json({ conferences });
    } catch (error) {
      console.error("Error fetching admin conferences:", error);
      res.status(500).json({ message: "Error al obtener conferencias" });
    }
  });

  // ============ Forum Routes ============
  // NOTE: Forum routes with literal path segments (threads, replies) MUST be registered
  // BEFORE conference routes with :id param to avoid Express matching "threads" as an id.

  // Public: Get single thread with replies
  app.get("/api/conferences/threads/:threadId", async (req, res) => {
    try {
      const thread = await storage.getForumThread(req.params.threadId);
      if (!thread) {
        return res.status(404).json({ message: "Hilo no encontrado" });
      }

      const replies = await storage.getForumReplies(req.params.threadId);

      const allUserIds = Array.from(new Set([thread.userId, ...replies.map(r => r.userId)]));
      const authors: Record<string, any> = {};
      for (const userId of allUserIds) {
        const user = await storage.getUser(userId);
        if (user) {
          const { passwordHash, ...userWithoutPassword } = user;
          authors[userId] = userWithoutPassword;
        }
      }

      res.json({ thread, replies, authors });
    } catch (error) {
      console.error("Error fetching thread:", error);
      res.status(500).json({ message: "Error al obtener hilo del foro" });
    }
  });

  // Auth: Create reply
  app.post("/api/conferences/threads/:threadId/replies", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const thread = await storage.getForumThread(req.params.threadId);
      if (!thread) {
        return res.status(404).json({ message: "Hilo no encontrado" });
      }
      if (thread.isClosed) {
        return res.status(400).json({ message: "Este hilo está cerrado" });
      }

      const result = insertForumReplySchema.safeParse({
        ...req.body,
        threadId: req.params.threadId,
        userId: (req.user as User).id,
      });
      if (!result.success) {
        return res.status(400).json({ message: fromZodError(result.error).message });
      }

      const reply = await storage.createForumReply(result.data);
      res.status(201).json({ reply });
    } catch (error) {
      console.error("Error creating reply:", error);
      res.status(500).json({ message: "Error al crear respuesta" });
    }
  });

  // Auth: Delete thread (owner or admin)
  app.delete("/api/conferences/threads/:threadId", isAuthenticated, async (req, res) => {
    try {
      const thread = await storage.getForumThread(req.params.threadId);
      if (!thread) {
        return res.status(404).json({ message: "Hilo no encontrado" });
      }

      const user = req.user as User;
      if (thread.userId !== user.id && user.role !== "admin") {
        return res.status(403).json({ message: "No tienes permiso para eliminar este hilo" });
      }

      await storage.deleteForumThread(req.params.threadId);
      res.json({ message: "Hilo eliminado exitosamente" });
    } catch (error) {
      console.error("Error deleting thread:", error);
      res.status(500).json({ message: "Error al eliminar hilo" });
    }
  });

  // Admin: Toggle thread closed
  app.put("/api/conferences/threads/:threadId/close", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const thread = await storage.toggleForumThreadClosed(req.params.threadId);
      if (!thread) {
        return res.status(404).json({ message: "Hilo no encontrado" });
      }
      res.json({ thread });
    } catch (error) {
      console.error("Error toggling thread closed:", error);
      res.status(500).json({ message: "Error al cambiar estado del hilo" });
    }
  });

  // Admin: Toggle thread pinned
  app.put("/api/conferences/threads/:threadId/pin", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const thread = await storage.toggleForumThreadPinned(req.params.threadId);
      if (!thread) {
        return res.status(404).json({ message: "Hilo no encontrado" });
      }
      res.json({ thread });
    } catch (error) {
      console.error("Error toggling thread pinned:", error);
      res.status(500).json({ message: "Error al cambiar estado del hilo" });
    }
  });

  // Auth: Delete reply (owner or admin)
  app.delete("/api/conferences/replies/:replyId", isAuthenticated, async (req, res) => {
    try {
      const reply = await storage.getForumReply(req.params.replyId);
      if (!reply) {
        return res.status(404).json({ message: "Respuesta no encontrada" });
      }
      const user = req.user as User;
      if (reply.userId !== user.id && user.role !== "admin") {
        return res.status(403).json({ message: "No tienes permiso para eliminar esta respuesta" });
      }
      await storage.deleteForumReply(req.params.replyId);
      res.json({ message: "Respuesta eliminada exitosamente" });
    } catch (error) {
      console.error("Error deleting reply:", error);
      res.status(500).json({ message: "Error al eliminar respuesta" });
    }
  });

  // Public: Get single conference with threads
  app.get("/api/conferences/:id", async (req, res) => {
    try {
      const conference = await storage.getConference(req.params.id);
      if (!conference) {
        return res.status(404).json({ message: "Conferencia no encontrada" });
      }

      await storage.incrementConferenceViews(req.params.id);

      const threads = await storage.getForumThreads(req.params.id);

      const threadAuthorIds = Array.from(new Set(threads.map(t => t.userId)));
      const authors: Record<string, any> = {};
      for (const authorId of threadAuthorIds) {
        const user = await storage.getUser(authorId);
        if (user) {
          const { passwordHash, ...userWithoutPassword } = user;
          authors[authorId] = userWithoutPassword;
        }
      }

      let relatedConferences: any[] = [];
      const confTags = conference.tags || [];
      if (confTags.length > 0) {
        const allPublished = await storage.getConferences({ status: "published", limit: 50 });
        relatedConferences = allPublished
          .filter(c => c.id !== conference.id && c.tags?.some((t: string) => confTags.includes(t)))
          .slice(0, 4);
      }

      const allPublished = await storage.getConferences({ status: "published", limit: 100 });
      const sortedAll = allPublished.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const currentIndex = sortedAll.findIndex(c => c.id === conference.id);
      const prevConference = currentIndex < sortedAll.length - 1 ? { id: sortedAll[currentIndex + 1].id, title: sortedAll[currentIndex + 1].title } : null;
      const nextConference = currentIndex > 0 ? { id: sortedAll[currentIndex - 1].id, title: sortedAll[currentIndex - 1].title } : null;

      const participants = await storage.getForumParticipants(req.params.id);

      res.json({ conference, threads, authors, relatedConferences, prevConference, nextConference, forumParticipants: participants });
    } catch (error) {
      console.error("Error fetching conference:", error);
      res.status(500).json({ message: "Error al obtener conferencia" });
    }
  });

  // Admin: Update conference
  app.put("/api/conferences/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const body = { ...req.body };
      // Auto-fetch OG thumbnail for Facebook videos when explicitly clearing thumbnail or no thumbnail set
      if (body.videoUrl && body.thumbnailUrl === undefined) {
        const existing = await storage.getConference(req.params.id);
        if (existing && !existing.thumbnailUrl) {
          const ogImage = await fetchOgImage(body.videoUrl);
          if (ogImage) body.thumbnailUrl = ogImage;
        }
      }
      const result = insertConferenceSchema.partial().safeParse(body);
      if (!result.success) {
        return res.status(400).json({ message: fromZodError(result.error).message });
      }

      const conference = await storage.updateConference(req.params.id, result.data);
      if (!conference) {
        return res.status(404).json({ message: "Conferencia no encontrada" });
      }
      res.json({ conference });
    } catch (error) {
      console.error("Error updating conference:", error);
      res.status(500).json({ message: "Error al actualizar conferencia" });
    }
  });

  // Admin: Delete conference
  app.delete("/api/conferences/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const deleted = await storage.deleteConference(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Conferencia no encontrada" });
      }
      res.json({ message: "Conferencia eliminada exitosamente" });
    } catch (error) {
      console.error("Error deleting conference:", error);
      res.status(500).json({ message: "Error al eliminar conferencia" });
    }
  });

  // Public: List threads for a conference
  app.get("/api/conferences/:id/threads", async (req, res) => {
    try {
      const threads = await storage.getForumThreads(req.params.id);
      res.json({ threads });
    } catch (error) {
      console.error("Error fetching threads:", error);
      res.status(500).json({ message: "Error al obtener hilos del foro" });
    }
  });

  // Auth: Create thread
  app.post("/api/conferences/:id/threads", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const conference = await storage.getConference(req.params.id);
      if (!conference) {
        return res.status(404).json({ message: "Conferencia no encontrada" });
      }
      if (conference.status !== "published") {
        return res.status(400).json({ message: "Solo se pueden crear hilos en conferencias publicadas" });
      }

      const result = insertForumThreadSchema.safeParse({
        ...req.body,
        conferenceId: req.params.id,
        userId: (req.user as User).id,
      });
      if (!result.success) {
        return res.status(400).json({ message: fromZodError(result.error).message });
      }

      const thread = await storage.createForumThread(result.data);
      res.status(201).json({ thread });
    } catch (error) {
      console.error("Error creating thread:", error);
      res.status(500).json({ message: "Error al crear hilo" });
    }
  });

  // ============================
  // NUTRITION PROGRAMS (Calculadora de Nutrición y Bioestimulación)
  // ============================
  app.get("/api/parcels/:id/nutrition-programs", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
      const user = req.user as User;
      // Nutrition programs are private planning artifacts: only owner or admin can list them.
      if (parcel.userId !== user.id && user.role !== "admin") {
        return res.status(403).json({ message: "Sin permiso" });
      }
      const programs = await storage.getNutritionProgramsByParcel(req.params.id);
      res.json({ programs });
    } catch (error) {
      console.error("Error fetching nutrition programs:", error);
      res.status(500).json({ message: "Error al obtener programas" });
    }
  });

  app.post("/api/parcels/:id/nutrition-programs", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
      const user = req.user as User;
      if (parcel.userId !== user.id && user.role !== "admin") {
        return res.status(403).json({ message: "Sin permiso" });
      }
      const { products: rawProducts, ...programBody } = req.body;
      const validation = insertNutritionProgramSchema.safeParse({
        ...programBody,
        parcelId: req.params.id,
        userId: user.id,
      });
      if (!validation.success) {
        return res.status(400).json({ message: fromZodError(validation.error).message });
      }
      const program = await storage.createNutritionProgram(validation.data);
      // Optionally save products in the same request (used by offline-safe wizard saves).
      if (Array.isArray(rawProducts)) {
        const parsed: InsertNutritionProgramProduct[] = [];
        for (const it of rawProducts) {
          const v = insertNutritionProgramProductSchema.safeParse({ ...it, programId: program.id });
          if (v.success) parsed.push(v.data);
        }
        await storage.replaceNutritionProgramProducts(program.id, parsed);
      }
      res.status(201).json({ program });
    } catch (error) {
      console.error("Error creating nutrition program:", error);
      res.status(500).json({ message: "Error al guardar programa" });
    }
  });

  app.get("/api/nutrition-programs/:id", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const auth = await authorizeProgram(req.params.id, req.user as User);
      if (auth.error) return res.status(auth.error.status).json({ message: auth.error.message });
      const products = await storage.getNutritionProgramProducts(auth.program!.id);
      res.json({ program: auth.program, products });
    } catch (error) {
      console.error("Error fetching nutrition program:", error);
      res.status(500).json({ message: "Error al obtener programa" });
    }
  });

  app.patch("/api/nutrition-programs/:id", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const auth = await authorizeProgram(req.params.id, req.user as User);
      if (auth.error) return res.status(auth.error.status).json({ message: auth.error.message });
      const { products: rawProducts, ...programBody } = req.body;
      const validation = insertNutritionProgramSchema
        .omit({ userId: true, parcelId: true })
        .partial()
        .safeParse(programBody);
      if (!validation.success) {
        return res.status(400).json({ message: fromZodError(validation.error).message });
      }
      const program = await storage.updateNutritionProgram(req.params.id, validation.data);
      // Optionally replace products in the same request (used by offline-safe wizard saves).
      if (Array.isArray(rawProducts)) {
        const parsed: InsertNutritionProgramProduct[] = [];
        for (const it of rawProducts) {
          const v = insertNutritionProgramProductSchema.safeParse({ ...it, programId: req.params.id });
          if (v.success) parsed.push(v.data);
        }
        await storage.replaceNutritionProgramProducts(req.params.id, parsed);
      }
      res.json({ program });
    } catch (error) {
      console.error("Error updating nutrition program:", error);
      res.status(500).json({ message: "Error al actualizar programa" });
    }
  });

  app.delete("/api/nutrition-programs/:id", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const auth = await authorizeProgram(req.params.id, req.user as User);
      if (auth.error) return res.status(auth.error.status).json({ message: auth.error.message });
      await storage.deleteNutritionProgram(req.params.id);
      res.json({ ok: true });
    } catch (error) {
      console.error("Error deleting nutrition program:", error);
      res.status(500).json({ message: "Error al eliminar programa" });
    }
  });

  // ── Amendments snapshot (offline-safe calculator persistence) ──────────────
  app.post("/api/parcels/:id/amendments-snapshot", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
      const user = req.user as User;
      if (parcel.userId !== user.id && user.role !== "admin") {
        return res.status(403).json({ message: "Sin permiso" });
      }
      const { stateJson } = req.body;
      if (typeof stateJson !== "string" || !stateJson) {
        return res.status(400).json({ message: "stateJson requerido" });
      }
      await storage.upsertAmendmentsSnapshot(req.params.id, stateJson);
      res.json({ ok: true });
    } catch (error) {
      console.error("Error saving amendments snapshot:", error);
      res.status(500).json({ message: "Error al guardar enmiendas" });
    }
  });

  app.get("/api/parcels/:id/amendments-snapshot", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
      const user = req.user as User;
      if (parcel.userId !== user.id && user.role !== "admin") {
        return res.status(403).json({ message: "Sin permiso" });
      }
      const snapshot = await storage.getAmendmentsSnapshot(req.params.id);
      res.json(snapshot ?? { stateJson: null });
    } catch (error) {
      console.error("Error fetching amendments snapshot:", error);
      res.status(500).json({ message: "Error al obtener enmiendas" });
    }
  });

  // Helper: load program + verify owner/parcel-owner/admin authorization.
  // Parcel owners can access programs created on their parcels (e.g. by an admin or technician).
  async function authorizeProgram(programId: string, user: User) {
    const program = await storage.getNutritionProgram(programId);
    if (!program) return { error: { status: 404, message: "Programa no encontrado" } };
    if (program.userId === user.id || user.role === "admin") return { program };
    const parcel = await storage.getParcel(program.parcelId);
    if (parcel && parcel.userId === user.id) return { program };
    return { error: { status: 403, message: "Sin permiso" } };
  }

  // Replace all products for a program in one transaction (used by the wizard)
  app.put("/api/nutrition-programs/:id/products", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const auth = await authorizeProgram(req.params.id, req.user as User);
      if (auth.error) return res.status(auth.error.status).json({ message: auth.error.message });
      const items = Array.isArray(req.body?.products) ? req.body.products : [];
      const parsed: InsertNutritionProgramProduct[] = [];
      for (const it of items) {
        const v = insertNutritionProgramProductSchema.safeParse({ ...it, programId: req.params.id });
        if (!v.success) {
          return res.status(400).json({ message: fromZodError(v.error).message });
        }
        parsed.push(v.data);
      }
      const products = await storage.replaceNutritionProgramProducts(req.params.id, parsed);
      res.json({ products });
    } catch (error) {
      console.error("Error replacing nutrition program products:", error);
      res.status(500).json({ message: "Error al guardar productos" });
    }
  });

  // Granular product CRUD
  app.get("/api/nutrition-programs/:id/products", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const auth = await authorizeProgram(req.params.id, req.user as User);
      if (auth.error) return res.status(auth.error.status).json({ message: auth.error.message });
      const products = await storage.getNutritionProgramProducts(req.params.id);
      res.json({ products });
    } catch (error) {
      console.error("Error fetching products:", error);
      res.status(500).json({ message: "Error al obtener productos" });
    }
  });

  app.post("/api/nutrition-programs/:id/products", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const auth = await authorizeProgram(req.params.id, req.user as User);
      if (auth.error) return res.status(auth.error.status).json({ message: auth.error.message });
      const v = insertNutritionProgramProductSchema.safeParse({
        ...req.body,
        programId: req.params.id,
      });
      if (!v.success) return res.status(400).json({ message: fromZodError(v.error).message });
      const product = await storage.createNutritionProgramProduct(v.data);
      res.status(201).json({ product });
    } catch (error) {
      console.error("Error creating product:", error);
      res.status(500).json({ message: "Error al crear producto" });
    }
  });

  app.patch("/api/nutrition-programs/:id/products/:productId", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const product = await storage.getNutritionProgramProduct(req.params.productId);
      if (!product || product.programId !== req.params.id) {
        return res.status(404).json({ message: "Producto no encontrado" });
      }
      const auth = await authorizeProgram(req.params.id, req.user as User);
      if (auth.error) return res.status(auth.error.status).json({ message: auth.error.message });
      const v = insertNutritionProgramProductSchema
        .omit({ programId: true })
        .partial()
        .safeParse(req.body);
      if (!v.success) return res.status(400).json({ message: fromZodError(v.error).message });
      const updated = await storage.updateNutritionProgramProduct(req.params.productId, v.data);
      res.json({ product: updated });
    } catch (error) {
      console.error("Error updating product:", error);
      res.status(500).json({ message: "Error al actualizar producto" });
    }
  });

  app.delete("/api/nutrition-programs/:id/products/:productId", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const product = await storage.getNutritionProgramProduct(req.params.productId);
      if (!product || product.programId !== req.params.id) {
        return res.status(404).json({ message: "Producto no encontrado" });
      }
      const auth = await authorizeProgram(req.params.id, req.user as User);
      if (auth.error) return res.status(auth.error.status).json({ message: auth.error.message });
      await storage.deleteNutritionProgramProduct(req.params.productId);
      res.json({ ok: true });
    } catch (error) {
      console.error("Error deleting product:", error);
      res.status(500).json({ message: "Error al eliminar producto" });
    }
  });

  // ─── Climate Risk RCP/SSP Module (Task #168) ─────────────────────────────────

  /**
   * GET /api/parcels/:id/climate-risk?scenario=ssp245&horizon=2050
   * Returns projected climate metrics for the parcel based on CMIP6 scenarios.
   * - Fetches 30-year historical baseline from Open-Meteo Archive API (1981-2010)
   * - Applies IPCC AR6 WGI warming deltas to derive all 4 SSP scenarios
   * - Computes heat days, frost days, water deficit, and SPI risk metrics
   * - Computes backend crop yield impact with uncertainty ranges (IPCC AR6 WG2)
   * - Always returns data; falls back to IPCC-derived estimates when API is unavailable
   */
  app.get("/api/parcels/:id/climate-risk", isAuthenticated, isActiveUser, async (req: any, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel || parcel.userId !== req.user.id) {
        return res.status(404).json({ message: "Parcela no encontrada" });
      }
      const lat = parseFloat(parcel.latitude);
      const lon = parseFloat(parcel.longitude);

      // ── Input validation — whitelist allowed values ──
      const ALLOWED_SCENARIOS = ["ssp126", "ssp245", "ssp370", "ssp585"] as const;
      const ALLOWED_HORIZONS  = [2030, 2050, 2070, 2100] as const;
      const rawScenario = (req.query.scenario as string) || "ssp245";
      const rawHorizon  = parseInt((req.query.horizon as string) || "2050");
      if (!(ALLOWED_SCENARIOS as readonly string[]).includes(rawScenario)) {
        return res.status(400).json({ message: `Escenario inválido. Valores permitidos: ${ALLOWED_SCENARIOS.join(", ")}` });
      }
      if (!(ALLOWED_HORIZONS as readonly number[]).includes(rawHorizon)) {
        return res.status(400).json({ message: `Horizonte inválido. Valores permitidos: ${ALLOWED_HORIZONS.join(", ")}` });
      }
      const scenario = rawScenario;
      const horizon  = rawHorizon;

      // ── IPCC AR6 WGI SPM Table 1 — median warming above 1995-2014 reference ──
      // SSP3-7.0 is used as the RCP 6.0-equivalent pathway (standard CMIP6 mapping)
      const warmingDeltas: Record<string, Record<number, number>> = {
        ssp126: { 2030: 0.4, 2050: 0.8, 2070: 1.0, 2100: 1.0 },
        ssp245: { 2030: 0.6, 2050: 1.2, 2070: 1.7, 2100: 2.1 },
        ssp370: { 2030: 0.7, 2050: 1.4, 2070: 2.2, 2100: 3.0 }, // SSP3-7.0 / RCP 6.0
        ssp585: { 2030: 0.8, 2050: 1.8, 2070: 2.8, 2100: 3.8 },
      };

      // ── IPCC AR6 WG2 Ch.5 — crop yield sensitivity to local warming (% per °C) ──
      const cropCoefficients: Record<string, { label: string; medianPctPerC: number; uncertaintyPctPerC: number }> = {
        maiz:  { label: "Maíz",  medianPctPerC: -4.5, uncertaintyPctPerC: 2.5 },
        trigo: { label: "Trigo", medianPctPerC: -3.5, uncertaintyPctPerC: 2.0 },
        frijol:{ label: "Frijol",medianPctPerC: -5.0, uncertaintyPctPerC: 3.0 },
        soya:  { label: "Soya",  medianPctPerC: -4.0, uncertaintyPctPerC: 2.5 },
        sorgo: { label: "Sorgo", medianPctPerC: -2.0, uncertaintyPctPerC: 2.0 },
        papa:  { label: "Papa",  medianPctPerC: -4.0, uncertaintyPctPerC: 2.5 },
      };

      // ── IPCC AR6 precipitation sensitivity per °C per scenario ──
      const precipSensitivityPerC: Record<string, number> = {
        ssp126: -1.5,
        ssp245: -2.5,
        ssp370: -3.5, // RCP 6.0 equivalent
        ssp585: -5.0,
      };

      // HighResMIP models available on Open-Meteo Climate API (all capped at 2050-12-31)
      // Used as a location-specific ensemble to calibrate IPCC scenario deltas.
      // Key format returned: "temperature_2m_max_EC_Earth3P_HR" (variable_model).
      // MPI_ESM1_2_HR is invalid on this endpoint and is excluded.
      const CLIMATE_MODELS = ["EC_Earth3P_HR", "CMCC_CM2_VHR4", "MRI_AGCM3_2_S"] as const;

      // Helper: interpolate IPCC warming delta for any year
      const getWarmingDelta = (sc: string, year: number): number => {
        const milestones: number[] = [2030, 2050, 2070, 2100];
        const vals = warmingDeltas[sc];
        if (!vals) return 1.0;
        if (year <= milestones[0]) return vals[milestones[0]];
        if (year >= milestones[milestones.length - 1]) return vals[milestones[milestones.length - 1]];
        for (let i = 0; i < milestones.length - 1; i++) {
          if (year >= milestones[i] && year <= milestones[i + 1]) {
            const t = (year - milestones[i]) / (milestones[i + 1] - milestones[i]);
            return vals[milestones[i]] + t * (vals[milestones[i + 1]] - vals[milestones[i]]);
          }
        }
        return vals[milestones[milestones.length - 1]];
      };

      // ── Step 1: Fetch 30-year historical baseline from Open-Meteo Archive (1981-2010) ──
      const BASELINE_WINDOW = "1981-2010";
      const baselineUrl = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=1981-01-01&end_date=2010-12-31&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto`;

      let baselineTemp = 25;
      let baselineTempMin = 10;
      let baselinePrecipMm = 600;
      const baselinePrecipByMonth: number[] = new Array(12).fill(0);
      const baselinePrecipCountByMonth: number[] = new Array(12).fill(0);
      let apiDataAvailable = false;

      try {
        const baselineResp = await fetch(baselineUrl, { signal: AbortSignal.timeout(20000) });
        if (baselineResp.ok) {
          const bd = await baselineResp.json() as {
            daily?: {
              time: string[];
              temperature_2m_max: (number | null)[];
              temperature_2m_min: (number | null)[];
              precipitation_sum: (number | null)[];
            };
          };
          if (bd.daily?.temperature_2m_max?.length) {
            const temps   = bd.daily.temperature_2m_max.filter((t): t is number => t !== null);
            const tempsMin = bd.daily.temperature_2m_min.filter((t): t is number => t !== null);
            const precips  = bd.daily.precipitation_sum.filter((p): p is number => p !== null);
            if (temps.length > 0) { baselineTemp = temps.reduce((a, b) => a + b, 0) / temps.length; apiDataAvailable = true; }
            if (tempsMin.length > 0) baselineTempMin = tempsMin.reduce((a, b) => a + b, 0) / tempsMin.length;
            if (precips.length > 0) baselinePrecipMm = precips.reduce((a, b) => a + b, 0) / (precips.length / 365);
            bd.daily.time.forEach((t: string, i: number) => {
              const pVal = bd.daily!.precipitation_sum[i];
              if (pVal !== null) { const m = new Date(t).getMonth(); baselinePrecipByMonth[m] += pVal; baselinePrecipCountByMonth[m]++; }
            });
          }
        }
      } catch (_e) { /* use default values */ }

      const monthlyBaseline = baselinePrecipByMonth.map((total, m) => {
        const cnt = baselinePrecipCountByMonth[m];
        return cnt > 0 ? (total / cnt) * 30 : baselinePrecipMm / 12;
      });

      // ── Step 2: Call Open-Meteo Climate API — ensemble of 3 valid HighResMIP models ──
      // All HighResMIP models are capped at 2050-12-31; for horizons beyond 2050 we use
      // the IPCC AR6 fallback directly (climateApiUsed stays false).
      const API_MAX_YEAR = 2050;
      const calibYear   = Math.min(horizon, API_MAX_YEAR);
      const calibStart  = `${Math.max(2024, calibYear - 2)}-01-01`;
      const calibEnd    = `${calibYear}-12-31`;
      const allModelNames = CLIMATE_MODELS.join(",");
      const climateUrl = `https://climate-api.open-meteo.com/v1/climate?latitude=${lat}&longitude=${lon}&start_date=${calibStart}&end_date=${calibEnd}&models=${allModelNames}&daily=temperature_2m_max,precipitation_sum`;

      // Will hold calibration factor derived from real API data
      let localCalibFactor = 1.0;   // ratio of ensemble-measured delta vs IPCC SSP5-8.5 expected
      let localPrecipFactor = 1.0;  // analogous factor for precipitation
      let climateApiUsed = false;

      // Only attempt Climate API call when selected horizon is within model coverage
      if (horizon <= API_MAX_YEAR) {
        try {
          const climateResp = await fetch(climateUrl, { signal: AbortSignal.timeout(20000) });
          if (climateResp.ok) {
            const cd = await climateResp.json() as { daily?: Record<string, (number | null)[]> };
            if (cd.daily) {
              // Keys are formatted as "temperature_2m_max_EC_Earth3P_HR" (variable_model)
              const tempDeltas: number[] = [];
              const precipChanges: number[] = [];

              for (const model of CLIMATE_MODELS) {
                const tempKey   = Object.keys(cd.daily).find(k => k.includes("temperature_2m_max") && k.includes(model));
                const precipKey = Object.keys(cd.daily).find(k => k.includes("precipitation_sum") && k.includes(model));

                if (tempKey) {
                  const vals = cd.daily[tempKey].filter((v): v is number => v !== null);
                  if (vals.length > 30) {
                    const projTemp = vals.reduce((a, b) => a + b, 0) / vals.length;
                    const delta = projTemp - baselineTemp;
                    // Plausibility filter: accept only 0.05°C – 6°C warming
                    if (delta > 0.05 && delta < 6) tempDeltas.push(delta);
                  }
                }

                if (precipKey) {
                  const pvals = cd.daily[precipKey].filter((v): v is number => v !== null);
                  if (pvals.length > 30 && baselinePrecipMm > 0) {
                    const projPrecip = pvals.reduce((a, b) => a + b, 0) / (pvals.length / 365);
                    const pctChange = ((projPrecip - baselinePrecipMm) / baselinePrecipMm) * 100;
                    // Plausibility filter: ±40% precipitation change
                    if (pctChange > -40 && pctChange < 40) precipChanges.push(pctChange);
                  }
                }
              }

              if (tempDeltas.length > 0) {
                // Ensemble mean delta vs IPCC SSP5-8.5 expected at calibration year
                // (HighResMIP models run under high-forcing scenarios ≈ SSP5-8.5)
                const ensembleMean = tempDeltas.reduce((a, b) => a + b, 0) / tempDeltas.length;
                const ssp585Expected = getWarmingDelta("ssp585", calibYear);
                localCalibFactor = ssp585Expected > 0
                  ? Math.min(2.0, Math.max(0.3, ensembleMean / ssp585Expected))
                  : 1.0;
                climateApiUsed = true;
                apiDataAvailable = true;
              }

              if (precipChanges.length > 0 && climateApiUsed) {
                const ensemblePrecipMean = precipChanges.reduce((a, b) => a + b, 0) / precipChanges.length;
                const ssp585PrecipExpected = (precipSensitivityPerC.ssp585 ?? -5) * getWarmingDelta("ssp585", calibYear);
                localPrecipFactor = ssp585PrecipExpected !== 0
                  ? Math.min(3.0, Math.max(0.0, ensemblePrecipMean / ssp585PrecipExpected))
                  : 1.0;
              }
            }
          }
        } catch (_e) { /* keep IPCC fallback — calibFactor stays 1.0 */ }
      }

      // Apply location calibration to each SSP scenario
      // For temp: scale IPCC deltas by localCalibFactor (measured local sensitivity vs expected)
      // For precip: scale IPCC sensitivity by localPrecipFactor
      const scenarioProj = {
        ssp126: { tempDelta: getWarmingDelta("ssp126", horizon) * localCalibFactor, precipPctChange: (precipSensitivityPerC.ssp126 ?? -1.5) * getWarmingDelta("ssp126", horizon) * localPrecipFactor },
        ssp245: { tempDelta: getWarmingDelta("ssp245", horizon) * localCalibFactor, precipPctChange: (precipSensitivityPerC.ssp245 ?? -2.5) * getWarmingDelta("ssp245", horizon) * localPrecipFactor },
        ssp370: { tempDelta: getWarmingDelta("ssp370", horizon) * localCalibFactor, precipPctChange: (precipSensitivityPerC.ssp370 ?? -3.5) * getWarmingDelta("ssp370", horizon) * localPrecipFactor },
        ssp585: { tempDelta: getWarmingDelta("ssp585", horizon) * localCalibFactor, precipPctChange: (precipSensitivityPerC.ssp585 ?? -5.0) * getWarmingDelta("ssp585", horizon) * localPrecipFactor },
      };

      const selectedProj = scenarioProj[scenario as keyof typeof scenarioProj] ?? scenarioProj.ssp245;
      const tempDeltaRaw    = selectedProj.tempDelta;
      const precipPctChange = selectedProj.precipPctChange;
      const tempDelta       = parseFloat(tempDeltaRaw.toFixed(1));

      // ── Step 3: Risk metrics ──
      const baseHeatDays = lat >= -23.5 && lat <= 23.5 ? 30 : lat >= -35 && lat <= 35 ? 15 : 5;
      const heatDays = Math.round(baseHeatDays + tempDelta * 12);
      const heatLevel = heatDays > 60 ? "alto" : heatDays > 30 ? "moderado" : "bajo";
      const baseFrostDays = Math.max(0, (Math.abs(lat) - 20) * 2);
      const frostDays = Math.max(0, Math.round(baseFrostDays - tempDelta * 8));
      const frostLevel = frostDays > 20 ? "alto" : frostDays > 5 ? "moderado" : "bajo";
      const annualPrecip = Math.round(baselinePrecipMm * (1 + precipPctChange / 100));
      const precipDelta = Math.round(precipPctChange);

      // ── Step 4: Water deficit (simplified ET0 Hargreaves approach) ──
      const tempRange = Math.max(5, baselineTemp - baselineTempMin);
      const et0Annual = Math.round(0.0023 * (baselineTemp + 17.8) * Math.pow(tempRange, 0.5) * 365 * 2.5);
      const et0Projected = Math.round(et0Annual * (1 + 0.06 * tempDelta));
      const waterDeficit = Math.max(0, et0Projected - annualPrecip);
      const waterDeficitLevel = waterDeficit > 400 ? "alto" : waterDeficit > 150 ? "moderado" : "bajo";

      // ── Step 5: Simplified SPI ──
      const baselineStd = baselinePrecipMm * 0.25;
      const spiValue = baselineStd > 0 ? (annualPrecip - baselinePrecipMm) / baselineStd : 0;
      const spiRounded = parseFloat(spiValue.toFixed(2));
      const spiLevel = spiValue < -1.5 ? "alto" : spiValue < -0.5 ? "moderado" : "bajo";
      const tempDeltaLevel = tempDelta > 2.5 ? "alto" : tempDelta > 1.5 ? "moderado" : "bajo";

      // ── Step 6: Backend crop impact ──
      const cropNorm = (parcel.crop || "").toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const matchedCropKey = Object.keys(cropCoefficients).find(k => cropNorm.includes(k)) ?? null;
      const allCropImpacts = Object.entries(cropCoefficients).map(([cropKey, coeff]) => {
        const yieldChange = parseFloat((coeff.medianPctPerC * tempDeltaRaw).toFixed(1));
        const uncertainty = parseFloat((coeff.uncertaintyPctPerC * tempDeltaRaw).toFixed(1));
        return {
          cropKey,
          label: coeff.label,
          yieldChange,
          uncertaintyLow: parseFloat((yieldChange - uncertainty).toFixed(1)),
          uncertaintyHigh: parseFloat((yieldChange + uncertainty).toFixed(1)),
          riskLevel: yieldChange < -20 ? "alto" : yieldChange < -10 ? "moderado" : "bajo",
        };
      });
      const cropImpact = matchedCropKey
        ? allCropImpacts.find(c => c.cropKey === matchedCropKey) ?? null
        : null;

      // ── Step 7: Multi-scenario anomaly timeline (2025-2100, 5-year steps) ──
      // Δ°C vs 1981-2010 baseline — all scenarios scaled by the same local calibration factor
      // (derived from the ensemble mean of 3 HighResMIP models vs IPCC SSP5-8.5 expected)
      interface ScenarioDataPoint { year: number; ssp126: number; ssp245: number; ssp370: number; ssp585: number; }
      const allScenarios: ScenarioDataPoint[] = [];
      for (let y = 2025; y <= 2100; y += 5) {
        allScenarios.push({
          year: y,
          ssp126: parseFloat((getWarmingDelta("ssp126", y) * localCalibFactor).toFixed(2)),
          ssp245: parseFloat((getWarmingDelta("ssp245", y) * localCalibFactor).toFixed(2)),
          ssp370: parseFloat((getWarmingDelta("ssp370", y) * localCalibFactor).toFixed(2)),
          ssp585: parseFloat((getWarmingDelta("ssp585", y) * localCalibFactor).toFixed(2)),
        });
      }

      // ── Step 8: Precipitation % change by scenario × all 4 horizons ──
      interface PrecipByScenarioPoint { horizon: number; ssp126: number; ssp245: number; ssp370: number; ssp585: number; }
      const CLIMATE_HORIZONS = [2030, 2050, 2070, 2100];
      const getPrecipPct = (sc: string, targetH: number): number =>
        (precipSensitivityPerC[sc] ?? -3) * getWarmingDelta(sc, targetH) * localCalibFactor * localPrecipFactor;
      const precipByScenario: PrecipByScenarioPoint[] = CLIMATE_HORIZONS.map(h => ({
        horizon: h,
        ssp126: parseFloat(getPrecipPct("ssp126", h).toFixed(1)),
        ssp245: parseFloat(getPrecipPct("ssp245", h).toFixed(1)),
        ssp370: parseFloat(getPrecipPct("ssp370", h).toFixed(1)),
        ssp585: parseFloat(getPrecipPct("ssp585", h).toFixed(1)),
      }));

      // ── Step 9: Monthly precipitation (baseline vs projected, selected scenario) ──
      const MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
      const precipitationByMonth = MONTHS.map((month, i) => ({
        month,
        baseline:  parseFloat(monthlyBaseline[i].toFixed(1)),
        projected: parseFloat((monthlyBaseline[i] * (1 + precipPctChange / 100)).toFixed(1)),
      }));

      res.json({
        parcelId: parcel.id,
        scenario,
        horizon,
        baselineWindow: BASELINE_WINDOW,
        baselineTemp: parseFloat(baselineTemp.toFixed(1)),
        baselinePrecipMm: Math.round(baselinePrecipMm),
        apiDataAvailable,
        climateApiUsed,
        risks: {
          heatDays,
          heatLevel,
          frostDays,
          frostLevel,
          annualPrecip,
          precipDelta,
          tempDelta,
          tempDeltaLevel,
          waterDeficit,
          waterDeficitLevel,
          spi: spiRounded,
          spiLevel,
        },
        cropImpact,
        allCropImpacts,
        allScenarios,
        precipByScenario,
        precipitationByMonth,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Error desconocido";
      console.error("Climate risk error:", msg);
      res.status(500).json({ message: "Error al obtener datos de riesgo climático" });
    }
  });

  /**
   * POST /api/parcels/:id/climate-risk/interpret
   * AI interpretation of the climate risk data for the parcel.
   */
  app.post("/api/parcels/:id/climate-risk/interpret", isAuthenticated, isActiveUser, async (req: any, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel || parcel.userId !== req.user.id) {
        return res.status(404).json({ message: "Parcela no encontrada" });
      }

      // ── Validate and whitelist scenario + horizon from request body ──
      const INTERP_SCENARIOS = ["ssp126", "ssp245", "ssp370", "ssp585"] as const;
      const INTERP_HORIZONS  = [2030, 2050, 2070, 2100] as const;
      const bodyScenario = (req.body.scenario as string) || "ssp245";
      const bodyHorizon  = parseInt((req.body.horizon as string) || "2050");
      if (!(INTERP_SCENARIOS as readonly string[]).includes(bodyScenario)) {
        return res.status(400).json({ message: "Escenario inválido" });
      }
      if (!(INTERP_HORIZONS as readonly number[]).includes(bodyHorizon)) {
        return res.status(400).json({ message: "Horizonte inválido" });
      }
      const scenario = bodyScenario;
      const horizon  = bodyHorizon;

      // ── Derive risk metrics server-side — do NOT trust client-supplied climateData ──
      // Use IPCC AR6 median deltas anchored to parcel baseline (simplified, fast path)
      const interpWarmingDeltas: Record<string, Record<number, number>> = {
        ssp126: { 2030: 0.4, 2050: 0.8, 2070: 1.0, 2100: 1.0 },
        ssp245: { 2030: 0.6, 2050: 1.2, 2070: 1.7, 2100: 2.1 },
        ssp370: { 2030: 0.7, 2050: 1.4, 2070: 2.2, 2100: 3.0 },
        ssp585: { 2030: 0.8, 2050: 1.8, 2070: 2.8, 2100: 3.8 },
      };
      const interpPrecipSens: Record<string, number> = { ssp126: -1.5, ssp245: -2.5, ssp370: -3.5, ssp585: -5.0 };
      const tempDelta  = interpWarmingDeltas[scenario]?.[horizon] ?? 1.2;
      const precipPct  = (interpPrecipSens[scenario] ?? -3) * tempDelta;
      const lat = parseFloat(parcel.latitude ?? "0");
      const baseHeat   = lat >= -23.5 && lat <= 23.5 ? 30 : lat >= -35 && lat <= 35 ? 15 : 5;
      const heatDays   = Math.round(baseHeat + tempDelta * 12);
      const baseFrost  = Math.max(0, (Math.abs(lat) - 20) * 2);
      const frostDays  = Math.max(0, Math.round(baseFrost - tempDelta * 8));

      const scenarioLabels: Record<string, string> = {
        ssp126: "SSP1-2.6 (optimista, +1.8°C al 2100)",
        ssp245: "SSP2-4.5 (moderado, +2.7°C al 2100)",
        ssp370: "SSP3-7.0 / RCP 6.0 (moderado-alto, +3.0°C al 2100)",
        ssp585: "SSP5-8.5 (extremo, +4.4°C al 2100)",
      };

      const prompt = `Analiza el siguiente riesgo climático para la parcela "${parcel.name}" con cultivo de ${parcel.crop} en ${parcel.location}.

ESCENARIO: ${scenarioLabels[scenario] ?? scenario} — Horizonte ${horizon}

MÉTRICAS PROYECTADAS (IPCC AR6):
- Incremento de temperatura: +${tempDelta.toFixed(1)}°C vs línea base 1981-2010
- Días de calor extremo (>35°C): ${heatDays} días/año
- Días de helada (<0°C): ${frostDays} días/año
- Cambio en precipitación anual: ${precipPct >= 0 ? "+" : ""}${precipPct.toFixed(0)}%

Proporciona:
1. Diagnóstico de los principales riesgos para el cultivo de ${parcel.crop} bajo este escenario
2. Estrategias de adaptación específicas (variedades tolerantes, cambios en fechas de siembra, manejo del agua, prácticas de suelo)
3. Oportunidades que podría aprovechar bajo este cambio climático
4. Recomendaciones de monitoreo y preparación a corto, mediano y largo plazo

Responde en español, de forma clara y práctica para un agricultor.`;

      const { response: interpretation } = await generateAIResponse(
        prompt,
        { parcel, parcelData: [], soilAnalysis: null, tillagePractices: [], cropRotation: [], animalIntegration: null, livelihood: null },
        [],
        req.user.id,
      );

      res.json({ interpretation });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Error desconocido";
      console.error("Climate risk interpret error:", msg);
      res.status(500).json({ message: "Error al interpretar riesgo climático" });
    }
  });

  // ── Start daily climate alert cron (2min startup delay, then every 24h) ──
  setTimeout(() => { runClimateAlertCron().catch(console.error); }, 2 * 60_000);
  setInterval(() => { runClimateAlertCron().catch(console.error); }, 24 * 60 * 60_000);

  return httpServer;
}

// Helper function to generate soil alerts based on analysis values
function generateSoilAlerts(analysis: any, crop: string): { severity: "high" | "medium" | "low"; title: string; description: string; isRead: boolean }[] {
  const alerts: { severity: "high" | "medium" | "low"; title: string; description: string; isRead: boolean }[] = [];

  // Optimal soil ranges per crop — 25+ crops covering grains, perennials, and vegetables
  const cropRanges: Record<string, { ph: [number, number]; organicMatter: [number, number]; phosphorus: [number, number]; potassium: [number, number]; nitrogen: [number, number] }> = {
    // Grains / Annuals
    "Maíz":           { ph: [5.8, 7.0], organicMatter: [3.0, 5.0], phosphorus: [20, 50], potassium: [150, 250], nitrogen: [0.15, 0.35] },
    "Trigo":          { ph: [6.0, 7.5], organicMatter: [2.0, 4.5], phosphorus: [15, 35], potassium: [100, 180], nitrogen: [0.12, 0.28] },
    "Soja":           { ph: [5.8, 7.0], organicMatter: [2.5, 5.0], phosphorus: [15, 40], potassium: [120, 200], nitrogen: [0.15, 0.30] },
    "Frijol":         { ph: [6.0, 7.0], organicMatter: [2.5, 4.5], phosphorus: [15, 35], potassium: [100, 180], nitrogen: [0.12, 0.28] },
    "Sorgo":          { ph: [6.0, 7.5], organicMatter: [2.0, 4.0], phosphorus: [12, 30], potassium: [120, 200], nitrogen: [0.10, 0.25] },
    "Arroz":          { ph: [5.5, 6.5], organicMatter: [3.0, 5.0], phosphorus: [20, 40], potassium: [100, 180], nitrogen: [0.15, 0.30] },
    "Girasol":        { ph: [6.0, 7.5], organicMatter: [2.0, 4.0], phosphorus: [12, 30], potassium: [100, 160], nitrogen: [0.10, 0.25] },
    "Cebada":         { ph: [6.0, 7.5], organicMatter: [2.0, 4.0], phosphorus: [15, 35], potassium: [100, 180], nitrogen: [0.12, 0.28] },
    "Avena":          { ph: [5.5, 7.0], organicMatter: [2.0, 4.0], phosphorus: [12, 30], potassium: [100, 180], nitrogen: [0.10, 0.25] },
    "Algodón":        { ph: [6.0, 7.5], organicMatter: [1.5, 3.5], phosphorus: [15, 35], potassium: [120, 200], nitrogen: [0.12, 0.28] },
    "Garbanzo":       { ph: [6.0, 8.0], organicMatter: [1.5, 3.5], phosphorus: [10, 30], potassium: [100, 180], nitrogen: [0.10, 0.25] },
    // Perennials / Tree crops
    "Café":           { ph: [5.5, 6.5], organicMatter: [4.0, 8.0], phosphorus: [10, 25], potassium: [100, 200], nitrogen: [0.15, 0.35] },
    "Aguacate":       { ph: [5.5, 7.0], organicMatter: [3.0, 6.0], phosphorus: [10, 30], potassium: [150, 300], nitrogen: [0.12, 0.30] },
    "Cítricos":       { ph: [5.5, 7.0], organicMatter: [2.5, 5.0], phosphorus: [10, 25], potassium: [120, 250], nitrogen: [0.12, 0.28] },
    "Limón":          { ph: [5.5, 7.0], organicMatter: [2.5, 5.0], phosphorus: [10, 25], potassium: [120, 250], nitrogen: [0.12, 0.28] },
    "Caña de Azúcar": { ph: [5.5, 7.5], organicMatter: [2.0, 5.0], phosphorus: [15, 35], potassium: [150, 300], nitrogen: [0.15, 0.30] },
    "Nopal":          { ph: [6.0, 8.0], organicMatter: [1.0, 3.0], phosphorus: [8,  20], potassium: [80,  160], nitrogen: [0.08, 0.20] },
    "Vid":            { ph: [5.5, 7.0], organicMatter: [2.0, 4.0], phosphorus: [10, 25], potassium: [100, 200], nitrogen: [0.10, 0.25] },
    // Vegetables / Short-cycle
    "Chile":          { ph: [6.0, 7.0], organicMatter: [3.0, 5.0], phosphorus: [20, 50], potassium: [150, 300], nitrogen: [0.15, 0.35] },
    "Tomate":         { ph: [6.0, 7.0], organicMatter: [3.0, 5.0], phosphorus: [20, 50], potassium: [150, 300], nitrogen: [0.15, 0.35] },
    "Cebolla":        { ph: [6.0, 7.5], organicMatter: [2.0, 4.0], phosphorus: [20, 40], potassium: [120, 250], nitrogen: [0.12, 0.30] },
    "Papa":           { ph: [5.0, 6.5], organicMatter: [2.5, 5.0], phosphorus: [20, 50], potassium: [150, 300], nitrogen: [0.15, 0.35] },
    "Hortalizas":     { ph: [6.0, 7.0], organicMatter: [3.0, 5.0], phosphorus: [20, 50], potassium: [150, 250], nitrogen: [0.15, 0.35] },
    "Zanahoria":      { ph: [6.0, 7.0], organicMatter: [2.0, 4.0], phosphorus: [15, 40], potassium: [120, 250], nitrogen: [0.12, 0.28] },
    "Ajo":            { ph: [6.0, 7.5], organicMatter: [2.0, 4.0], phosphorus: [15, 35], potassium: [120, 220], nitrogen: [0.12, 0.28] },
    "Otro":           { ph: [6.0, 7.0], organicMatter: [2.5, 5.0], phosphorus: [15, 40], potassium: [120, 220], nitrogen: [0.12, 0.30] },
  };

  const ranges = cropRanges[crop] ?? cropRanges["Maíz"];

  // Check pH
  if (analysis.ph) {
    const ph = parseFloat(analysis.ph);
    if (ph < ranges.ph[0] - 0.5 || ph > ranges.ph[1] + 0.5) {
      alerts.push({
        severity: "high",
        title: "pH del suelo fuera de rango crítico",
        description: `El pH actual (${ph}) está muy lejos del rango óptimo (${ranges.ph[0]}-${ranges.ph[1]}) para ${crop}. Se recomienda corrección urgente con cal agrícola o azufre.`,
        isRead: false,
      });
    } else if (ph < ranges.ph[0] || ph > ranges.ph[1]) {
      alerts.push({
        severity: "medium",
        title: "pH del suelo subóptimo",
        description: `El pH actual (${ph}) está fuera del rango óptimo (${ranges.ph[0]}-${ranges.ph[1]}) para ${crop}. Planificar corrección en la próxima campaña.`,
        isRead: false,
      });
    } else if (ph < ranges.ph[0] + 0.2 || ph > ranges.ph[1] - 0.2) {
      alerts.push({
        severity: "low",
        title: "pH en límite del rango óptimo",
        description: `El pH (${ph}) está dentro del rango aceptable pero en el borde del óptimo (${ranges.ph[0]}-${ranges.ph[1]}) para ${crop}. Monitorear evolución estacional.`,
        isRead: false,
      });
    }
  }

  // Check organic matter
  if (analysis.organicMatter) {
    const om = parseFloat(analysis.organicMatter);
    if (om < ranges.organicMatter[0]) {
      alerts.push({
        severity: om < 1.5 ? "high" : "medium",
        title: "Materia orgánica baja",
        description: `La materia orgánica (${om}%) está por debajo del óptimo (${ranges.organicMatter[0]}%). Considere incorporar abonos verdes o compost.`,
        isRead: false,
      });
    }
  }

  // Check phosphorus
  if (analysis.phosphorus) {
    const p = parseFloat(analysis.phosphorus);
    if (p < ranges.phosphorus[0] * 0.5) {
      alerts.push({ severity: "high", title: "Fósforo muy deficiente", description: `El fósforo disponible (${p} ppm) está muy por debajo del óptimo (${ranges.phosphorus[0]} ppm) para ${crop}. Riesgo de limitación severa de rendimiento.`, isRead: false });
    } else if (p < ranges.phosphorus[0]) {
      alerts.push({ severity: "medium", title: "Fósforo deficiente", description: `El fósforo disponible (${p} ppm) está por debajo del óptimo (${ranges.phosphorus[0]} ppm) para ${crop}.`, isRead: false });
    } else if (p < ranges.phosphorus[0] * 1.15) {
      alerts.push({ severity: "low", title: "Fósforo en límite inferior del óptimo", description: `El fósforo (${p} ppm) está cerca del mínimo recomendado (${ranges.phosphorus[0]} ppm) para ${crop}. Monitorear y fertilizar preventivamente.`, isRead: false });
    }
  }

  // Check potassium
  if (analysis.potassium) {
    const k = parseFloat(analysis.potassium);
    if (k < ranges.potassium[0] * 0.5) {
      alerts.push({ severity: "high", title: "Potasio muy deficiente", description: `El potasio disponible (${k} ppm) está muy por debajo del óptimo (${ranges.potassium[0]} ppm) para ${crop}.`, isRead: false });
    } else if (k < ranges.potassium[0]) {
      alerts.push({ severity: "medium", title: "Potasio deficiente", description: `El potasio disponible (${k} ppm) está por debajo del óptimo (${ranges.potassium[0]} ppm) para ${crop}.`, isRead: false });
    } else if (k < ranges.potassium[0] * 1.1) {
      alerts.push({ severity: "low", title: "Potasio en límite inferior del óptimo", description: `El potasio (${k} ppm) está cerca del mínimo recomendado (${ranges.potassium[0]} ppm) para ${crop}.`, isRead: false });
    }
  }

  // Check nitrogen
  if (analysis.nitrogenTotal && parseFloat(analysis.nitrogenTotal) > 0) {
    const n = parseFloat(analysis.nitrogenTotal);
    if (n < ranges.nitrogen[0] * 0.5) {
      alerts.push({ severity: "high", title: "Nitrógeno total muy bajo", description: `El nitrógeno total (${n}%) está muy por debajo del óptimo (${ranges.nitrogen[0]}%) para ${crop}. Riesgo de limitación severa.`, isRead: false });
    } else if (n < ranges.nitrogen[0]) {
      alerts.push({ severity: "medium", title: "Nitrógeno total bajo", description: `El nitrógeno total (${n}%) está por debajo del óptimo (${ranges.nitrogen[0]}%) para ${crop}.`, isRead: false });
    } else if (n < ranges.nitrogen[0] * 1.1) {
      alerts.push({ severity: "low", title: "Nitrógeno en límite inferior del óptimo", description: `El nitrógeno total (${n}%) está próximo al mínimo recomendado (${ranges.nitrogen[0]}%) para ${crop}.`, isRead: false });
    }
  }

  // Check electric conductivity (salinity)
  if (analysis.electricConductivity) {
    const ec = parseFloat(analysis.electricConductivity);
    if (ec > 4) {
      alerts.push({
        severity: "high",
        title: "Salinidad elevada",
        description: `La conductividad eléctrica (${ec} dS/m) indica problemas de salinidad que pueden afectar el cultivo.`,
        isRead: false,
      });
    } else if (ec > 2) {
      alerts.push({
        severity: "medium",
        title: "Salinidad moderada",
        description: `La conductividad eléctrica (${ec} dS/m) está en niveles moderados. Monitorear evolución.`,
        isRead: false,
      });
    } else if (ec > 1) {
      alerts.push({
        severity: "low",
        title: "Salinidad leve",
        description: `La conductividad eléctrica (${ec} dS/m) es levemente elevada. Sin impacto significativo por ahora.`,
        isRead: false,
      });
    }
  }

  // Check Ca/Mg ratio (ideal 5–7:1)
  if (analysis.calcium && analysis.magnesium) {
    const ca = parseFloat(analysis.calcium);
    const mg = parseFloat(analysis.magnesium);
    if (mg > 0) {
      const ratio = ca / mg;
      if (ratio < 2 || ratio > 12) {
        alerts.push({
          severity: "high",
          title: "Relación Calcio/Magnesio muy desequilibrada",
          description: `La relación Ca/Mg es ${ratio.toFixed(1)}:1 (ideal 5–7:1). ${ratio < 2 ? "Exceso severo de Mg bloquea la absorción de Ca." : "Exceso severo de Ca induce deficiencia de Mg."}`,
          isRead: false,
        });
      } else if (ratio < 3 || ratio > 10) {
        alerts.push({
          severity: "medium",
          title: "Relación Calcio/Magnesio desequilibrada",
          description: `La relación Ca/Mg es ${ratio.toFixed(1)}:1 (ideal 5–7:1). ${ratio < 3 ? "Exceso relativo de Mg puede bloquear absorción de Ca." : "Exceso relativo de Ca puede inducir deficiencia de Mg."}`,
          isRead: false,
        });
      } else if (ratio < 5 || ratio > 7) {
        alerts.push({
          severity: "low",
          title: "Relación Ca/Mg ligeramente fuera del óptimo",
          description: `La relación Ca/Mg es ${ratio.toFixed(1)}:1 (ideal 5–7:1). Sin impacto severo aún, monitorear la evolución.`,
          isRead: false,
        });
      }
    }
  }

  // Check CEC (Cation Exchange Capacity)
  if (analysis.cec) {
    const cec = parseFloat(analysis.cec);
    if (cec < 5) {
      alerts.push({
        severity: "high",
        title: "CIC muy baja — alta lixiviación",
        description: `La capacidad de intercambio catiónico (${cec} meq/100g) es muy baja. El suelo retiene mal los nutrientes.`,
        isRead: false,
      });
    } else if (cec < 10) {
      alerts.push({
        severity: "medium",
        title: "CIC baja",
        description: `La CIC (${cec} meq/100g) es baja. Incorporar materia orgánica mejorará la retención de nutrientes.`,
        isRead: false,
      });
    } else if (cec > 40) {
      alerts.push({
        severity: "low",
        title: "CIC muy alta",
        description: `La CIC (${cec} meq/100g) es muy alta. Posible suelo arcilloso con riesgo de compactación.`,
        isRead: false,
      });
    }
  }

  // Check texture extremes
  if (analysis.sand) {
    const sand = parseFloat(analysis.sand);
    if (sand > 80) {
      alerts.push({
        severity: "medium",
        title: "Textura arenosa extrema",
        description: `El suelo tiene ${sand}% de arena. Riesgo de drenaje excesivo y baja retención de nutrientes y agua.`,
        isRead: false,
      });
    } else if (sand > 70) {
      alerts.push({
        severity: "low",
        title: "Textura arenosa",
        description: `El suelo tiene ${sand}% de arena. Monitorear la lixiviación de nutrientes y la frecuencia de riego.`,
        isRead: false,
      });
    }
  }
  if (analysis.clay) {
    const clay = parseFloat(analysis.clay);
    if (clay > 65) {
      alerts.push({
        severity: "medium",
        title: "Textura arcillosa extrema",
        description: `El suelo tiene ${clay}% de arcilla. Riesgo elevado de compactación, drenaje deficiente y anoxia radicular.`,
        isRead: false,
      });
    } else if (clay > 50) {
      alerts.push({
        severity: "low",
        title: "Textura arcillosa moderada",
        description: `El suelo tiene ${clay}% de arcilla. Vigilar compactación y planificar drenaje adecuado.`,
        isRead: false,
      });
    }
  }

  // Check micronutrients
  if (analysis.iron) {
    const fe = parseFloat(analysis.iron);
    if (fe < 4) alerts.push({ severity: "medium", title: "Deficiencia de Hierro (Fe)", description: `Fe disponible (${fe} ppm) por debajo del umbral de 4 ppm. Puede causar clorosis foliar.`, isRead: false });
    else if (fe > 200) alerts.push({ severity: "medium", title: "Hierro (Fe) elevado", description: `Fe (${fe} ppm) en niveles altos. En suelos ácidos puede inducir toxicidad.`, isRead: false });
  }
  if (analysis.zinc) {
    const zn = parseFloat(analysis.zinc);
    if (zn < 0.5) alerts.push({ severity: "medium", title: "Deficiencia de Zinc (Zn)", description: `Zn disponible (${zn} ppm) por debajo del umbral de 0.5 ppm. Afecta síntesis de auxinas y fotosíntesis.`, isRead: false });
  }
  if (analysis.manganese) {
    const mn = parseFloat(analysis.manganese);
    if (mn < 1) alerts.push({ severity: "medium", title: "Deficiencia de Manganeso (Mn)", description: `Mn disponible (${mn} ppm) por debajo del umbral de 1 ppm. Esencial para la fotosíntesis.`, isRead: false });
  }
  if (analysis.copper) {
    const cu = parseFloat(analysis.copper);
    if (cu < 0.2) alerts.push({ severity: "medium", title: "Deficiencia de Cobre (Cu)", description: `Cu disponible (${cu} ppm) por debajo de 0.2 ppm. Puede reducir la formación de lignina.`, isRead: false });
  }
  if (analysis.boron) {
    const b = parseFloat(analysis.boron);
    if (b < 0.2) alerts.push({ severity: "medium", title: "Deficiencia de Boro (B)", description: `B disponible (${b} ppm) por debajo de 0.2 ppm. Afecta polinización y fructificación.`, isRead: false });
    else if (b > 2) alerts.push({ severity: "high", title: "Toxicidad de Boro (B)", description: `B (${b} ppm) supera 2 ppm. El boro en exceso es fitotóxico y puede quemar los márgenes foliares.`, isRead: false });
  }

  // Low severity for mild MO deviation
  if (analysis.organicMatter) {
    const om = parseFloat(analysis.organicMatter);
    if (om >= ranges.organicMatter[0] && om < ranges.organicMatter[0] * 1.15) {
      alerts.push({ severity: "low", title: "Materia orgánica en límite inferior", description: `La MO (${om}%) está cerca del límite óptimo inferior (${ranges.organicMatter[0]}%). Continuar con prácticas regenerativas.`, isRead: false });
    }
  }

  return alerts;
}

// Helper function to generate water quality alerts (FAO 29 irrigation water quality guidelines)
function generateWaterAlerts(analysis: any): { severity: "high" | "medium" | "low"; title: string; description: string; isRead: boolean }[] {
  const alerts: { severity: "high" | "medium" | "low"; title: string; description: string; isRead: boolean }[] = [];

  if (analysis.electricConductivity) {
    const ec = parseFloat(analysis.electricConductivity);
    if (ec > 3) {
      alerts.push({ severity: "high", title: "Salinidad del agua: riesgo alto", description: `CE (${ec} dS/m) supera 3 dS/m. El agua causa reducción severa de rendimiento en la mayoría de los cultivos.`, isRead: false });
    } else if (ec > 1) {
      alerts.push({ severity: "medium", title: "Salinidad del agua: riesgo moderado", description: `CE (${ec} dS/m) entre 1–3 dS/m. Puede afectar cultivos sensibles. Considerar fraccionamiento del riego.`, isRead: false });
    }
  }

  if (analysis.ph) {
    const ph = parseFloat(analysis.ph);
    if (ph < 6.5 || ph > 8.5) {
      alerts.push({ severity: "high", title: `pH del agua fuera de rango (${ph.toFixed(1)})`, description: `pH óptimo para riego: 6.5–8.5. ${ph < 6.5 ? "Agua ácida puede corroer equipos y movilizar metales." : "Agua alcalina favorece precipitación de Ca/Mg en el suelo y tuberías."}`, isRead: false });
    }
  }

  if (analysis.sar) {
    const sar = parseFloat(analysis.sar);
    if (sar > 10) {
      alerts.push({ severity: "high", title: "Riesgo alto de sodificación (SAR)", description: `SAR ${sar.toFixed(1)} > 10. El agua degrada la estructura del suelo, reduce infiltración y puede causar acumulación de sodio.`, isRead: false });
    } else if (sar > 6) {
      alerts.push({ severity: "medium", title: "Riesgo moderado de sodificación (SAR)", description: `SAR ${sar.toFixed(1)} entre 6–10. Monitorear permeabilidad del suelo. Aplicar enmiendas cálcicas si es necesario.`, isRead: false });
    }
  }

  if (analysis.rsc) {
    const rsc = parseFloat(analysis.rsc);
    if (rsc > 2.5) {
      alerts.push({ severity: "high", title: "RSC elevado — riesgo de alcalinización", description: `Carbonato Sódico Residual (${rsc.toFixed(1)} meq/L) > 2.5. El agua precipitará calcio y dejará sodio libre en el suelo.`, isRead: false });
    } else if (rsc > 1.25) {
      alerts.push({ severity: "medium", title: "RSC moderado", description: `RSC (${rsc.toFixed(1)} meq/L) entre 1.25–2.5. Agua marginal, monitorear el perfil de sodio del suelo.`, isRead: false });
    }
  }

  if (analysis.boron) {
    const b = parseFloat(analysis.boron);
    if (b > 3) {
      alerts.push({ severity: "high", title: "Toxicidad de Boro en agua de riego", description: `Boro (${b} mg/L) > 3 mg/L. Causa quemaduras en hojas y bordes necróticos en cultivos sensibles.`, isRead: false });
    } else if (b > 1) {
      alerts.push({ severity: "medium", title: "Boro elevado en agua de riego", description: `Boro (${b} mg/L) entre 1–3 mg/L. Riesgo moderado en cultivos sensibles (cítricos, aguacate, poroto).`, isRead: false });
    }
  }

  if (analysis.chlorides) {
    const cl = parseFloat(analysis.chlorides);
    if (cl > 350) {
      alerts.push({ severity: "high", title: "Cloruros elevados en agua", description: `Cloruros (${cl} mg/L) > 350 mg/L. Puede causar quemaduras foliares en riego por aspersión y toxicidad acumulada.`, isRead: false });
    } else if (cl > 180) {
      alerts.push({ severity: "medium", title: "Cloruros moderados en agua", description: `Cloruros (${cl} mg/L) entre 180–350 mg/L. Riesgo moderado, especialmente en cultivos sensibles.`, isRead: false });
    }
  }

  if (analysis.sodium) {
    const na = parseFloat(analysis.sodium);
    if (na > 200) {
      alerts.push({ severity: "medium", title: "Sodio elevado en agua de riego", description: `Na (${na} mg/L) > 200 mg/L. Puede acumularse en el suelo y degradar su estructura con el tiempo.`, isRead: false });
    }
  }

  return alerts;
}

// Chat API endpoints - these are registered inside registerRoutes below
function registerChatEndpoints(app: Express, isAuthenticated: any, isActiveUser: any) {
  // Multer for stage observation photo uploads (T250)
  const uploadImage = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const allowed = /\.(jpg|jpeg|png|webp)$/i;
      if (allowed.test(path.extname(file.originalname))) {
        cb(null, true);
      } else {
        cb(new Error("Solo imágenes (jpg, png, webp)"));
      }
    },
  });

  // Multer for sampling point photo uploads
  const samplingPhotosDir = path.join(process.cwd(), "uploads", "sampling");
  if (!fs.existsSync(samplingPhotosDir)) {
    fs.mkdirSync(samplingPhotosDir, { recursive: true });
  }
  const samplingPhotoUpload = multer({
    storage: multer.diskStorage({
      destination: samplingPhotosDir,
      filename: (req, file, cb) => {
        const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`;
        cb(null, uniqueName);
      },
    }),
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (/\.(jpg|jpeg|png|webp|heic)$/i.test(path.extname(file.originalname))) {
        cb(null, true);
      } else {
        cb(new Error("Solo imágenes (jpg, png, webp, heic)"));
      }
    },
  });

  // Get available AI providers and their status
  app.get("/api/ai-providers", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const providers = [
        {
          id: "openai" as AIProvider,
          name: "AgRegen IA",
          description: "Razonamiento profundo con literatura científica y contexto geográfico",
          ...checkProviderAvailability("openai"),
        },
      ];
      res.json(providers);
    } catch (error) {
      console.error("Error fetching AI providers:", error);
      res.status(500).json({ message: "Error al obtener proveedores de IA" });
    }
  });

  // Get conversations for a parcel
  app.get("/api/parcels/:parcelId/conversations", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.parcelId);
      if (!parcel || parcel.userId !== (req.user as User).id) {
        return res.status(403).json({ message: "No tienes acceso a esta parcela" });
      }
      const conversations = await storage.getConversationsByParcel(req.params.parcelId);
      res.json(conversations);
    } catch (error) {
      console.error("Error fetching conversations:", error);
      res.status(500).json({ message: "Error al obtener conversaciones" });
    }
  });

  // Create a new conversation
  app.post("/api/parcels/:parcelId/conversations", isAuthenticated, isActiveUser, async (req, res) => {
    console.log("=== POST /api/parcels/:parcelId/conversations ENDPOINT HIT ===");
    try {
      const user = req.user as User;
      const { aiProvider } = req.body;
      const validProvider = aiProvider === "openai" ? aiProvider : "openai";
      const parcel = await storage.getParcel(req.params.parcelId);
      if (!parcel || parcel.userId !== user.id) {
        return res.status(403).json({ message: "No tienes acceso a esta parcela" });
      }
      console.log("Creating conversation for parcel:", req.params.parcelId, "user:", user.id, "aiProvider:", validProvider);
      const conversation = await storage.createConversation({
        parcelId: req.params.parcelId,
        userId: user.id,
        title: null,
        aiProvider: validProvider,
      });
      console.log("Created conversation:", conversation);
      res.status(201).json(conversation);
    } catch (error) {
      console.error("Error creating conversation:", error);
      res.status(500).json({ message: "Error al crear conversación" });
    }
  });

  // Update conversation AI provider
  app.patch("/api/conversations/:conversationId/provider", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const { aiProvider } = req.body;
      if (!aiProvider || aiProvider !== "openai") {
        return res.status(400).json({ message: "Proveedor de IA inválido" });
      }

      const conversation = await storage.getConversation(req.params.conversationId);
      if (!conversation) {
        return res.status(404).json({ message: "Conversación no encontrada" });
      }
      if (conversation.userId !== (req.user as User).id) {
        return res.status(403).json({ message: "No tienes acceso a esta conversación" });
      }

      const availability = checkProviderAvailability(aiProvider);
      if (!availability.available) {
        return res.status(400).json({ message: availability.message });
      }

      await storage.updateConversationProvider(req.params.conversationId, aiProvider);
      res.json({ success: true, aiProvider });
    } catch (error) {
      console.error("Error updating conversation provider:", error);
      res.status(500).json({ message: "Error al actualizar proveedor de IA" });
    }
  });

  // ── Chat image upload (for GPT-4 Vision diagnosis) ───────────────────────────
  const chatImageUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = /\.(jpg|jpeg|png|webp)$/i;
      if (allowed.test(path.extname(file.originalname))) {
        cb(null, true);
      } else {
        cb(new Error("Solo imágenes JPG, PNG o WebP"));
      }
    },
  });

  app.post(
    "/api/conversations/:conversationId/chat-image",
    isAuthenticated,
    isActiveUser,
    chatImageUpload.single("image"),
    async (req: any, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ message: "Imagen requerida" });
        }
        const conversation = await storage.getConversation(req.params.conversationId);
        if (!conversation) {
          return res.status(404).json({ message: "Conversación no encontrada" });
        }
        if (conversation.userId !== req.user.id) {
          return res.status(403).json({ message: "No tienes acceso a esta conversación" });
        }

        const ext = path.extname(req.file.originalname).toLowerCase() || ".jpg";
        const subPath = `chat-images/${req.params.conversationId}/${Date.now()}${ext}`;

        // Build the GCS path directly so we can set public ACL and get a URL
        // that OpenAI Vision can fetch (the proxy URL /api/media/public/... is
        // only reachable inside this server, not from OpenAI's network).
        const publicPaths = (process.env.PUBLIC_OBJECT_SEARCH_PATHS || "")
          .split(",").map((p: string) => p.trim()).filter(Boolean);
        if (!publicPaths.length) {
          return res.status(500).json({ message: "Almacenamiento público no configurado" });
        }
        const basePath = publicPaths[0];
        const normalized = basePath.startsWith("/") ? basePath : `/${basePath}`;
        const gcsparts = normalized.split("/").filter(Boolean);
        const bucketName = gcsparts[0];
        const prefix = gcsparts.slice(1).join("/");
        const objectName = prefix ? `${prefix}/${subPath}` : subPath;

        const gcsFile = objectStorageClient.bucket(bucketName).file(objectName);
        await gcsFile.save(req.file.buffer, {
          contentType: req.file.mimetype,
          predefinedAcl: "publicRead",
        });

        // Direct GCS public URL — accessible by OpenAI Vision API
        const imageUrl = `https://storage.googleapis.com/${bucketName}/${objectName}`;
        res.json({ imageUrl });
      } catch (err: any) {
        console.error("[chat-image] upload error:", err);
        res.status(500).json({ message: err.message || "Error al subir imagen" });
      }
    }
  );

  // Get messages for a conversation
  app.get("/api/conversations/:conversationId/messages", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const conversation = await storage.getConversation(req.params.conversationId);
      if (!conversation) return res.status(404).json({ message: "Conversación no encontrada" });
      if (conversation.userId !== (req.user as User).id) {
        return res.status(403).json({ message: "No tienes acceso a esta conversación" });
      }
      const messages = await storage.getMessagesByConversation(req.params.conversationId);
      res.json(messages);
    } catch (error) {
      console.error("Error fetching messages:", error);
      res.status(500).json({ message: "Error al obtener mensajes" });
    }
  });

  // Send a message and get AI response
  app.post("/api/conversations/:conversationId/messages", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const { message, deepMode, diagnosisMode, imageUrl } = req.body;
      if (!message && !imageUrl) {
        return res.status(400).json({ message: "Mensaje o imagen requeridos" });
      }
      const userMessageText = typeof message === "string" ? message : (imageUrl ? "" : "");
      const requestId = req.body.requestId;
      if (requestId != null && (typeof requestId !== "string" || !/^[a-zA-Z0-9_-]{16,80}$/.test(requestId))) {
        return res.status(400).json({ message: "Identificador de solicitud inválido" });
      }

      const conversation = await storage.getConversation(req.params.conversationId);
      if (!conversation) {
        return res.status(404).json({ message: "Conversación no encontrada" });
      }
      if (conversation.userId !== (req.user as User).id) {
        return res.status(403).json({ message: "No tienes acceso a esta conversación" });
      }

      // Get parcel and all related data
      const parcel = await storage.getParcel(conversation.parcelId);
      if (!parcel) {
        return res.status(404).json({ message: "Parcela no encontrada" });
      }
      if (parcel.userId !== (req.user as User).id) {
        return res.status(403).json({ message: "No tienes acceso a esta parcela" });
      }

      // Gather all context
      const [parcelData, soilRows, tillagePractices, cropRotation, animalIntegration, livelihood, weatherData, existingMessages, sharedKnowledge, soilBiologyList, tissueAnalysisList, waterAnalysisList, cycleDetail, parcelMemoryRecord, operationalLog, parcelAlerts, moduleCosts, fieldLogs, marketPrice] = await Promise.all([
        // 200 points covers ~12 months of Sentinel-2 bi-weekly data for compararHistorico
        storage.getParcelData(parcel.id, 200),
        storage.getSoilAnalysisByParcel(parcel.id),
        storage.getTillagePracticesByParcel(parcel.id),
        storage.getCropRotationByParcel(parcel.id),
        storage.getAnimalIntegrationByParcel(parcel.id),
        storage.getLivelihoodByParcel(parcel.id),
        getFullWeatherData(parseFloat(parcel.latitude), parseFloat(parcel.longitude), parcel.plantingDate, parcel.crop),
        storage.getMessagesByConversation(req.params.conversationId),
        storage.getSharedKnowledgeByCrop(parcel.crop, 5),
        storage.getSoilBiologyByParcel(parcel.id),
        storage.getPlantTissueAnalysisByParcel(parcel.id),
        storage.getWaterAnalysisByParcel(parcel.id),
        storage.getLatestCropCycleDetail(parcel.id).catch(() => null),
        storage.getParcelMemory(parcel.id, (req as any).user.id).catch(() => undefined),
        storage.getConfirmedFieldLogContext((req as any).user.id, parcel.id, { query: userMessageText, limit: 12 }).catch(() => ({
          period: { from: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString(), to: new Date().toISOString() },
          limited: false, totalConfirmedInPeriod: 0, events: [],
        })),
        storage.getAlertsByParcel(parcel.id),
        storage.getProductionCostsByParcel(parcel.id),
        storage.getActiveFieldLogs((req.user as User).id, parcel.id),
        getSniimPrice(parcel.crop, parcel.location).catch(() => null),
      ]);
      const soilHistory = distinctSoilAnalyses(soilRows);
      const soilAnalysis = soilHistory[0];
      const sourceId = requestId ? `web:${conversation.id}:${requestId}` : undefined;
      const priorReply = sourceId && existingMessages.find(m => m.role === "assistant" &&
        (m.contextSnapshot as any)?.webSourceId === sourceId);
      if (priorReply) {
        if ((priorReply.contextSnapshot as any)?.userText !== userMessageText)
          return res.status(409).json({ message: "Solicitud ya utilizada con otro contenido" });
        return res.json({ assistantMessage: priorReply, providerUsed: (priorReply.contextSnapshot as any)?.aiProvider,
          userMessage: existingMessages.find(m => m.role === "user" && (m.contextSnapshot as any)?.webSourceId === sourceId) });
      }
      const memorySummary = parcelMemoryRecord?.summary || "";

      // Fetch live GEE data if: no satellite data cached, OR latest data is >14 days old
      const latestDataDate = parcelData.length > 0 ? new Date(parcelData[0].date) : null;
      const isDataStale = !latestDataDate || (Date.now() - latestDataDate.getTime()) > 14 * 24 * 60 * 60_000;
      if (isDataStale && parcel.latitude && parcel.longitude && isGEEAvailable()) {
        try {
          let coords: [number, number][] = [];
          if (parcel.polygonCoordinates && Array.isArray(parcel.polygonCoordinates)) {
            coords = parcel.polygonCoordinates as [number, number][];
          } else {
            const lat = Number(parcel.latitude);
            const lng = Number(parcel.longitude);
            const offset = 0.01;
            coords = [
              [lat - offset, lng - offset],
              [lat - offset, lng + offset],
              [lat + offset, lng + offset],
              [lat + offset, lng - offset],
            ];
          }
          const endDate = new Date().toISOString().split("T")[0];
          // Look back further when refreshing stale data
          const lookbackDays = parcelData.length === 0 ? 90 : 30;
          const startDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
          const liveIndices = await getVegetationIndices({ coordinates: coords }, startDate, endDate);
          if (liveIndices.length > 0) {
            const latest = liveIndices[liveIndices.length - 1];
            // Only create new record if the date is newer than the last saved date
            const latestDateStr = latestDataDate?.toISOString().split("T")[0] ?? "";
            if (!latestDataDate || latest.date > latestDateStr) {
              const saved = await saveParcelDataWithAlertCheck({
                parcelId: parcel.id,
                date: new Date(latest.date),
                ndvi: latest.ndvi,
                evi: latest.evi,
                temperature: null,
                precipitation: null,
              });
              parcelData.unshift(saved);
              console.log(`[AI chat] GEE refresh for parcel ${parcel.id}: NDVI=${latest.ndvi?.toFixed(3)} EVI=${latest.evi?.toFixed(3)} date=${latest.date}`);
            }
          }
        } catch (geeErr) {
          console.warn("[AI chat] Live GEE fetch failed (non-critical):", geeErr);
        }
      }

      // Save user message
      const userMsg = await storage.createMessage({
        conversationId: req.params.conversationId,
        role: "user",
        content: userMessageText || (imageUrl ? "📷 Imagen adjunta" : ""),
        imageUrl: imageUrl || null,
        contextSnapshot: { channel: "web", webSourceId: sourceId },
      });

      // Build context
      const context: ParcelContext = {
        parcel,
        parcelData,
        soilAnalysis: soilAnalysis || null,
        soilHistory,
        labMicrobiology: latestLabMicrobiology(soilBiologyList),
        economy: { ...summarizeParcelEconomy(projectParcelCosts(moduleCosts, fieldLogs, cycleDetail), cycleDetail?.totalPlannedCost),
          paidPrices: producerPriceHistory(moduleCosts, fieldLogs), previousHarvests: previousHarvests(fieldLogs) },
        climatology: await getParcelClimatology(Number(parcel.latitude), Number(parcel.longitude)),
        marketPrice,
        alerts: parcelAlerts.filter(a => !a.actionStatus),
        tillagePractices,
        cropRotation,
        animalIntegration: animalIntegration || null,
        livelihood: livelihood || null,
        weatherData: weatherData ? {
          currentTemp: weatherData.current.temperature,
          humidity: weatherData.current.humidity,
          precipitation: weatherData.current.precipitation ?? 0,
          observedAt: new Date().toISOString(),
          forecast: weatherData.forecast.slice(0, 5),
        } : undefined,
        soilBiology: soilBiologyList[0] || null,
        tissueAnalysis: tissueAnalysisList[0] || null,
        waterAnalysis: waterAnalysisList[0] || null,
        cycleDetail: cycleDetail || null,
        operationalLog,
      };

      // Build chat history
      const chatHistory: ChatHistory[] = existingMessages.map(m => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

      // Get AI provider from conversation (default to openai)
      const aiProvider = (conversation.aiProvider as AIProvider) || "openai";

      // Generate AI response — deep mode uses the agentic reasoning loop
      let aiResponse: string;
      let providerUsed: string;
      let reasoningSteps: ReasoningStep[] = [];
      let fieldLogRecord: FieldLogTurn["record"] = null;

      if (diagnosisMode && imageUrl) {
        // Dedicated plant disease / pest / deficiency diagnosis from photo
        const result = await generateDiagnosisResponse(userMessageText, context, chatHistory, imageUrl, aiProvider, memorySummary || undefined);
        aiResponse = result.response;
        providerUsed = result.providerUsed;
      } else if (deepMode) {
        const result = await generateAgenticResponse(userMessageText, context, chatHistory, sharedKnowledge, storage, aiProvider, imageUrl || undefined, memorySummary || undefined);
        aiResponse = result.response;
        providerUsed = result.providerUsed;
        reasoningSteps = result.reasoningSteps;
      } else {
        const result = await generateAIResponse(userMessageText, context, chatHistory, sharedKnowledge, aiProvider, imageUrl || undefined, memorySummary || undefined, new Date(userMsg.createdAt));
        aiResponse = result.response;
        providerUsed = result.providerUsed;
        fieldLogRecord = result.fieldLogRecord || null;
      }
      const registration = await persistWebFieldLog({
        storage, userId: (req.user as User).id, parcelId: parcel.id,
        sourceId: sourceId || `web:${conversation.id}:${userMsg.id}`, originalText: userMessageText,
        cycleDetailId: cycleDetail?.id, response: nutritionResponseSafety(aiResponse, { soil: soilAnalysis,
          soilType: parcel.soilType, area: parcel.area, yieldTarget: cycleDetail?.expectedYieldTon }),
        record: fieldLogRecord, now: new Date(userMsg.createdAt),
        mode: diagnosisMode && imageUrl ? "diagnosis" : deepMode ? "deep" : "normal",
      });
      aiResponse = registration.response;

      // Save AI response — include reasoningSteps in contextSnapshot so the
      // frontend can restore the reasoning panel after a page reload.
      const assistantMsg = await storage.createMessage({
        conversationId: req.params.conversationId,
        role: "assistant",
        content: aiResponse,
        contextSnapshot: {
          channel: "web", webSourceId: sourceId, userText: userMessageText,
          fieldLogEntryId: registration.entry?.id ?? null,
          parcelData: parcelData[0] || null,
          soilAnalysis: soilAnalysis || null,
          weatherData: weatherData?.current || null,
          aiProvider: providerUsed,
          reasoningSteps: reasoningSteps.length > 0 ? reasoningSteps : undefined,
        },
      });

      // Update conversation title if first message
      if (existingMessages.length === 0) {
        const title = (typeof message === "string" ? message : userMessageText || "Consulta").slice(0, 50) + ((typeof message === "string" ? message : "").length > 50 ? "..." : "");
        await storage.updateConversationTitle(req.params.conversationId, title);
      }

      res.json({
        userMessage: userMsg,
        assistantMessage: assistantMsg,
        providerUsed,
        reasoningSteps,
      });

      // Background: update parcel memory asynchronously (fire-and-forget)
      const userId = (req as any).user.id;
      const allMsgs: ChatHistory[] = [
        ...chatHistory,
        { role: "user", content: userMessageText || "📷 Imagen adjunta" },
        { role: "assistant", content: aiResponse },
      ];
      generateMemorySummary(allMsgs, memorySummary, parcel.name, parcel.crop)
        .then(newSummary => {
          if (newSummary && newSummary.trim().length > 0) {
            return storage.upsertParcelMemory(parcel.id, userId, newSummary);
          }
        })
        .catch(err => console.error("[memory] background update failed:", err));
    } catch (error: any) {
      console.error("Error in chat:", error);
      res.status(500).json({ message: error.message || "Error al procesar mensaje" });
    }
  });

  // Parcel memory endpoints
  app.get("/api/parcels/:parcelId/memory", isAuthenticated, isActiveUser, async (req: any, res) => {
    try {
      const parcel = await storage.getParcel(req.params.parcelId);
      if (!parcel || parcel.userId !== req.user.id) {
        return res.status(403).json({ message: "No tienes acceso a esta parcela" });
      }
      const memory = await storage.getParcelMemory(req.params.parcelId, req.user.id);
      res.json({ summary: memory?.summary || "", updatedAt: memory?.updatedAt || null });
    } catch (error) {
      res.status(500).json({ message: "Error al obtener memoria" });
    }
  });

  app.delete("/api/parcels/:parcelId/memory", isAuthenticated, isActiveUser, async (req: any, res) => {
    try {
      const parcel = await storage.getParcel(req.params.parcelId);
      if (!parcel || parcel.userId !== req.user.id) {
        return res.status(403).json({ message: "No tienes acceso a esta parcela" });
      }
      await storage.clearParcelMemory(req.params.parcelId, req.user.id);
      res.json({ message: "Memoria borrada" });
    } catch (error) {
      res.status(500).json({ message: "Error al borrar memoria" });
    }
  });

  // Mark a recommendation as helpful (contributes to shared knowledge)
  app.post("/api/conversations/:conversationId/helpful", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const { messageId, problemType, recommendation } = req.body;
      
      const conversation = await storage.getConversation(req.params.conversationId);
      if (!conversation) {
        return res.status(404).json({ message: "Conversación no encontrada" });
      }
      if (conversation.userId !== (req.user as User).id) {
        return res.status(403).json({ message: "No tienes acceso a esta conversación" });
      }
      if (typeof recommendation !== "string" || !recommendation.trim()) {
        return res.status(400).json({ message: "Recomendación requerida" });
      }

      const parcel = await storage.getParcel(conversation.parcelId);
      if (!parcel) {
        return res.status(404).json({ message: "Parcela no encontrada" });
      }
      if (parcel.userId !== (req.user as User).id) {
        return res.status(403).json({ message: "No tienes acceso a esta parcela" });
      }

      const soilAnalysis = await storage.getLatestSoilAnalysis(parcel.id);

      // Add to shared knowledge
      await storage.createSharedKnowledge({
        crop: parcel.crop,
        problemType: problemType || "consulta_general",
        recommendation: recommendation,
        soilContext: soilAnalysis ? {
          ph: soilAnalysis.ph,
          organicMatter: soilAnalysis.organicMatter,
          soilType: parcel.soilType,
        } : null,
        climateContext: null,
        sourceParcelId: parcel.id,
      });

      res.json({ success: true, message: "Gracias por tu retroalimentación. Tu experiencia ayudará a otros agricultores." });
    } catch (error) {
      console.error("Error saving helpful feedback:", error);
      res.status(500).json({ message: "Error al guardar retroalimentación" });
    }
  });

  app.get("/api/parcels/:id/iot-devices", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(String(req.params.id));
      if (!parcel || parcel.userId !== (req.user as any).id && (req.user as any).role !== "admin") return res.status(403).json({ message: "No autorizado" });
      const devices = await storage.getIotDevicesByParcel(req.params.id);
      res.json({ devices });
    } catch (error) {
      res.status(500).json({ message: "Error al obtener dispositivos IoT" });
    }
  });

  app.post("/api/parcels/:id/iot-devices", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel || parcel.userId !== (req.user as any).id && (req.user as any).role !== "admin") return res.status(403).json({ message: "No autorizado" });
      const { name, sensorType, latitude, longitude, unit } = req.body;
      if (!name || !sensorType) return res.status(400).json({ message: "Nombre y tipo de sensor son requeridos" });
      const device = await storage.createIotDevice({
        name, sensorType, latitude, longitude, unit,
        parcelId: req.params.id,
        userId: (req.user as any).id,
      });
      res.json({ device });
    } catch (error) {
      res.status(500).json({ message: "Error al crear dispositivo IoT" });
    }
  });

  app.patch("/api/iot-devices/:id", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const { isActive, name } = req.body;
      const device = await storage.updateIotDeviceByUser(req.params.id, (req.user as any).id, { ...(isActive !== undefined && { isActive }), ...(name && { name }) });
      if (!device) return res.status(404).json({ message: "Dispositivo no encontrado" });
      res.json({ device });
    } catch (error) {
      res.status(500).json({ message: "Error al actualizar dispositivo" });
    }
  });

  app.delete("/api/iot-devices/:id", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const deleted = await storage.deleteIotDeviceByUser(req.params.id, (req.user as any).id);
      if (!deleted) return res.status(404).json({ message: "Dispositivo no encontrado" });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Error al eliminar dispositivo" });
    }
  });

  app.get("/api/iot-devices/:id/readings", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const readings = await storage.getIotReadings(req.params.id, limit);
      res.json({ readings });
    } catch (error) {
      res.status(500).json({ message: "Error al obtener lecturas" });
    }
  });

  app.post("/api/iot-devices/:id/readings", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const { value, timestamp } = req.body;
      if (value === undefined || value === null) return res.status(400).json({ message: "Valor es requerido" });
      const reading = await storage.createIotReading({
        value,
        timestamp: timestamp || new Date().toISOString(),
        deviceId: req.params.id,
      });
      res.json({ reading });
    } catch (error) {
      res.status(500).json({ message: "Error al crear lectura" });
    }
  });

  app.get("/api/parcels/:id/irrigation-logs", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel || parcel.userId !== (req.user as any).id && (req.user as any).role !== "admin") return res.status(403).json({ message: "No autorizado" });
      const logs = await storage.getIrrigationLogsByParcel(req.params.id);
      res.json({ logs });
    } catch (error) {
      res.status(500).json({ message: "Error al obtener registros de riego" });
    }
  });

  app.post("/api/parcels/:id/irrigation-logs", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel || parcel.userId !== (req.user as any).id && (req.user as any).role !== "admin") return res.status(403).json({ message: "No autorizado" });
      const { date, volumeLiters, durationMinutes, method, notes } = req.body;
      if (!date) return res.status(400).json({ message: "Fecha es requerida" });
      const log = await storage.createIrrigationLog({
        date, volumeLiters, durationMinutes, method, notes,
        parcelId: req.params.id,
        userId: (req.user as any).id,
      });
      res.json({ log });
    } catch (error) {
      res.status(500).json({ message: "Error al crear registro de riego" });
    }
  });

  app.delete("/api/irrigation-logs/:id", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const deleted = await storage.deleteIrrigationLogByUser(req.params.id, (req.user as any).id);
      if (!deleted) return res.status(404).json({ message: "Registro no encontrado" });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Error al eliminar registro de riego" });
    }
  });

  app.get("/api/parcels/:id/drone-flights", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel || parcel.userId !== (req.user as any).id && (req.user as any).role !== "admin") return res.status(403).json({ message: "No autorizado" });
      const flights = await storage.getDroneFlightsByParcel(req.params.id);
      res.json({ flights });
    } catch (error) {
      res.status(500).json({ message: "Error al obtener vuelos de dron" });
    }
  });

  app.post("/api/parcels/:id/drone-flights", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel || parcel.userId !== (req.user as any).id && (req.user as any).role !== "admin") return res.status(403).json({ message: "No autorizado" });
      const { flightDate, indexType, resolution, notes } = req.body;
      if (!flightDate) return res.status(400).json({ message: "Fecha de vuelo es requerida" });
      const flight = await storage.createDroneFlight({
        flightDate, indexType, resolution, notes,
        parcelId: req.params.id,
        userId: (req.user as any).id,
      });
      res.json({ flight });
    } catch (error) {
      res.status(500).json({ message: "Error al registrar vuelo de dron" });
    }
  });

  app.delete("/api/drone-flights/:id", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const deleted = await storage.deleteDroneFlightByUser(req.params.id, (req.user as any).id);
      if (!deleted) return res.status(404).json({ message: "Vuelo no encontrado" });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Error al eliminar vuelo de dron" });
    }
  });

  // ─── Rendimiento y Cosecha por Zona (T153) ───────────────────────────────────

  app.get("/api/parcels/:id/management-zones", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
      if (parcel.userId !== (req.user as any).id && !parcel.isPublic && (req.user as any).role !== "admin") {
        return res.status(403).json({ message: "No autorizado" });
      }
      const zones = await storage.getManagementZonesByParcel(req.params.id);
      res.json({ zones });
    } catch (error) {
      console.error("Error getting management zones:", error);
      res.status(500).json({ message: "Error al obtener zonas de manejo" });
    }
  });

  app.get("/api/parcels/:id/yield-records", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
      if (parcel.userId !== (req.user as any).id && !parcel.isPublic && (req.user as any).role !== "admin") {
        return res.status(403).json({ message: "No autorizado" });
      }
      const records = await storage.getYieldRecordsByParcel(req.params.id);
      res.json({ records });
    } catch (error) {
      console.error("Error getting yield records:", error);
      res.status(500).json({ message: "Error al obtener registros de rendimiento" });
    }
  });

  app.post("/api/parcels/:id/yield-records", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel || parcel.userId !== (req.user as any).id) {
        return res.status(403).json({ message: "No autorizado" });
      }
      const { insertYieldRecordSchema } = await import("@shared/schema");
      const parsed = insertYieldRecordSchema.safeParse({
        ...req.body,
        parcelId: req.params.id,
        userId: (req.user as any).id,
      });
      if (!parsed.success) {
        const { fromZodError } = await import("zod-validation-error");
        return res.status(400).json({ message: fromZodError(parsed.error).message });
      }
      const record = await storage.createYieldRecord(parsed.data);
      res.status(201).json({ record });
    } catch (error) {
      console.error("Error creating yield record:", error);
      res.status(500).json({ message: "Error al registrar cosecha" });
    }
  });

  app.delete("/api/parcels/:id/yield-records/:recordId", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel || parcel.userId !== (req.user as any).id) {
        return res.status(403).json({ message: "No autorizado" });
      }
      const deleted = await storage.deleteYieldRecord(
        req.params.recordId,
        (req.user as any).id,
        req.params.id
      );
      if (!deleted) return res.status(404).json({ message: "Registro no encontrado" });
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting yield record:", error);
      res.status(500).json({ message: "Error al eliminar registro de rendimiento" });
    }
  });

  // ── SIAP yield benchmark — "¿Cómo te comparas?" ──────────────────────────────
  // GET /api/parcels/:id/yield-benchmark?crop=Maíz&year=2023
  // Compares producer's recorded yield vs SIAP state/national averages.
  app.get("/api/parcels/:id/yield-benchmark", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
      if (parcel.userId !== (req.user as any).id && !parcel.isPublic && (req.user as any).role !== "admin") {
        return res.status(403).json({ message: "No autorizado" });
      }

      // Determine crop: from query param, else latest crop cycle, else latest yield record
      let cropRaw: string | null = (req.query.crop as string | undefined) ?? null;
      let producerYield: number | null = null;
      let cycleYear: number | null = null;
      let cycleSeason: string | null = null;

      if (!cropRaw) {
        const cycles = await storage.getCropCycleDetails(parcel.id);
        const latestCycle = cycles[0] ?? null;
        if (latestCycle) {
          cropRaw = latestCycle.variety ?? null; // variety is crop name in some UIs
          if (latestCycle.actualYieldTon != null) {
            producerYield = parseFloat(String(latestCycle.actualYieldTon));
          }
          cycleYear = latestCycle.cycleYear;
          cycleSeason = latestCycle.cycleSeason;
        }
      }

      // Fall back to yield records if no cycle data
      if (!cropRaw || producerYield === null) {
        const yearParam = req.query.year ? parseInt(req.query.year as string) : null;
        const records = await storage.getYieldRecordsByParcel(parcel.id);
        const latest = yearParam
          ? records.find((r) => r.campaignYear === yearParam)
          : records[0] ?? null;
        if (latest) {
          if (!cropRaw) cropRaw = latest.crop;
          if (producerYield === null) producerYield = parseFloat(String(latest.yieldAvgTonHa));
          if (!cycleYear) cycleYear = latest.campaignYear;
        }
      }

      if (!cropRaw) {
        // Return empty benchmark — no crop info available
        return res.json({
          available: false,
          message: "Sin datos de cultivo disponibles para esta parcela",
        });
      }

      // Infer state: from parcel location first, then user profile
      let stateRaw: string | null = inferStateFromText(parcel.location ?? "");
      if (!stateRaw) {
        const user = await storage.getUser(parcel.userId);
        stateRaw = user?.state ?? null;
        if (stateRaw) stateRaw = inferStateFromText(stateRaw) ?? stateRaw;
      }

      const { normalizeCycle } = await import("./services/siap");
      const cycle = normalizeCycle(cycleSeason);
      const benchmark = getSIAPYieldBenchmark(cropRaw, stateRaw, cycle, producerYield);

      res.json({
        ...benchmark,
        cycleYear,
        cycleSeason,
        source: "SIAP — Cierre Agrícola 2022",
      });
    } catch (error) {
      console.error("Error fetching SIAP yield benchmark:", error);
      res.status(500).json({ message: "Error al obtener comparativa SIAP" });
    }
  });

  // ─── Manejo Variable por Zonas ───────────────────────────────────────────────

  // Master Variables catalog
  app.get("/api/master-variables", isAuthenticated, async (req, res) => {
    try {
      const vars = await storage.getMasterVariables();
      if (vars.length === 0) {
        // Auto-seed on first request
        await seedMasterVariables();
        const seeded = await storage.getMasterVariables();
        return res.json(seeded);
      }
      res.json(vars);
    } catch (error) {
      res.status(500).json({ message: "Error al obtener variables" });
    }
  });

  // Create a custom master variable (admin or researcher)
  app.post("/api/master-variables", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const user = req.user as User;
      if (!["admin", "researcher"].includes(user.role)) {
        return res.status(403).json({ message: "Solo administradores e investigadores pueden crear variables" });
      }
      const { code, name, unit, minValue, maxValue, optimalMin, optimalMax, description, defaultCv } = req.body;
      if (!code || !name || !unit || minValue == null || maxValue == null) {
        return res.status(400).json({ message: "code, name, unit, minValue y maxValue son requeridos" });
      }
      const variable = await storage.createMasterVariable({
        code: String(code).toUpperCase(),
        name: String(name),
        unit: String(unit),
        minValue: Number(minValue),
        maxValue: Number(maxValue),
        optimalMin: optimalMin != null ? Number(optimalMin) : null,
        optimalMax: optimalMax != null ? Number(optimalMax) : null,
        description: description ? String(description) : null,
        defaultCv: defaultCv != null ? Number(defaultCv) : null,
      });
      res.status(201).json(variable);
    } catch (error: any) {
      if (error.message?.includes("unique") || error.code === "23505") {
        return res.status(409).json({ message: "Ya existe una variable con ese código" });
      }
      res.status(500).json({ message: "Error al crear variable" });
    }
  });

  // Seed master variables (admin)
  app.post("/api/admin/master-variables/seed", isAuthenticated, async (req, res) => {
    try {
      if ((req.user as any).role !== "admin") return res.status(403).json({ message: "No autorizado" });
      await seedMasterVariables();
      const vars = await storage.getMasterVariables();
      res.json({ message: "Variables maestras sembradas", count: vars.length });
    } catch (error) {
      res.status(500).json({ message: "Error al sembrar variables" });
    }
  });

  // Sampling Campaigns
  app.get("/api/parcels/:id/sampling-campaigns", isAuthenticated, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel || parcel.userId !== (req.user as any).id && (req.user as any).role !== "admin") return res.status(403).json({ message: "No autorizado" });
      const campaigns = await storage.getSamplingCampaignsByParcel(req.params.id);
      res.json(campaigns);
    } catch (error) {
      res.status(500).json({ message: "Error al obtener campañas" });
    }
  });

  app.post("/api/parcels/:id/sampling-campaigns", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel || parcel.userId !== (req.user as any).id && (req.user as any).role !== "admin") return res.status(403).json({ message: "No autorizado" });

      const { variableId, name, gridType, nPointsPlanned, samplingDepth, notes } = req.body;
      if (!variableId || !name || !nPointsPlanned) {
        return res.status(400).json({ message: "variableId, name y nPointsPlanned son requeridos" });
      }

      // Generate AI instructions
      let aiInstructions: string | undefined;
      try {
        const variable = await storage.getMasterVariable(variableId);
        if (variable) {
          aiInstructions = await generateSamplingInstructions(
            variable.name, variable.unit, Number(nPointsPlanned),
            parcel.crop || "cultivo", parcel.soilType || undefined, Number(samplingDepth) || 20,
          );
        }
      } catch (e) {
        console.warn("Could not generate AI instructions:", e);
      }

      const campaign = await storage.createSamplingCampaign({
        parcelId: req.params.id,
        userId: (req.user as any).id,
        variableId,
        name,
        gridType: gridType || "regular",
        nPointsPlanned: Number(nPointsPlanned),
        samplingDepth: samplingDepth || "20.0",
        notes,
        aiInstructions,
        status: "designing",
      });
      res.status(201).json(campaign);
    } catch (error) {
      res.status(500).json({ message: "Error al crear campaña" });
    }
  });

  app.get("/api/sampling-campaigns/:id", isAuthenticated, async (req, res) => {
    try {
      const campaign = await storage.getSamplingCampaign(req.params.id);
      if (!campaign) return res.status(404).json({ message: "Campaña no encontrada" });
      const parcel = await storage.getParcel(campaign.parcelId);
      if (!parcel || parcel.userId !== (req.user as any).id && (req.user as any).role !== "admin") return res.status(403).json({ message: "No autorizado" });
      const variable = await storage.getMasterVariable(campaign.variableId);
      res.json({ ...campaign, variable });
    } catch (error) {
      res.status(500).json({ message: "Error al obtener campaña" });
    }
  });

  app.patch("/api/sampling-campaigns/:id", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const campaign = await storage.getSamplingCampaign(req.params.id);
      if (!campaign) return res.status(404).json({ message: "Campaña no encontrada" });
      const parcel = await storage.getParcel(campaign.parcelId);
      if (!parcel || parcel.userId !== (req.user as any).id && (req.user as any).role !== "admin") return res.status(403).json({ message: "No autorizado" });
      // Parse ISO date strings into Date objects for timestamp columns
      const body: any = { ...req.body };
      if (body.startedAt && typeof body.startedAt === "string") body.startedAt = new Date(body.startedAt);
      if (body.completedAt && typeof body.completedAt === "string") body.completedAt = new Date(body.completedAt);
      const updated = await storage.updateSamplingCampaign(req.params.id, body);
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating sampling campaign:", error);
      res.status(500).json({ message: "Error al actualizar campaña" });
    }
  });

  app.delete("/api/sampling-campaigns/:id", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const campaign = await storage.getSamplingCampaign(req.params.id);
      if (!campaign) return res.status(404).json({ message: "Campaña no encontrada" });
      const parcel = await storage.getParcel(campaign.parcelId);
      if (!parcel || parcel.userId !== (req.user as any).id && (req.user as any).role !== "admin") return res.status(403).json({ message: "No autorizado" });
      await storage.deleteSamplingCampaign(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Error al eliminar campaña" });
    }
  });

  // Generate sampling grid via geo-service
  app.post("/api/sampling-campaigns/:id/generate-grid", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const campaign = await storage.getSamplingCampaign(req.params.id);
      if (!campaign) return res.status(404).json({ message: "Campaña no encontrada" });
      const parcel = await storage.getParcel(campaign.parcelId);
      if (!parcel || parcel.userId !== (req.user as any).id && (req.user as any).role !== "admin") return res.status(403).json({ message: "No autorizado" });

      // Manual-mode campaigns must not auto-generate — points are placed by hand.
      if ((campaign.gridType || "regular") === "manual") {
        return res.status(400).json({
          message: "Esta campaña está en modo manual. Coloca los puntos directamente en el mapa.",
          code: "MANUAL_MODE",
        });
      }

      const polygonCoords = parcel.polygonCoordinates as any;
      if (!isValidPolygon(polygonCoords)) {
        return res.status(400).json({
          message: "La parcela no tiene un polígono válido. Dibújalo o corrígelo antes de generar la cuadrícula.",
          code: "INVALID_POLYGON",
        });
      }
      const orientationWarning = detectInvertedOrientation(polygonCoords);
      if (orientationWarning) {
        return res.status(400).json({
          message: orientationWarning,
          code: "POLYGON_ORIENTATION",
        });
      }

      // Protect any captured operator data — require explicit confirmation.
      const existingPoints = await storage.getSamplingPointsByCampaign(req.params.id);
      const capturedCount = existingPoints.filter(p => p.value != null).length;
      const force = req.body?.force === true || req.query?.force === "true";
      if (capturedCount > 0 && !force) {
        return res.status(409).json({
          message: `La campaña ya tiene ${capturedCount} punto(s) con valores capturados. Regenerar la cuadrícula los borrará.`,
          code: "HAS_CAPTURED_DATA",
          capturedCount,
        });
      }

      // Convert [lat, lng] to [lon, lat] for geo-service
      const polygon = (polygonCoords as [number, number][]).map(([lat, lng]) => [lng, lat] as [number, number]);

      const nPoints = campaign.nPointsPlanned ?? 10;
      const gridType = campaign.gridType || "regular";

      const geoServiceUrl = process.env.GEO_SERVICE_URL || "http://127.0.0.1:8000";

      // ── Geo-service call with JS fallback (handles ECONNREFUSED in production) ──
      let gridGeojson: any = null;
      let usedFallback = false;
      let fallbackReason: string | null = null;
      try {
        const bufferM = typeof req.body?.buffer_m === "number" ? req.body.buffer_m : 5;
        const geoResponse = await fetchWithTimeout(`${geoServiceUrl}/grid`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ polygon, n_points: nPoints, grid_type: gridType, buffer_m: bufferM }),
        });
        if (geoResponse.ok) {
          gridGeojson = await geoResponse.json().catch(() => null);
        } else {
          const errText = await geoResponse.text().catch(() => "error");
          fallbackReason = `geo-service HTTP ${geoResponse.status}: ${errText}`;
          console.warn(`Geo-service grid ${geoResponse.status}: ${errText} — using JS fallback`);
        }
      } catch (fetchErr: any) {
        fallbackReason = `geo-service unreachable: ${fetchErr.message}`;
        console.warn(`Geo-service unreachable (${fetchErr.message}) — using JS grid fallback`);
      }

      if (!gridGeojson) {
        gridGeojson = generateGridFallback(polygon, nPoints, gridType);
        usedFallback = true;
      }

      // ── Persist grid geometry + reset status ────────────────────────────────
      // nPointsPlanned is updated *after* points are created so the DB stays
      // consistent even if the bulk-insert fails.
      // Capture the returned campaign so the response always reflects the
      // latest persisted state even when no second update is needed.
      let latestCampaign = await storage.updateSamplingCampaign(req.params.id, {
        gridGeojson: gridGeojson as any,
        status: "designing",
      });

      // ── Recreate sampling points ─────────────────────────────────────────────
      const features = gridGeojson.features || [];
      const actualCount = features.length;

      await storage.deleteSamplingPointsByCampaign(req.params.id);
      const pointsToCreate = features.map((f: any, i: number) => ({
        campaignId: req.params.id,
        pointIndex: i + 1,
        latPlanned: String(f.geometry.coordinates[1]),
        lonPlanned: String(f.geometry.coordinates[0]),
      }));
      if (pointsToCreate.length > 0) {
        await storage.bulkCreateSamplingPoints(pointsToCreate);
      }

      // ── Sync nPointsPlanned AFTER points are in DB ───────────────────────────
      // Compare against the *persisted* DB value (campaign.nPointsPlanned), not
      // the requested nPoints (which defaults to 10 when DB is null). This
      // ensures the update runs whenever DB doesn't already match actual rows.
      const persistedN = campaign.nPointsPlanned;
      if (persistedN !== actualCount) {
        latestCampaign = await storage.updateSamplingCampaign(req.params.id, { nPointsPlanned: actualCount });
      }

      // Extract padding and buffer metadata so the UI can show informational notices.
      const meta = (gridGeojson as any).meta ?? {};
      const paddedCount: number = meta.padded_count ?? 0;
      const gridCount: number = meta.grid_count ?? actualCount;
      const bufferMeta = meta.buffer ?? {
        buffer_applied_m: 0,
        buffer_skipped: true,
        polygon_buffered: null,
      };

      res.json({
        gridGeojson,
        pointsCreated: actualCount,
        pointsRequested: nPoints,
        paddedCount,
        gridCount,
        usedPadding: paddedCount > 0,
        bufferMeta,
        campaign: latestCampaign,
        fallback: usedFallback,
        fallbackReason: usedFallback ? fallbackReason : null,
      });
    } catch (error: any) {
      console.error("Grid generation error:", error);
      res.status(500).json({ message: `Error al generar cuadrícula: ${error.message}` });
    }
  });

  // Design grid — sample-size estimation (Cochran, FAO/USDA, Cressie-Wikle) for a campaign.
  // F1-03/F1-04: calls Python geo-service as canonical source; falls back to local formulas.
  app.post("/api/sampling-campaigns/:id/design-grid", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const campaign = await storage.getSamplingCampaign(req.params.id);
      if (!campaign) return res.status(404).json({ message: "Campaña no encontrada" });
      const parcel = await storage.getParcel(campaign.parcelId);
      if (!parcel || parcel.userId !== (req.user as any).id && (req.user as any).role !== "admin") return res.status(403).json({ message: "No autorizado" });

      const { variabilityPct = 30, allowableError = 10, confidenceLevel = 90, variable_code } = req.body;

      // Try canonical geo-service endpoint first (F1-03)
      const geoServiceUrl = process.env.GEO_SERVICE_URL || "http://127.0.0.1:8000";
      const polygon = Array.isArray(parcel.polygonCoordinates) && parcel.polygonCoordinates.length >= 3
        ? parcel.polygonCoordinates.map((pt: [number, number]) => [pt[1], pt[0]])  // [lat,lon] → [lon,lat]
        : null;

      if (polygon) {
        try {
          const geoRes = await fetchWithTimeout(`${geoServiceUrl}/sample-size`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              polygon,
              cv_pct: Number(variabilityPct),
              precision_pct: Number(allowableError),
              confidence_level: Number(confidenceLevel),
              variable_code: variable_code ?? null,
            }),
          });
          if (geoRes.ok) {
            const canonical = await geoRes.json();
            const pu = canonical.params_used ?? canonical.params ?? {};
            const normalized = {
              cochran: {
                n: canonical.n_cochran,
                method: "Cochran",
                formula: `n = (t·CV/e)² = (${pu.z_score ?? 1.645}·${pu.cv_pct ?? variabilityPct}/${pu.precision_pct ?? allowableError})²`,
                params: { t: pu.z_score, cv: pu.cv_pct, e: pu.precision_pct },
              },
              fao: {
                n: canonical.n_fao,
                method: "FAO/USDA",
                formula: `n ≈ area_ha / 4 (mín. 5, máx. 60) → ${canonical.n_fao}`,
                params: { area_ha: canonical.area_ha },
              },
              spatial: {
                n: canonical.n_cressie_wikle,
                method: "Cressie-Wikle (espacial)",
                formula: `n ≈ 4·A/r² → ${canonical.n_cressie_wikle}`,
                params: { area_ha: canonical.area_ha, range_m: pu.range_m ?? 300 },
              },
              recommended: canonical.n_recommended ?? canonical.n_optimal ?? canonical.n_cochran,
              n_recommended: canonical.n_recommended,
              area_ha: canonical.area_ha,
              params_used: pu,
              campaignId: campaign.id,
            };
            return res.json(normalized);
          }
        } catch (_) {
          // fall through to local fallback
        }
      }

      // Local fallback (no polygon or geo-service unavailable)
      const result = computeSampleSize({
        areaHa: Number(parcel.area) || 1,
        variabilityPct: Number(variabilityPct),
        allowableError: Number(allowableError),
        confidenceLevel: confidenceLevel as 90 | 95 | 99,
        variableCode: variable_code,
      });
      res.json({ ...result, campaignId: campaign.id });
    } catch (error) {
      res.status(500).json({ message: "Error al calcular diseño de muestreo" });
    }
  });

  // Sampling Points
  app.get("/api/sampling-campaigns/:id/points", isAuthenticated, async (req, res) => {
    try {
      const campaign = await storage.getSamplingCampaign(req.params.id);
      if (!campaign) return res.status(404).json({ message: "Campaña no encontrada" });
      const parcel = await storage.getParcel(campaign.parcelId);
      if (!parcel || parcel.userId !== (req.user as any).id && (req.user as any).role !== "admin") return res.status(403).json({ message: "No autorizado" });
      const points = await storage.getSamplingPointsByCampaign(req.params.id);
      res.json(points);
    } catch (error) {
      res.status(500).json({ message: "Error al obtener puntos" });
    }
  });

  app.patch("/api/sampling-points/:id", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const point = await storage.getSamplingPoint(req.params.id);
      if (!point) return res.status(404).json({ message: "Punto no encontrado" });
      const campaign = await storage.getSamplingCampaign(point.campaignId);
      if (!campaign) return res.status(404).json({ message: "Campaña no encontrada" });
      const parcel = await storage.getParcel(campaign.parcelId);
      if (!parcel || parcel.userId !== (req.user as any).id && (req.user as any).role !== "admin") return res.status(403).json({ message: "No autorizado" });

      // Whitelist patchable fields — never trust client to set ids/timestamps/etc.
      const parsed = parseSamplingPointPatch(req.body);
      if (!parsed.ok) {
        return res.status(400).json({ message: parsed.message, code: "INVALID_PATCH" });
      }
      const patch = parsed.data;

      // Validate any GPS fields: hard-reject only the truly invalid (NaN, out
      // of range, suspicious (0,0)). Being outside the parcel polygon is a
      // soft warning — field captures from the road / parcel edge / drift on
      // mobile GPS must still be storable. The warning is surfaced in the
      // response payload so the UI can show it without blocking save.
      const polygonForCheck = parcel.polygonCoordinates as LatLng[] | null;
      let polygonWarning: string | null = null;
      const checkLatLng = (lat: unknown, lng: unknown, label: string): string | null => {
        if (lat == null && lng == null) return null;
        const la = Number(lat), lo = Number(lng);
        if (!Number.isFinite(la) || !Number.isFinite(lo)) return `${label} inválido`;
        if (la < -90 || la > 90 || lo < -180 || lo > 180) return `${label} fuera de rango`;
        if (Math.abs(la) < 1e-6 && Math.abs(lo) < 1e-6) return `${label} (0, 0) no es válido`;
        if (isValidPolygon(polygonForCheck) && !pipLatLng(la, lo, polygonForCheck)) {
          polygonWarning = `${label} fuera del polígono de la parcela`;
        }
        return null;
      };
      if ("latActual" in patch || "lonActual" in patch) {
        const errMsg = checkLatLng(patch.latActual, patch.lonActual, "lat/lon GPS");
        if (errMsg) return res.status(400).json({ message: errMsg, code: "INVALID_COORDINATES" });
      }

      // Physical and agronomic range validation
      if (patch.value != null) {
        const variable = await storage.getMasterVariable(campaign.variableId);
        const v = Number(patch.value);
        if (isNaN(v)) return res.status(400).json({ message: "El valor debe ser numérico" });

        // Range reference — soft warning only, never blocks saving
        const minVal = variable?.minValue != null ? Number(variable.minValue) : null;
        const maxVal = variable?.maxValue != null ? Number(variable.maxValue) : null;
        const optMin = variable?.optimalMin != null ? Number(variable.optimalMin) : null;
        const optMax = variable?.optimalMax != null ? Number(variable.optimalMax) : null;
        const rangeWarning =
          (minVal != null && v < minVal) || (maxVal != null && v > maxVal)
            ? `Valor ${v} fuera del rango de referencia [${minVal}, ${maxVal}] ${variable?.unit || ""}`
            : (optMin != null && v < optMin * 0.1) || (optMax != null && v > optMax * 10)
            ? `Valor ${v} muy fuera del rango óptimo esperado [${optMin}, ${optMax}] ${variable?.unit || ""}`
            : null;

        if (rangeWarning && req.body?.forceInsert !== true) {
          return res.status(400).json({ message: rangeWarning, code: "AGRONOMIC_RANGE", value: v });
        }
      }

      // Honor client-supplied capturedAt when present (e.g. offline sync replays
      // an old timestamp). Otherwise default: stamp now when value is being set,
      // keep existing timestamp if value is unchanged.
      const resolvedCapturedAt =
        patch.capturedAt !== undefined
          ? patch.capturedAt
          : patch.value != null
          ? new Date()
          : point.capturedAt;
      const updated = await storage.updateSamplingPoint(req.params.id, {
        ...patch,
        capturedAt: resolvedCapturedAt,
      });

      // Update campaign progress
      const allPoints = await storage.getSamplingPointsByCampaign(point.campaignId);
      const nDone = allPoints.filter(p => p.value != null).length;
      const newStatus: SamplingCampaignStatus = nDone >= campaign.nPointsPlanned ? "completed" : "active";
      const progressUpdate: { nPointsDone: number; status: SamplingCampaignStatus; completedAt?: Date; startedAt?: Date } = { nPointsDone: nDone, status: newStatus };
      if (newStatus === "completed") progressUpdate.completedAt = new Date();
      if (nDone === 1 && campaign.status === "designing") progressUpdate.startedAt = new Date();
      await storage.updateSamplingCampaign(point.campaignId, progressUpdate);

      // Surface non-blocking polygon warning so the field-capture UI can
      // show a yellow notice ("punto guardado, GPS fuera del polígono")
      // without aborting the save.
      if (polygonWarning) {
        return res.json({ ...updated, warning: polygonWarning, warningCode: "OUTSIDE_POLYGON" });
      }
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Error al actualizar punto" });
    }
  });

  // Reposition planned coordinates of a sampling point (design-only).
  // Separate from PATCH /:id so the capture flow can never overwrite planned coords.
  // Refuses to move points whose value has already been captured.
  app.patch("/api/sampling-points/:id/planned-coords", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const point = await storage.getSamplingPoint(req.params.id);
      if (!point) return res.status(404).json({ message: "Punto no encontrado" });
      const campaign = await storage.getSamplingCampaign(point.campaignId);
      if (!campaign) return res.status(404).json({ message: "Campaña no encontrada" });
      const parcel = await storage.getParcel(campaign.parcelId);
      if (!parcel || parcel.userId !== (req.user as { id: string }).id) {
        return res.status(403).json({ message: "No autorizado" });
      }
      if (point.value != null) {
        return res.status(409).json({
          message: "No se puede reposicionar un punto que ya tiene valor capturado",
          code: "POINT_HAS_VALUE",
        });
      }
      const lat = Number(req.body?.latPlanned);
      const lng = Number(req.body?.lonPlanned);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return res.status(400).json({ message: "latPlanned/lonPlanned inválidos" });
      }
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return res.status(400).json({ message: "Coordenadas fuera de rango" });
      }
      if (Math.abs(lat) < 1e-6 && Math.abs(lng) < 1e-6) {
        return res.status(400).json({ message: "Coordenadas (0, 0) no son válidas" });
      }
      const polygonForCheck = parcel.polygonCoordinates as LatLng[] | null;
      if (isValidPolygon(polygonForCheck) && !pipLatLng(lat, lng, polygonForCheck)) {
        return res.status(400).json({ message: "Punto fuera del polígono de la parcela" });
      }
      const updated = await storage.updateSamplingPoint(req.params.id, {
        latPlanned: lat,
        lonPlanned: lng,
      });
      res.json(updated);
    } catch {
      res.status(500).json({ message: "Error al reposicionar punto" });
    }
  });

  // Upload photo for a sampling point
  app.post("/api/sampling-points/:id/photo", isAuthenticated, isActiveUser, samplingPhotoUpload.single("photo"), async (req, res) => {
    try {
      const pointId = String(req.params.id);
      const point = await storage.getSamplingPoint(pointId);
      if (!point) return res.status(404).json({ message: "Punto no encontrado" });
      const campaign = await storage.getSamplingCampaign(point.campaignId);
      if (!campaign) return res.status(404).json({ message: "Campaña no encontrada" });
      const parcel = await storage.getParcel(campaign.parcelId);
      if (!parcel || parcel.userId !== (req.user as { id: string }).id) return res.status(403).json({ message: "No autorizado" });
      if (!req.file) return res.status(400).json({ message: "No se adjuntó ninguna imagen" });

      const photoUrl = `/uploads/sampling/${req.file.filename}`;
      const updated = await storage.updateSamplingPoint(pointId, { photoUrl });
      res.json({ photoUrl, point: updated });
    } catch (error) {
      res.status(500).json({ message: "Error al subir foto" });
    }
  });

  // Use actual GPS coordinates only when the user was physically at the sampling point.
  // If latActual is > 500 m from latPlanned the value was entered remotely (desk/office)
  // and the PLANNED coordinate (the real sample site) must be used for spatial analysis.
  function _samplingCoord(p: { latPlanned: string | number | null; lonPlanned: string | number | null; latActual: string | number | null; lonActual: string | number | null }): { lat: number; lon: number } {
    const latP = Number(p.latPlanned), lonP = Number(p.lonPlanned);
    const latA = Number(p.latActual), lonA = Number(p.lonActual);
    if (Number.isFinite(latA) && Number.isFinite(lonA)) {
      const R = 6_371_000, d2r = Math.PI / 180;
      const dLa = (latP - latA) * d2r, dLo = (lonP - lonA) * d2r;
      const a = Math.sin(dLa / 2) ** 2 + Math.cos(latA * d2r) * Math.cos(latP * d2r) * Math.sin(dLo / 2) ** 2;
      const distM = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      if (distM < 500) return { lat: latA, lon: lonA };
    }
    return { lat: latP, lon: lonP };
  }

  // Diagnosis — fast preflight check via Python geo-service
  app.post("/api/sampling-campaigns/:id/diagnose", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const campaign = await storage.getSamplingCampaign(req.params.id);
      if (!campaign) return res.status(404).json({ message: "Campaña no encontrada" });
      const parcel = await storage.getParcel(campaign.parcelId);
      if (!parcel || parcel.userId !== (req.user as any).id && (req.user as any).role !== "admin") return res.status(403).json({ message: "No autorizado" });

      const points = await storage.getSamplingPointsByCampaign(req.params.id);
      const measuredPoints = points.filter(p => p.value != null);
      if (measuredPoints.length < 3) {
        return res.status(400).json({ message: "Se necesitan al menos 3 puntos medidos para diagnosticar" });
      }

      const validMeasuredPoints = measuredPoints.filter(p => {
        const { lat, lon } = _samplingCoord(p);
        const val = Number(p.value);
        return Number.isFinite(lon) && Number.isFinite(lat) && Number.isFinite(val);
      });
      const geoPoints = validMeasuredPoints.map(p => ({
        ...(_samplingCoord(p)),
        value: Number(p.value),
      }));

      const polygonCoords = Array.isArray(parcel.polygonCoordinates)
        ? (parcel.polygonCoordinates as [number, number][]).map(([lat, lng]) => [lng, lat])
        : null;

      const variable = await storage.getMasterVariable(campaign.variableId).catch(() => null);
      const variableCode = (variable as any)?.code ?? null;

      const geoServiceUrl = process.env.GEO_SERVICE_URL || "http://127.0.0.1:8000";
      const r = await fetchWithTimeout(`${geoServiceUrl}/diagnose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ points: geoPoints, polygon: polygonCoords, variable_code: variableCode }),
      }, 10_000);
      const data = await r.json();
      // Map geo-service index pairs → real DB point IDs
      if (r.ok && Array.isArray(data.duplicate_point_pairs)) {
        data.duplicate_point_ids = (data.duplicate_point_pairs as number[][]).map(pair =>
          pair.map((idx: number) => validMeasuredPoints[idx]?.id ?? null).filter(Boolean)
        );
      }
      res.status(r.ok ? 200 : r.status).json(data);
    } catch (err: any) {
      const isTimeout = err?.name === "AbortError";
      res.status(isTimeout ? 504 : 502).json({ message: isTimeout ? "Diagnóstico timeout" : `Error: ${err.message}` });
    }
  });

  // Interpolation — proxy to Python geo-service
  app.post("/api/sampling-campaigns/:id/interpolate", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const campaign = await storage.getSamplingCampaign(req.params.id);
      if (!campaign) return res.status(404).json({ message: "Campaña no encontrada" });
      const parcel = await storage.getParcel(campaign.parcelId);
      if (!parcel || parcel.userId !== (req.user as any).id && (req.user as any).role !== "admin") return res.status(403).json({ message: "No autorizado" });

      const points = await storage.getSamplingPointsByCampaign(req.params.id);
      const measuredPoints = points.filter(p => p.value != null);
      if (measuredPoints.length < 3) {
        return res.status(400).json({ message: "Se necesitan al menos 3 puntos medidos para interpolar" });
      }

      const polygonCoords = parcel.polygonCoordinates as any;
      if (!isValidPolygon(polygonCoords)) {
        return res.status(400).json({ message: "La parcela no tiene polígono definido o es inválido" });
      }
      if (!isSimplePolygon(polygonCoords as LatLng[])) {
        return res.status(400).json({
          message: "El polígono de la parcela se auto-intersecta. Corrige los vértices antes de interpolar.",
        });
      }
      const polygon = (polygonCoords as [number, number][]).map(([lat, lng]) => [lng, lat]);

      const variable = await storage.getMasterVariable(campaign.variableId);
      const {
        method = "idw",
        n_zones = 3,
        resolution = 80,
        variogram_model = "auto",
        power = null,
        k = null,
        rbf_kernel = "auto",
        rbf_smoothing = null,
        kriging_range_init = null,
        kriging_sill_init = null,
        transform = "auto",
        svr_kernel = "rbf",
        svr_C = null,
        covariates = [],
      } = req.body;

      // ── Hyperparameter validation ────────────────────────────────────────
      if (power !== null && power !== undefined && !(Number(power) > 0)) {
        return res.status(400).json({ message: "IDW power debe ser un número > 0" });
      }
      if (k !== null && k !== undefined && !(Number.isFinite(Number(k)) && Number(k) >= 1)) {
        return res.status(400).json({ message: "IDW k (vecinos) debe ser un entero ≥ 1" });
      }
      if (rbf_smoothing !== null && rbf_smoothing !== undefined && !(Number(rbf_smoothing) > 0)) {
        return res.status(400).json({ message: "RBF smoothing debe ser un número > 0" });
      }

      // ── Minimum points per method (short-circuit before calling geo-service) ──
      const methodLc = String(method || "idw").toLowerCase();
      const nMeasured = measuredPoints.length;
      if (methodLc === "kriging" && nMeasured < 8) {
        return res.status(400).json({
          message: `Kriging requiere ≥ 8 puntos medidos (${nMeasured} disponibles). Usa IDW para conjuntos pequeños.`,
        });
      }
      if (methodLc === "rfk" && nMeasured < 20) {
        return res.status(400).json({
          message: `RF+Kriging requiere ≥ 20 puntos medidos (${nMeasured} disponibles). Usa Kriging o IDW.`,
        });
      }
      if (methodLc === "cokriging" && nMeasured < 8) {
        return res.status(400).json({
          message: `Co-Kriging requiere ≥ 8 puntos medidos (${nMeasured} disponibles). Usa IDW o Kriging.`,
        });
      }
      if (methodLc === "rbf" && nMeasured < 8) {
        return res.status(400).json({
          message: `RBF requiere ≥ 8 puntos medidos (${nMeasured} disponibles). Usa IDW para conjuntos pequeños.`,
        });
      }

      const geoServiceUrl = process.env.GEO_SERVICE_URL || "http://127.0.0.1:8000";

      // ── Co-Kriging: auto-assemble co-variable data from same-parcel campaigns ─
      // When method is "cokriging" (or "auto"), query completed campaigns on the
      // same parcel that measure different variables. For each primary sampling
      // point, find the nearest co-variable point within 200 m. Only include a
      // co-variable if ALL primary points have a neighbour within 200 m.
      const _haversineM = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
        const R = 6371000;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      };

      let assembledCovariates: { code: string; values: number[] }[] = Array.isArray(covariates) ? covariates : [];
      const rejectedCovariates: { code: string; reason: string; latRatio?: number; lonRatio?: number }[] = [];

      // Co-variable codes eligible as secondary predictors for Co-Kriging
      const COKRIGING_ELIGIBLE_CODES = new Set(["NDVI", "CE", "hum_suelo", "ndvi", "ce", "humedad"]);

      if ((method === "cokriging" || method === "auto") && assembledCovariates.length === 0) {
        try {
          const allParcelCampaigns = await storage.getSamplingCampaignsByParcel(campaign.parcelId);
          const sibling = allParcelCampaigns.filter(c =>
            c.id !== req.params.id &&
            (c.status === "completed" || c.status === "interpolated") &&
            c.variableId !== campaign.variableId,
          );

          // Use actual GPS only when user was within 500 m of planned point (in-field entry).
          const primaryPts = measuredPoints.map(p => _samplingCoord(p));

          // Primary bbox used for spatial-diversity check of co-variables.
          const primLatMin = Math.min(...primaryPts.map(p => p.lat));
          const primLatMax = Math.max(...primaryPts.map(p => p.lat));
          const primLonMin = Math.min(...primaryPts.map(p => p.lon));
          const primLonMax = Math.max(...primaryPts.map(p => p.lon));
          const primLatExt = primLatMax - primLatMin;
          const primLonExt = primLonMax - primLonMin;

          for (const sibCampaign of sibling) {
            const sibVar = await storage.getMasterVariable(sibCampaign.variableId);
            if (!sibVar?.code) continue;
            if (!COKRIGING_ELIGIBLE_CODES.has(sibVar.code)) continue;
            const sibPts = await storage.getSamplingPointsByCampaign(sibCampaign.id);
            const sibMeasured = sibPts.filter(p => p.value != null).map(p => ({
              ...(_samplingCoord(p)),
              value: Number(p.value),
            }));
            if (sibMeasured.length < 3) continue;

            // Reject co-variables whose spatial extent is < 30 % of the primary bbox
            // in either axis: such near-collinear samples cannot provide useful
            // spatial trend information and degrade Co-Kriging instead of helping it.
            const sibLatExt = Math.max(...sibMeasured.map(p => p.lat)) - Math.min(...sibMeasured.map(p => p.lat));
            const sibLonExt = Math.max(...sibMeasured.map(p => p.lon)) - Math.min(...sibMeasured.map(p => p.lon));
            const latRatio = primLatExt > 1e-9 ? sibLatExt / primLatExt : 1;
            const lonRatio = primLonExt > 1e-9 ? sibLonExt / primLonExt : 1;
            if (latRatio < 0.3 || lonRatio < 0.3) {
              const reason = `Cobertura espacial insuficiente: lat=${latRatio.toFixed(2)}, lon=${lonRatio.toFixed(2)} del bbox primario (mínimo 0.30)`;
              console.warn(`Co-variable ${sibVar.code} rechazada — ${reason}`);
              rejectedCovariates.push({ code: sibVar.code, reason, latRatio: Number(latRatio.toFixed(3)), lonRatio: Number(lonRatio.toFixed(3)) });
              continue;
            }

            const matched: number[] = [];
            let allWithin200m = true;
            for (const pp of primaryPts) {
              let minDist = Infinity;
              let bestVal = 0;
              for (const sp of sibMeasured) {
                const d = _haversineM(pp.lat, pp.lon, sp.lat, sp.lon);
                if (d < minDist) { minDist = d; bestVal = sp.value; }
              }
              if (minDist > 200) { allWithin200m = false; break; }
              matched.push(bestVal);
            }
            if (allWithin200m && matched.length === primaryPts.length) {
              assembledCovariates.push({ code: sibVar.code, values: matched });
            }
          }
        } catch (_err) {
          // Non-fatal: proceed without co-variables (will fallback to OK in geo-service)
        }
      }

      // Build geo-service payload — omit null optional hyperparams to preserve auto-LOOCV behavior.
      // MVZ uses recorded GPS before planned coordinates, consistently with re-runs.
      const geoPayload: Record<string, unknown> = {
        points: measuredPoints.map(p => ({
          lon: Number(p.lonActual ?? p.lonPlanned),
          lat: Number(p.latActual ?? p.latPlanned),
          value: Number(p.value),
        })),
        method,
        polygon,
        resolution: Number(resolution),
        n_zones: Number(n_zones),
        variable_code: variable?.code || "default",
        variogram_model,
        rbf_kernel,
        transform,
        svr_kernel,
        covariates: assembledCovariates,
      };
      // Optional hyperparams: only include if explicitly set (null means auto)
      if (power !== null && power !== undefined) geoPayload.power = Number(power);
      if (svr_C !== null && svr_C !== undefined) geoPayload.svr_C = Number(svr_C);
      if (k !== null && k !== undefined) geoPayload.k = Number(k);
      if (rbf_smoothing !== null && rbf_smoothing !== undefined) geoPayload.rbf_smoothing = Number(rbf_smoothing);
      if (kriging_range_init !== null && kriging_range_init !== undefined) geoPayload.kriging_range_init = Number(kriging_range_init);
      if (kriging_sill_init !== null && kriging_sill_init !== undefined) geoPayload.kriging_sill_init = Number(kriging_sill_init);

      // ── Geo-service call ─────────────────────────────────────────────────
      // No statistical/quantile fallback: returning bogus horizontal-strip zones
      // is misleading (looks like a real interpolation result but is not).
      // Propagate the geo-service error so the UI can surface it honestly.
      let geoResult: any = null;
      let geoErrorDetail: { status: number; detail: string } | null = null;
      try {
        const geoResponse = await fetchWithTimeout(`${geoServiceUrl}/interpolate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(geoPayload),
        });
        if (geoResponse.ok) {
          geoResult = await geoResponse.json().catch(() => null);
          if (!geoResult) {
            geoErrorDetail = { status: 502, detail: "Respuesta vacía del geo-service" };
          }
        } else {
          const errText = await geoResponse.text().catch(() => "");
          // Forward 4xx client validation errors as-is (polygon, min points, hyperparams)
          // and map 5xx to a 502 upstream-failure response.
          const status = geoResponse.status >= 400 && geoResponse.status < 500 ? geoResponse.status : 502;
          let parsedDetail = errText;
          try {
            const parsed = JSON.parse(errText);
            parsedDetail = String(parsed?.detail ?? parsed?.message ?? errText);
          } catch { /* plain text */ }
          geoErrorDetail = { status, detail: parsedDetail || `Geo-service ${geoResponse.status}` };
        }
      } catch (fetchErr: any) {
        const isTimeout = fetchErr?.name === "AbortError";
        geoErrorDetail = {
          status: isTimeout ? 504 : 502,
          detail: isTimeout
            ? "Geo-service timeout (>45 s): la interpolación tardó demasiado. Intenta reducir la resolución o usar IDW."
            : `Geo-service no accesible: ${fetchErr?.message ?? "error de red"}`,
        };
      }

      if (!geoResult) {
        console.warn(`Interpolation failed (${geoErrorDetail?.status}): ${geoErrorDetail?.detail}`);
        // Persist a failed interpolation record so the attempt is auditable and
        // the user can see in the history that a run happened and why it failed.
        // Best-effort: if persistence itself errors we still return the error.
        let failedInterpId: string | null = null;
        try {
          const failed = await storage.createInterpolationResult({
            campaignId: req.params.id,
            method: `${methodLc}-failed`,
            rmseCv: null, maeCv: null, r2Cv: null,
            variogramModel: null, variogramRange: null, variogramSill: null, variogramNugget: null,
            paramsJson: {
              status: "failed",
              reason: geoErrorDetail?.detail ?? "unknown",
              httpStatus: geoErrorDetail?.status ?? 502,
              requestedMethod: methodLc,
              nMeasured,
              failedAt: new Date().toISOString(),
            } as Record<string, unknown>,
          });
          failedInterpId = failed.id;
        } catch (persistErr) {
          console.warn("Could not persist failed interpolation record:", persistErr);
        }
        return res.status(geoErrorDetail?.status ?? 502).json({
          status: "failed",
          message: geoErrorDetail?.detail ?? "Error al interpolar",
          interpolationId: failedInterpId,
        });
      }

      // Fetch empirical variogram lags (actual coords) to store alongside the interpolation
      let variogramLags: any[] | null = geoResult.metrics?.variogram?.empirical?.map((bin: any) => ({
        h: bin.distance, gamma: bin.semivariance, n_pairs: bin.n_pairs,
      })) ?? null;
      try {
        if (!variogramLags && geoResult.metrics?.variogram) {
        const vgResp = await fetchWithTimeout(`${geoServiceUrl}/variogram-lags`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            points: measuredPoints.map(p => ({
              lon: Number(p.lonActual ?? p.lonPlanned),
              lat: Number(p.latActual ?? p.latPlanned),
              value: Number(p.value),
            })),
            polygon,
          }),
        });
        if (vgResp.ok) {
          const vgData = await vgResp.json().catch(() => null);
          if (vgData?.lags?.length > 0) variogramLags = vgData.lags;
        }
        }
      } catch (_) {}

      // Save interpolation result (gridValues stores the 2D array for GeoTIFF export)
      const interp = await storage.createInterpolationResult({
        campaignId: req.params.id,
        method,
        rmseCv: geoResult.metrics?.rmse ?? null,
        maeCv: geoResult.metrics?.mae ?? null,
        r2Cv: geoResult.metrics?.r2 ?? null,
        variogramModel: geoResult.metrics?.variogram?.model || null,
        variogramRange: geoResult.metrics?.variogram?.range ?? null,
        variogramSill: geoResult.metrics?.variogram?.sill ?? null,
        variogramNugget: geoResult.metrics?.variogram?.nugget ?? null,
        variogramLags: variogramLags as any,
        gridValues: geoResult.grid_values ?? null,
        paramsJson: { ...geoResult.metrics?.params, metrics: geoResult.metrics, warnings: geoResult.warnings ?? [], loocv_residuals: geoResult.loocv_residuals ?? [], grid_scale: geoResult.grid_scale, raster_png_b64: geoResult.raster_png_b64, raster_bbox: geoResult.raster_bbox, grid_stats: geoResult.grid_stats, raster_vmin: geoResult.raster_vmin, raster_vmax: geoResult.raster_vmax, display_vmin: geoResult.display_vmin, display_vmax: geoResult.display_vmax, near_constant_grid: geoResult.near_constant_grid ?? false, transform_type: geoResult.transform_type, transform_shift: geoResult.transform_shift, transform_lambda: geoResult.transform_lambda, covariate_info: geoResult.covariate_info ?? null, low_variance_warning: geoResult.low_variance_warning ?? null, input_stats: geoResult.input_stats ?? null, kriging_std_grid: geoResult.kriging_std_grid ?? null, kriging_msdr: geoResult.kriging_msdr ?? null, n_zones: Number(n_zones) } as Record<string, unknown>,
      });

      // Save management zones
      const zoneRecords = await storage.bulkCreateManagementZones(
        (geoResult.zones || []).map((z: any, i: number) => ({
          interpolationId: interp.id,
          zoneIndex: z.zone_index ?? i,
          zoneLabel: z.zone_label ?? null,
          areaHa: z.area_ha != null
            ? Number(Number(z.area_ha).toFixed(4))
            : (z.n_pixels != null && parcel.area != null)
              ? Number(((z.n_pixels / (resolution * resolution)) * Number(parcel.area)).toFixed(4))
              : null,
          valueMean: z.value_mean ?? null,
          valueStd: z.value_std ?? null,
          valueMin: z.value_min ?? null,
          valueMax: z.value_max ?? null,
          polygonGeojson: z.geojson ?? { type: "Polygon", coordinates: polygon.length >= 3 ? [polygon] : [[]] },
          colorHex: z.color || null,
        }))
      );

      // Update campaign status
      await storage.updateSamplingCampaign(req.params.id, { status: "interpolated" as SamplingCampaignStatus });

      res.json({
        interpolation: interp,
        method: geoResult.method ?? method,
        zones: zoneRecords,
        raster_png_b64: geoResult.raster_png_b64,
        raster_bbox: geoResult.raster_bbox,
        raster_vmin: geoResult.raster_vmin,
        raster_vmax: geoResult.raster_vmax,
        display_vmin: geoResult.display_vmin,
        display_vmax: geoResult.display_vmax,
        grid_stats: geoResult.grid_stats,
        metrics: geoResult.metrics,
        warnings: geoResult.warnings ?? [],
        loocv_residuals: geoResult.loocv_residuals ?? [],
        grid_scale: geoResult.grid_scale,
        transform_type: geoResult.transform_type,
        transform_shift: geoResult.transform_shift,
        transform_lambda: geoResult.transform_lambda,
        covariate_info: {
          ...(geoResult.covariate_info ?? {}),
          accepted: assembledCovariates.map(c => c.code),
          rejected: rejectedCovariates,
        },
        near_constant_grid: geoResult.near_constant_grid ?? false,
        input_stats: geoResult.input_stats ?? null,
        low_variance_warning: geoResult.low_variance_warning ?? null,
      });
    } catch (error: any) {
      console.error("Interpolation error:", error);
      res.status(500).json({ message: `Error en interpolación: ${error.message}` });
    }
  });

  // Get interpolation results
  app.get("/api/sampling-campaigns/:id/interpolations", isAuthenticated, async (req, res) => {
    try {
      const campaign = await storage.getSamplingCampaign(req.params.id);
      if (!campaign) return res.status(404).json({ message: "Campaña no encontrada" });
      const parcel = await storage.getParcel(campaign.parcelId);
      if (!parcel || parcel.userId !== (req.user as any).id && (req.user as any).role !== "admin") return res.status(403).json({ message: "No autorizado" });
      const results = await storage.getInterpolationResultsByCampaign(req.params.id);
      res.json(results);
    } catch (error) {
      res.status(500).json({ message: "Error al obtener interpolaciones" });
    }
  });

  app.get("/api/interpolations/:id", isAuthenticated, async (req, res) => {
    try {
      const interp = await storage.getInterpolationResult(req.params.id);
      if (!interp) return res.status(404).json({ message: "Interpolación no encontrada" });
      const campaign = await storage.getSamplingCampaign(interp.campaignId);
      if (!campaign) return res.status(404).json({ message: "Campaña no encontrada" });
      const parcel = await storage.getParcel(campaign.parcelId);
      if (!parcel || parcel.userId !== (req.user as any).id && (req.user as any).role !== "admin") return res.status(403).json({ message: "No autorizado" });
      const zones = await storage.getManagementZonesByInterpolation(req.params.id);
      res.json({ interpolation: interp, zones });
    } catch (error) {
      res.status(500).json({ message: "Error al obtener interpolación" });
    }
  });

  // Download interpolation result as GeoTIFF Float32
  app.get("/api/interpolations/:id/geotiff", isAuthenticated, async (req, res) => {
    try {
      const interp = await storage.getInterpolationResult(req.params.id);
      if (!interp) return res.status(404).json({ message: "Interpolación no encontrada" });
      const campaign = await storage.getSamplingCampaign(interp.campaignId);
      if (!campaign) return res.status(404).json({ message: "Campaña no encontrada" });
      const parcel = await storage.getParcel(campaign.parcelId);
      if (!parcel || parcel.userId !== (req.user as any).id && (req.user as any).role !== "admin") return res.status(403).json({ message: "No autorizado" });

      const gridValues = interp.gridValues;
      if (!gridValues) return res.status(404).json({ message: "Grid de valores no disponible para esta interpolación. Re-ejecuta la interpolación para habilitar la descarga GeoTIFF." });

      const params = (interp.paramsJson ?? {}) as Record<string, unknown>;
      const bbox = params.raster_bbox as { minx: number; miny: number; maxx: number; maxy: number } | null;
      if (!bbox) return res.status(404).json({ message: "Bounding box no disponible. Re-ejecuta la interpolación." });

      const geoServiceUrl = process.env.GEO_SERVICE_URL || "http://127.0.0.1:8000";
      const geoResp = await fetchWithTimeout(`${geoServiceUrl}/geotiff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grid_values: gridValues, bbox }),
      });

      if (!geoResp.ok) {
        const errText = await geoResp.text().catch(() => "");
        return res.status(502).json({ message: `Error generando GeoTIFF: ${errText}` });
      }

      const tifBuffer = Buffer.from(await geoResp.arrayBuffer());
      res.set({
        "Content-Type": "image/tiff",
        "Content-Disposition": `attachment; filename="interpolation-${req.params.id}.tif"`,
        "Content-Length": tifBuffer.length,
      });
      res.send(tifBuffer);
    } catch (error: any) {
      const isTimeout = error?.name === "AbortError";
      res.status(isTimeout ? 504 : 500).json({
        message: isTimeout
          ? "Geo-service timeout (>45 s): la generación de GeoTIFF tardó demasiado."
          : "Error al generar GeoTIFF",
      });
    }
  });

  // Zonify an interpolation result (proxy to Python geo-service with fallback)
  app.post("/api/interpolations/:id/zonify", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const interp = await storage.getInterpolationResult(req.params.id);
      if (!interp) return res.status(404).json({ message: "Interpolación no encontrada" });
      const campaign = await storage.getSamplingCampaign(interp.campaignId);
      if (!campaign) return res.status(404).json({ message: "Campaña no encontrada" });
      const parcel = await storage.getParcel(campaign.parcelId);
      if (!parcel || parcel.userId !== (req.user as any).id && (req.user as any).role !== "admin") return res.status(403).json({ message: "No autorizado" });

      const polygonCoords = parcel.polygonCoordinates as any;
      const polygon = Array.isArray(polygonCoords)
        ? (polygonCoords as [number, number][]).map(([lat, lng]) => [lng, lat])
        : [];

      // Re-hydrate hyperparameters from the original interpolation so re-zonification
      // uses the same model (power, k, variogram, kernel, etc.) that produced the
      // original raster — otherwise we'd silently re-interpolate with defaults.
      // Note: geo-service stores params under its internal names (k_neighbors, model,
      // kernel, smoothing); the backend /interpolate request uses k, variogram_model,
      // rbf_kernel, rbf_smoothing. We read either form so we survive both spellings.
      const prevParams = (interp.paramsJson ?? {}) as Record<string, unknown>;
      const prevMethod = String(prevParams.method ?? interp.method ?? "idw").toLowerCase();
      const pick = <T = unknown>(...keys: string[]): T | undefined => {
        for (const k of keys) {
          const v = (prevParams as Record<string, unknown>)[k];
          if (v != null) return v as T;
        }
        return undefined;
      };
      const prevPower = pick<number | string>("power");
      const prevK = pick<number | string>("k", "k_neighbors");
      const prevVariogramModel = pick<string>("variogram_model", "model");
      const prevRangeInit = pick<number | string>("kriging_range_init", "range_init", "variogram_range");
      const prevSillInit = pick<number | string>("kriging_sill_init", "sill_init", "variogram_sill");
      const prevRbfKernel = pick<string>("rbf_kernel", "kernel");
      const prevRbfSmoothing = pick<number | string>("rbf_smoothing", "smoothing");
      const prevTransform = pick<string>("transform", "transform_type");

      // Try Python geo-service for re-zonification
      const geoServiceUrl = process.env.GEO_SERVICE_URL || "http://127.0.0.1:8000";
      let zones = await storage.getManagementZonesByInterpolation(req.params.id);

      // Determine n_zones: prefer the count stored in paramsJson (from the original
      // interpolation request), then fall back to existing zone count, then 3.
      // `n_zones` is stored at top level in paramsJson for new records (post-fix).
      // Legacy records may have it nested under `.params`.
      const storedNZones: number | undefined =
        (prevParams.n_zones as number | undefined) ??
        ((prevParams.params as Record<string, unknown> | undefined)?.n_zones as number | undefined);
      // Always use stored n_zones — never accept client overrides.
      // The zone-count lock ensures the "Generar zonas" button recreates exactly
      // the same number of zones as the original interpolation, preventing the
      // frontend from accidentally drifting the count.
      const nZones = storedNZones ?? (zones.length > 0 ? zones.length : 3);
      let zonifyWarning: string | null = null;

      // Extract stored raster and transform params for the preferred /zonify path.
      const storedGrid = interp.gridValues as number[][] | null | undefined;
      const rasterBbox = prevParams.raster_bbox as
        | { minx: number; miny: number; maxx: number; maxy: number }
        | undefined;
      const transformType = (prevParams.transform_type as string | undefined) ?? "none";
      const transformShift = (prevParams.transform_shift as number | undefined) ?? 0;
      const transformLambda = (prevParams.transform_lambda as number | undefined) ?? null;

      if (storedGrid && Array.isArray(storedGrid) && storedGrid.length > 0 && rasterBbox) {
        // ── Preferred path: stored raster exists → call /zonify ──────────────
        // Avoids re-interpolation and uses the same raster already validated at
        // interpolation time. Transform params are forwarded so the geo-service
        // back-transforms zone statistics to original agronomic units.
        try {
          const zonifyPayload = {
            grid_values: storedGrid,
            bbox: rasterBbox,
            n_zones: Number(nZones),
            polygon,
            transform_type: prevParams.grid_scale === "original" ? "none" : transformType,
            grid_layout: prevParams.grid_scale === "original" ? "cell_centers" : "legacy_endpoints",
            transform_shift: transformShift,
            transform_lambda: transformLambda,
          };
          const geoResponse = await fetchWithTimeout(`${geoServiceUrl}/zonify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(zonifyPayload),
          });
          if (geoResponse.ok) {
            const geoResult = await geoResponse.json() as any;
            const rawZones: any[] = Array.isArray(geoResult.zones) ? geoResult.zones : [];
            const validZones = rawZones.filter((z: any) => z.geojson != null);
            if (rawZones.length > 0 && validZones.length === rawZones.length) {
              const zoneColors = ["#d73027", "#fdae61", "#1a9850", "#2166ac", "#762a83"];
              zones = await storage.replaceManagementZones(
                req.params.id,
                validZones.map((z: any, i: number) => ({
                  interpolationId: req.params.id,
                  zoneIndex: i,
                  zoneLabel: z.label || z.zone_label || `Zona ${i + 1}`,
                  colorHex: z.color || zoneColors[i] || "#888",
                  valueMean: z.mean ?? z.value_mean ?? null,
                  valueMin: z.min ?? z.value_min ?? null,
                  valueMax: z.max ?? z.value_max ?? null,
                  areaHa: z.area_ha != null
                    ? Number(Number(z.area_ha).toFixed(4))
                    : (z.n_pixels != null && parcel.area != null
                        ? Number(((z.n_pixels / (50 * 50)) * Number(parcel.area)).toFixed(4))
                        : null),
                  polygonGeojson: z.geojson,
                  category: null,
                  aiInterpretation: null,
                }))
              );
            } else if (rawZones.length > 0 && validZones.length < rawZones.length) {
              zonifyWarning = `El geo-servicio devolvió ${rawZones.length} zonas pero ${rawZones.length - validZones.length} no tienen geometría válida. Se conservaron las zonas anteriores.`;
              console.warn(zonifyWarning);
            }
          } else {
            const errText = await geoResponse.text().catch(() => "");
            zonifyWarning = `Re-zonificación fallida (${geoResponse.status}). Se conservaron las zonas anteriores.`;
            console.warn(`Re-zonify /zonify ${geoResponse.status}: ${errText}`);
          }
        } catch (geoError: any) {
          if (geoError?.name === "AbortError") {
            return res.status(504).json({
              message: "Geo-service timeout (>45 s): la re-zonificación tardó demasiado. Intenta reducir el número de zonas.",
            });
          }
          console.warn("Geo-service unavailable for re-zonify (/zonify), returning existing zones:", geoError);
          zonifyWarning = `Geo-service no accesible: ${geoError?.message ?? "error de red"}. Se conservaron las zonas anteriores.`;
        }
      } else {
        // ── Fallback path: no stored raster → re-interpolate from points ─────
        // Legacy records created before gridValues was stored fall through here.
        try {
          const points = await storage.getSamplingPointsByCampaign(interp.campaignId);
          const measured = points.filter(p => p.value != null);
          if (measured.length >= 3 && polygon.length >= 3) {
            const zonifyPayload: Record<string, unknown> = {
              points: measured.map(p => ({
                lon: Number(p.lonActual ?? p.lonPlanned),
                lat: Number(p.latActual ?? p.latPlanned),
                value: Number(p.value),
              })),
              method: prevMethod,
              polygon,
              resolution: 50,
              n_zones: Number(nZones),
              transform: prevTransform ?? "auto",
            };
            if (prevPower != null) zonifyPayload.power = Number(prevPower);
            if (prevK != null) zonifyPayload.k = Number(prevK);
            if (prevVariogramModel) zonifyPayload.variogram_model = prevVariogramModel;
            if (prevRangeInit != null) zonifyPayload.kriging_range_init = Number(prevRangeInit);
            if (prevSillInit != null) zonifyPayload.kriging_sill_init = Number(prevSillInit);
            if (prevRbfKernel) zonifyPayload.rbf_kernel = prevRbfKernel;
            if (prevRbfSmoothing != null) zonifyPayload.rbf_smoothing = Number(prevRbfSmoothing);
            const geoResponse = await fetchWithTimeout(`${geoServiceUrl}/interpolate`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(zonifyPayload),
            });
            if (geoResponse.ok) {
              const geoResult = await geoResponse.json() as any;
              const rawZones: any[] = Array.isArray(geoResult.zones) ? geoResult.zones : [];
              const validZones = rawZones.filter((z: any) => z.geojson != null);
              if (rawZones.length > 0 && validZones.length === rawZones.length) {
                const zoneColors = ["#d73027", "#fdae61", "#1a9850", "#2166ac", "#762a83"];
                zones = await storage.replaceManagementZones(
                  req.params.id,
                  validZones.map((z: any, i: number) => ({
                    interpolationId: req.params.id,
                    zoneIndex: i,
                    zoneLabel: z.label || z.zone_label || `Zona ${i + 1}`,
                    colorHex: z.color || zoneColors[i] || "#888",
                    valueMean: z.mean ?? z.value_mean ?? null,
                    valueMin: z.min ?? z.value_min ?? null,
                    valueMax: z.max ?? z.value_max ?? null,
                    areaHa: z.area_ha != null
                      ? Number(Number(z.area_ha).toFixed(4))
                      : (z.n_pixels != null && parcel.area != null
                          ? Number(((z.n_pixels / (50 * 50)) * Number(parcel.area)).toFixed(4))
                          : null),
                    polygonGeojson: z.geojson,
                    category: null,
                    aiInterpretation: null,
                  }))
                );
              } else if (rawZones.length > 0 && validZones.length < rawZones.length) {
                zonifyWarning = `El geo-servicio devolvió ${rawZones.length} zonas pero ${rawZones.length - validZones.length} no tienen geometría válida. Se conservaron las zonas anteriores.`;
                console.warn(zonifyWarning);
              }
            } else {
              const errText = await geoResponse.text().catch(() => "");
              zonifyWarning = `Re-zonificación fallida (${geoResponse.status}). Se conservaron las zonas anteriores.`;
              console.warn(`Re-zonify /interpolate ${geoResponse.status}: ${errText}`);
            }
          }
        } catch (geoError: any) {
          if (geoError?.name === "AbortError") {
            return res.status(504).json({
              message: "Geo-service timeout (>45 s): la re-zonificación tardó demasiado. Intenta reducir la resolución o el número de zonas.",
            });
          }
          console.warn("Geo-service unavailable for re-zonify (fallback /interpolate), returning existing zones:", geoError);
          zonifyWarning = `Geo-service no accesible: ${geoError?.message ?? "error de red"}. Se conservaron las zonas anteriores.`;
        }
      }

      res.json({
        interpolation: interp,
        zones,
        nZones: zones.length,
        ...(zonifyWarning ? { warning: zonifyWarning } : {}),
      });
    } catch (error: any) {
      res.status(500).json({ message: `Error al zonificar: ${error.message}` });
    }
  });

  // Generate AI prescriptions for a given interpolation
  app.post("/api/interpolations/:id/prescribe", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const interp = await storage.getInterpolationResult(req.params.id);
      if (!interp) return res.status(404).json({ message: "Interpolación no encontrada" });
      const campaign = await storage.getSamplingCampaign(interp.campaignId);
      if (!campaign) return res.status(404).json({ message: "Campaña no encontrada" });
      const parcel = await storage.getParcel(campaign.parcelId);
      if (!parcel || parcel.userId !== (req.user as any).id && (req.user as any).role !== "admin") return res.status(403).json({ message: "No autorizado" });
      const variable = await storage.getMasterVariable(campaign.variableId);
      if (!variable) return res.status(404).json({ message: "Variable no encontrada" });

      const zones = await storage.getManagementZonesByInterpolation(req.params.id);
      if (zones.length === 0) return res.status(400).json({ message: "No hay zonas de manejo para prescribir" });

      const prescriptionRequest = {
        variableCode: variable.code,
        variableName: variable.name,
        variableUnit: variable.unit,
        optimalMin: variable.optimalMin != null ? Number(variable.optimalMin) : undefined,
        optimalMax: variable.optimalMax != null ? Number(variable.optimalMax) : undefined,
        crop: parcel.crop || "cultivo",
        soilType: parcel.soilType || undefined,
        parcelArea: Number(parcel.area) || 1,
        zones: zones.map(z => ({
          zoneIndex: z.zoneIndex,
          category: z.category || z.zoneLabel || "",
          valueMean: Number(z.valueMean) || 0,
          valueMin: Number(z.valueMin) || 0,
          valueMax: Number(z.valueMax) || 0,
          areaHa: Number(z.areaHa) || 0,
          colorHex: z.colorHex || "#888",
        })),
      };

      const aiPrescriptions = await generatePrescriptions(prescriptionRequest);

      // Save prescriptions
      const savedPrescriptions: any[] = [];
      for (let i = 0; i < zones.length; i++) {
        const zone = zones[i];
        const ai = aiPrescriptions.find(p => p.zoneIndex === i) || aiPrescriptions[i];
        if (!ai) continue;

        // Delete old prescriptions for this zone
        await storage.deleteZonePrescriptionsByZone(zone.id);

        const presc = await storage.createZonePrescription({
          zoneId: zone.id,
          amendment: ai.amendment,
          dosePerHa: ai.dosePerHa ?? null,
          doseUnit: ai.doseUnit,
          totalDose: ai.totalDose ?? null,
          applicationMethod: ai.applicationMethod,
          timing: ai.timing,
          aiRationale: ai.aiRationale,
          estimatedCost: ai.estimatedCostPerHa != null ? ai.estimatedCostPerHa * (Number(zone.areaHa) || 1) : null,
        });
        savedPrescriptions.push({ ...presc, zone });
      }

      res.json({ prescriptions: savedPrescriptions });
    } catch (error: any) {
      console.error("Prescription error:", error);
      res.status(500).json({ message: `Error al generar prescripciones: ${error.message}` });
    }
  });

  app.get("/api/interpolations/:id/prescriptions", isAuthenticated, async (req, res) => {
    try {
      const interp = await storage.getInterpolationResult(req.params.id);
      if (!interp) return res.status(404).json({ message: "Interpolación no encontrada" });
      const campaign = await storage.getSamplingCampaign(interp.campaignId);
      if (!campaign) return res.status(404).json({ message: "Campaña no encontrada" });
      const parcel = await storage.getParcel(campaign.parcelId);
      if (!parcel || parcel.userId !== (req.user as any).id && (req.user as any).role !== "admin") return res.status(403).json({ message: "No autorizado" });
      const prescriptions = await storage.getZonePrescriptionsByInterpolation(req.params.id);
      const zones = await storage.getManagementZonesByInterpolation(req.params.id);
      const applications = await storage.getPrescriptionApplicationsByInterpolation(req.params.id);
      res.json({ prescriptions, zones, applications });
    } catch (error) {
      res.status(500).json({ message: "Error al obtener prescripciones" });
    }
  });

  // ── Prescription Applications (T155) ────────────────────────────────────
  // GET /api/prescriptions/:id/applications — list applications for a prescription
  app.get("/api/prescriptions/:id/applications", isAuthenticated, async (req: any, res) => {
    try {
      const presc = await storage.getZonePrescriptionById(req.params.id);
      if (!presc) return res.status(404).json({ message: "Prescripción no encontrada" });
      const zone = await storage.getManagementZone(presc.zoneId);
      if (!zone) return res.status(404).json({ message: "Zona no encontrada" });
      if (req.user.role !== "admin") {
        const parcelId = zone.parcelId;
        if (!parcelId) return res.status(403).json({ message: "No autorizado" });
        const parcel = await storage.getParcel(parcelId);
        if (!parcel || parcel.userId !== req.user.id) return res.status(403).json({ message: "No autorizado" });
      }
      const applications = await storage.getPrescriptionApplicationsByPrescription(req.params.id);
      res.json({ applications });
    } catch (error) {
      res.status(500).json({ message: "Error al obtener aplicaciones" });
    }
  });

  // POST /api/prescriptions/:id/applications — register a new application
  app.post("/api/prescriptions/:id/applications", isAuthenticated, isActiveUser, async (req: any, res) => {
    try {
      const presc = await storage.getZonePrescriptionById(req.params.id);
      if (!presc) return res.status(404).json({ message: "Prescripción no encontrada" });
      const zone = await storage.getManagementZone(presc.zoneId);
      if (!zone) return res.status(404).json({ message: "Zona no encontrada" });
      if (req.user.role !== "admin") {
        const parcelId = zone.parcelId;
        if (!parcelId) return res.status(403).json({ message: "No autorizado" });
        const parcel = await storage.getParcel(parcelId);
        if (!parcel || parcel.userId !== req.user.id) return res.status(403).json({ message: "No autorizado" });
      }
      const { insertPrescriptionApplicationSchema } = await import("@shared/schema");
      const result = insertPrescriptionApplicationSchema.safeParse({
        applicationDate: req.body.applicationDate,
        actualDoseByZone: req.body.actualDoseByZone,
        machineUsed: req.body.machineUsed ?? null,
        notes: req.body.notes ?? null,
        prescriptionId: req.params.id,
        appliedBy: req.user.id,
      });
      if (!result.success) {
        const { fromZodError: fze } = await import("zod-validation-error");
        return res.status(400).json({ message: fze(result.error).message });
      }
      const application = await storage.createPrescriptionApplication(result.data);
      res.status(201).json({ application });
    } catch (error: any) {
      res.status(500).json({ message: `Error al registrar aplicación: ${error.message}` });
    }
  });

  // ─── Satellite-derived management zones ────────────────────────────────
  // Generate, list, delete, export and prescribe management zones derived from a
  // Sentinel-2 vegetation index. Implementation lives in ./routes/satellite-zones
  // so the same handlers can be exercised end-to-end in tests via supertest.
  registerSatelliteZoneRoutes(app, {
    storage,
    isGEEAvailable,
    getIndexRaster,
    fetchWithTimeout,
  }, { isAuthenticated, isActiveUser });

  // ─── Import KML/KMZ/GeoJSON/Shapefile/CSV → management zones, plus
  // ─── machine-friendly export (KML/KMZ/SHP/ISOXML/GeoJSON) for autoguidance.
  // ─── Implementation in ./routes/import-zones (T147).
  registerImportZoneRoutes(app, {
    storage,
    fetchWithTimeout,
  }, { isAuthenticated, isActiveUser });

  // ─── Drone-imagery management zones (MVZ dron) ────────────────────────────
  // POST /api/parcels/:id/zones/from-drone — upload GeoTIFF → calculate index → zones
  // GET  /api/parcels/:id/zones/from-drone — list drone zone sets
  // DELETE /api/parcels/:id/drone-zone-sets/:zoneSetId
  // POST /api/drone-zone-sets/:zoneSetId/prescribe
  registerDroneZoneRoutes(app, { storage, fetchWithTimeout }, { isAuthenticated, isActiveUser });

  // Sample size calculation (before creating campaign) - 3 methods
  app.post("/api/parcels/:id/sampling-campaigns/sample-size", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel || parcel.userId !== (req.user as any).id && (req.user as any).role !== "admin") return res.status(403).json({ message: "No autorizado" });

      const { variabilityPct, allowableError, confidenceLevel } = req.body || {};
      // Single source of truth: shared/sample-size.ts. Same formulas the UI and
      // /design-grid endpoint use, so all three views stay consistent.
      const result = computeSampleSize({
        areaHa: Number(parcel.area) || 1,
        variabilityPct,
        allowableError,
        confidenceLevel,
      });
      res.json(result);
    } catch (error) {
      res.status(500).json({ message: "Error al calcular tamaño de muestra" });
    }
  });

  // Regenerate AI instructions for an existing campaign
  app.post("/api/sampling-campaigns/:id/ai-instructions", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const campaign = await storage.getSamplingCampaign(req.params.id);
      if (!campaign) return res.status(404).json({ message: "Campaña no encontrada" });
      const parcel = await storage.getParcel(campaign.parcelId);
      if (!parcel || parcel.userId !== (req.user as any).id && (req.user as any).role !== "admin") return res.status(403).json({ message: "No autorizado" });
      const variable = await storage.getMasterVariable(campaign.variableId);
      if (!variable) return res.status(404).json({ message: "Variable no encontrada" });

      const aiInstructions = await generateSamplingInstructions(
        variable.name, variable.unit, campaign.nPointsPlanned,
        parcel.crop || "cultivo", parcel.soilType || undefined, Number(campaign.samplingDepth) || 20,
      );
      const updated = await storage.updateSamplingCampaign(req.params.id, { aiInstructions });
      res.json({ aiInstructions, campaign: updated });
    } catch (error: any) {
      res.status(500).json({ message: `Error al generar instrucciones IA: ${error.message}` });
    }
  });

  // Bulk create sampling points (offline sync upload)
  app.post("/api/sampling-campaigns/:id/points/bulk", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const campaign = await storage.getSamplingCampaign(req.params.id);
      if (!campaign) return res.status(404).json({ message: "Campaña no encontrada" });
      const parcel = await storage.getParcel(campaign.parcelId);
      if (!parcel || parcel.userId !== (req.user as any).id && (req.user as any).role !== "admin") return res.status(403).json({ message: "No autorizado" });

      const { points } = req.body || {};
      if (!Array.isArray(points) || points.length === 0) {
        return res.status(400).json({ message: "Se requiere un array 'points' no vacío" });
      }
      if (points.length > 500) {
        return res.status(400).json({ message: "Demasiados puntos en un solo lote (máx 500)" });
      }

      // ── Validate every row up-front. Reject the whole batch on any error so ──
      // the operator can fix the CSV instead of getting a half-imported set.
      const polygonForCheck = parcel.polygonCoordinates as LatLng[] | null;
      const polygonValid = isValidPolygon(polygonForCheck);
      const orientationWarning = detectInvertedOrientation(polygonForCheck);
      if (orientationWarning) {
        return res.status(400).json({ message: orientationWarning, code: "POLYGON_ORIENTATION" });
      }
      const variable = await storage.getMasterVariable(campaign.variableId);
      const minVal = variable?.minValue != null ? Number(variable.minValue) : null;
      const maxVal = variable?.maxValue != null ? Number(variable.maxValue) : null;

      // Pre-load existing pointIndex + coordinate keys for duplicate detection.
      const existingPointsForDedupe = await storage.getSamplingPointsByCampaign(req.params.id);
      const existingIndexSet = new Set(existingPointsForDedupe.map(p => p.pointIndex).filter(n => n != null));
      const existingCoordSet = new Set(
        existingPointsForDedupe.map(p => `${Number(p.latPlanned).toFixed(6)},${Number(p.lonPlanned).toFixed(6)}`),
      );
      const seenIndexInBatch = new Set<number>();
      const seenCoordInBatch = new Set<string>();

      const errors: { row: number; message: string }[] = [];
      const validated: zSampling.infer<typeof bulkSamplingPointSchema>[] = [];
      for (let i = 0; i < points.length; i++) {
        const parsed = bulkSamplingPointSchema.safeParse(points[i]);
        if (!parsed.success) {
          errors.push({ row: i, message: fromZodError(parsed.error).message });
          continue;
        }
        const p = parsed.data;
        if (Math.abs(p.latPlanned) < 1e-6 && Math.abs(p.lonPlanned) < 1e-6) {
          errors.push({ row: i, message: "Coordenadas (0, 0) no son válidas" });
          continue;
        }
        if (polygonValid && !pipLatLng(p.latPlanned, p.lonPlanned, polygonForCheck!)) {
          errors.push({ row: i, message: "Punto fuera del polígono de la parcela" });
          continue;
        }
        // Duplicate detection — both within this batch and against existing points.
        const coordKey = `${p.latPlanned.toFixed(6)},${p.lonPlanned.toFixed(6)}`;
        if (seenCoordInBatch.has(coordKey) || existingCoordSet.has(coordKey)) {
          errors.push({ row: i, message: `Coordenadas duplicadas (${coordKey})` });
          continue;
        }
        seenCoordInBatch.add(coordKey);
        if (p.pointIndex != null) {
          if (seenIndexInBatch.has(p.pointIndex) || existingIndexSet.has(p.pointIndex)) {
            errors.push({ row: i, message: `pointIndex duplicado: ${p.pointIndex}` });
            continue;
          }
          seenIndexInBatch.add(p.pointIndex);
        }
        if (p.value != null) {
          if (minVal != null && p.value < minVal) {
            errors.push({
              row: i,
              message: `Valor ${p.value} por debajo del mínimo permitido (${minVal} ${variable?.unit ?? ""})`,
            });
            continue;
          }
          if (maxVal != null && p.value > maxVal) {
            errors.push({
              row: i,
              message: `Valor ${p.value} por encima del máximo permitido (${maxVal} ${variable?.unit ?? ""})`,
            });
            continue;
          }
        }
        validated.push(p);
      }
      if (errors.length > 0) {
        return res.status(400).json({
          message: `Se encontraron ${errors.length} fila(s) inválidas`,
          code: "BULK_VALIDATION",
          errors,
        });
      }

      // Always reassign pointIndex sequentially starting after the campaign's current
      // max index. Incoming pointIndex values are ignored beyond duplicate diagnostics
      // above — the server is the source of truth for point ordering.
      const maxIdx = existingPointsForDedupe.reduce((m, p) => Math.max(m, p.pointIndex ?? 0), 0);

      const created = await storage.bulkCreateSamplingPoints(
        validated.map((p, i) => ({
          campaignId: req.params.id,
          pointIndex: maxIdx + i + 1,
          latPlanned: p.latPlanned,
          lonPlanned: p.lonPlanned,
          latActual: p.latActual ?? null,
          lonActual: p.lonActual ?? null,
          value: p.value ?? null,
          notes: p.notes ?? null,
          nSubsamples: p.nSubsamples ?? 1,
          soilCondition: p.soilCondition ?? null,
          temperatureC: p.temperatureC ?? null,
          capturedAt: p.value != null ? new Date() : null,
        })),
      );
      res.status(201).json({ created: created.length, points: created });
    } catch (error: any) {
      res.status(500).json({ message: `Error al crear puntos: ${error.message}` });
    }
  });

  // ─── Modo Oficina: import multi-variable atómico desde CSV/Excel ───────────
  // Crea N campañas (una por variable) con sus puntos en una sola transacción.
  // Si cualquier validación falla, no se persiste nada.
  app.post("/api/parcels/:id/lab-import", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel || parcel.userId !== (req.user as any).id) {
        return res.status(403).json({ message: "No autorizado" });
      }

      const polygonForCheck = parcel.polygonCoordinates as LatLng[] | null;
      const polygonValid = isValidPolygon(polygonForCheck);
      if (!polygonValid) {
        return res.status(400).json({ message: "La parcela no tiene un polígono válido" });
      }
      const orientationWarning = detectInvertedOrientation(polygonForCheck);
      if (orientationWarning) {
        return res.status(400).json({ message: orientationWarning, code: "POLYGON_ORIENTATION" });
      }

      const labImportSchema = zSampling.object({
        campaignNamePrefix: zSampling.string().trim().min(1).max(120).optional(),
        samplingDepth: zSampling.coerce.number().min(1).max(200).optional().nullable(),
        notes: zSampling.string().max(1000).optional().nullable(),
        variables: zSampling.array(zSampling.object({
          variableId: zSampling.string().uuid(),
          campaignName: zSampling.string().trim().min(1).max(160).optional(),
          points: zSampling.array(zSampling.object({
            latPlanned: zSampling.coerce.number().min(-90).max(90),
            lonPlanned: zSampling.coerce.number().min(-180).max(180),
            value: zSampling.coerce.number().nullable().optional(),
            notes: zSampling.string().max(500).nullable().optional(),
          })).min(1).max(500),
        })).min(1).max(20),
      });

      const parsed = labImportSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: fromZodError(parsed.error).message });
      }
      const body = parsed.data;

      // ── Validate every variable + every row up-front ─────────────────────────
      // Importer policy: every imported point MUST have a numeric value so each
      // resulting campaign is genuinely interpolation-ready ("listo para
      // interpolar"). Rows without a value are reported as errors so the user
      // can fix the source file rather than ending up with half-empty campaigns.
      const masterVars = await storage.getMasterVariables();
      const masterById = new Map(masterVars.map(v => [v.id, v]));
      type CleanedPoint = { latPlanned: number; lonPlanned: number; value: number; notes: string | null };
      type ValidatedVar = { variable: typeof masterVars[number]; campaignName: string; points: CleanedPoint[] };
      const errors: { variableIndex: number; row?: number; message: string }[] = [];
      const validatedByVar: ValidatedVar[] = [];

      // Reject duplicate variable selections — uploading the same variable twice
      // would create two campaigns with the same name and confuse the user.
      const seenVarIds = new Set<string>();
      for (let vi = 0; vi < body.variables.length; vi++) {
        const vid = body.variables[vi].variableId;
        if (seenVarIds.has(vid)) {
          errors.push({ variableIndex: vi, message: `Variable repetida: ${vid}. Cada variable solo puede importarse una vez.` });
        }
        seenVarIds.add(vid);
      }

      // Note: real lab files measure many variables (pH, EC, MO, etc.) at the
      // SAME physical sampling points, so we deliberately allow the same
      // (lat, lon) across different variables. Duplicate detection is only
      // enforced *within* each variable.

      for (let vi = 0; vi < body.variables.length; vi++) {
        const v = body.variables[vi];
        const variable = masterById.get(v.variableId);
        if (!variable) {
          errors.push({ variableIndex: vi, message: `Variable ${v.variableId} no existe en el catálogo` });
          continue;
        }
        const minVal = variable.minValue != null ? Number(variable.minValue) : null;
        const maxVal = variable.maxValue != null ? Number(variable.maxValue) : null;
        const seenCoord = new Set<string>();
        const cleaned: CleanedPoint[] = [];
        for (let i = 0; i < v.points.length; i++) {
          const p = v.points[i];
          if (Math.abs(p.latPlanned) < 1e-6 && Math.abs(p.lonPlanned) < 1e-6) {
            errors.push({ variableIndex: vi, row: i, message: "Coordenadas (0, 0) no válidas" });
            continue;
          }
          if (!pipLatLng(p.latPlanned, p.lonPlanned, polygonForCheck!)) {
            errors.push({ variableIndex: vi, row: i, message: "Punto fuera del polígono de la parcela" });
            continue;
          }
          const coordKey = `${p.latPlanned.toFixed(6)},${p.lonPlanned.toFixed(6)}`;
          if (seenCoord.has(coordKey)) {
            errors.push({ variableIndex: vi, row: i, message: `Coordenadas duplicadas dentro de la variable (${coordKey})` });
            continue;
          }
          seenCoord.add(coordKey);
          const rawValue = p.value;
          const value = rawValue == null || (typeof rawValue === "number" && Number.isNaN(rawValue)) ? null : Number(rawValue);
          if (value == null) {
            errors.push({ variableIndex: vi, row: i, message: "Falta el valor de la variable (no es importable)" });
            continue;
          }
          if (minVal != null && value < minVal) {
            errors.push({ variableIndex: vi, row: i, message: `Valor ${value} por debajo del mínimo (${minVal} ${variable.unit})` });
            continue;
          }
          if (maxVal != null && value > maxVal) {
            errors.push({ variableIndex: vi, row: i, message: `Valor ${value} por encima del máximo (${maxVal} ${variable.unit})` });
            continue;
          }
          cleaned.push({ latPlanned: p.latPlanned, lonPlanned: p.lonPlanned, value, notes: p.notes ?? null });
        }
        const defaultName = `${variable.name} — ${new Date().toISOString().slice(0, 10)}`;
        validatedByVar.push({
          variable,
          campaignName: (v.campaignName || (body.campaignNamePrefix ? `${body.campaignNamePrefix} — ${variable.name}` : defaultName)).slice(0, 160),
          points: cleaned,
        });
      }

      if (errors.length > 0) {
        return res.status(400).json({
          message: `Se encontraron ${errors.length} fila(s) inválidas`,
          code: "LAB_IMPORT_VALIDATION",
          errors,
        });
      }

      // ── Atomic persistence: single Postgres transaction ──────────────────────
      // Either every campaign and every point persists, or none of them do.
      const userId = (req.user as User).id;
      const now = new Date();
      const items = validatedByVar.map((v) => ({
        variable: v.variable,
        campaign: {
          parcelId: parcel.id,
          userId,
          variableId: v.variable.id,
          name: v.campaignName,
          status: "completed" as SamplingCampaignStatus,
          gridType: "stratified",
          nPointsPlanned: v.points.length,
          nPointsDone: v.points.length, // every imported row has a value
          methodUsed: "lab-import",
          samplingDepth: body.samplingDepth ?? 20,
          notes: body.notes ?? null,
          startedAt: now,
          completedAt: now,
        },
        points: v.points.map((p, i) => ({
          pointIndex: i + 1,
          latPlanned: p.latPlanned,
          lonPlanned: p.lonPlanned,
          latActual: p.latPlanned,
          lonActual: p.lonPlanned,
          value: p.value,
          notes: p.notes,
          nSubsamples: 1,
          soilCondition: null,
          temperatureC: null,
          capturedAt: now,
        })),
      }));

      let createdCampaigns;
      try {
        createdCampaigns = await storage.transactionalLabImport(
          items.map((i) => ({ campaign: i.campaign as any, points: i.points as any })),
        );
      } catch (persistErr) {
        const msg = persistErr instanceof Error ? persistErr.message : String(persistErr);
        return res.status(500).json({ message: `Error al guardar campañas: ${msg}` });
      }

      const created = createdCampaigns.map((campaign, idx) => ({
        campaignId: campaign.id,
        variableCode: items[idx].variable.code,
        variableName: items[idx].variable.name,
        campaignName: campaign.name,
        nPoints: items[idx].points.length,
        allHaveValues: true, // policy: every imported point has a value
      }));

      res.status(201).json({ created, parcelId: parcel.id });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ message: `Error en importación de laboratorio: ${msg}` });
    }
  });

  // Bulk delete all points of a campaign (atomic — replaces N parallel DELETEs)
  app.delete("/api/sampling-campaigns/:id/points", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const campaign = await storage.getSamplingCampaign(req.params.id);
      if (!campaign) return res.status(404).json({ message: "Campaña no encontrada" });
      const parcel = await storage.getParcel(campaign.parcelId);
      if (!parcel || parcel.userId !== (req.user as any).id && (req.user as any).role !== "admin") return res.status(403).json({ message: "No autorizado" });

      const existing = await storage.getSamplingPointsByCampaign(req.params.id);
      const capturedCount = existing.filter(p => p.value != null).length;
      const force = req.body?.force === true || req.query?.force === "true";
      if (capturedCount > 0 && !force) {
        return res.status(409).json({
          message: `La campaña tiene ${capturedCount} punto(s) con valores capturados. Confirma con force=true para borrarlos.`,
          code: "HAS_CAPTURED_DATA",
          capturedCount,
        });
      }
      const deleted = await storage.deleteSamplingPointsByCampaign(req.params.id);
      // If the campaign had already been interpolated, deleting captured points
      // invalidates the stored raster/zones — revert to "active" so the user
      // must re-run interpolation with the new dataset.
      if (campaign.status === "interpolated" || campaign.status === "completed") {
        await storage.updateSamplingCampaign(req.params.id, { status: "active" as SamplingCampaignStatus });
      }
      res.json({ deleted });
    } catch (error: any) {
      res.status(500).json({ message: `Error al eliminar puntos: ${error.message}` });
    }
  });

  // Delete sampling point
  app.delete("/api/sampling-points/:id", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const point = await storage.getSamplingPoint(req.params.id);
      if (!point) return res.status(404).json({ message: "Punto no encontrado" });
      const campaign = await storage.getSamplingCampaign(point.campaignId);
      if (!campaign) return res.status(404).json({ message: "Campaña no encontrada" });
      const parcel = await storage.getParcel(campaign.parcelId);
      if (!parcel || parcel.userId !== (req.user as any).id && (req.user as any).role !== "admin") return res.status(403).json({ message: "No autorizado" });
      const hadValue = point.value != null;
      await storage.deleteSamplingPoint(req.params.id);
      // If we just removed a *measured* point from an already-interpolated campaign,
      // the saved interpolation/zones no longer reflect reality. Revert to "active"
      // so the UI forces the user through interpolation again.
      if (hadValue && (campaign.status === "interpolated" || campaign.status === "completed")) {
        await storage.updateSamplingCampaign(campaign.id, { status: "active" as SamplingCampaignStatus });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Error al eliminar punto" });
    }
  });

  // Offline batch sync readings
  app.post("/api/sampling-campaigns/:id/sync-readings", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const campaign = await storage.getSamplingCampaign(req.params.id);
      if (!campaign) return res.status(404).json({ message: "Campaña no encontrada" });
      const parcel = await storage.getParcel(campaign.parcelId);
      if (!parcel || parcel.userId !== (req.user as any).id && (req.user as any).role !== "admin") return res.status(403).json({ message: "No autorizado" });

      const { readings } = req.body; // [{pointId, value, latActual, lonActual, notes, soilCondition, nSubsamples}]
      if (!Array.isArray(readings) || readings.length === 0) {
        return res.status(400).json({ message: "Se requiere un array 'readings' no vacío" });
      }

      const results: { pointId: string; updated: boolean; isOutlier?: boolean; missing?: boolean }[] = [];
      for (const r of readings) {
        const point = await storage.getSamplingPoint(r.pointId);
        if (!point || point.campaignId !== req.params.id) {
          // Tell the client explicitly so it can drop the obsolete pending entry
          // instead of retrying forever.
          results.push({ pointId: r.pointId, updated: false, missing: true });
          continue;
        }

        const variable = await storage.getMasterVariable(campaign.variableId);
        const val = Number(r.value);

        // Physical range validation
        let isOutlier = false;
        if (variable && !isNaN(val)) {
          if (val < Number(variable.minValue) || val > Number(variable.maxValue)) {
            isOutlier = true;
          }
        }

        const updated = await storage.updateSamplingPoint(r.pointId, {
          value: isNaN(val) ? null : val,
          latActual: r.latActual ?? null,
          lonActual: r.lonActual ?? null,
          notes: r.notes ?? null,
          soilCondition: r.soilCondition ?? null,
          nSubsamples: r.nSubsamples ?? 1,
          temperatureC: r.temperatureC ?? null,
          isOutlier,
          capturedAt: !isNaN(val) ? new Date() : undefined,
        });
        results.push({ pointId: r.pointId, updated: true, isOutlier });
      }

      // Update campaign progress
      const allPoints = await storage.getSamplingPointsByCampaign(req.params.id);
      const nDone = allPoints.filter(p => p.value != null).length;
      const newStatus: SamplingCampaignStatus = nDone >= campaign.nPointsPlanned ? "completed" : "active";
      const syncProgressUpdate: { nPointsDone: number; status: SamplingCampaignStatus; completedAt?: Date; startedAt?: Date } = { nPointsDone: nDone, status: newStatus };
      if (newStatus === "completed") syncProgressUpdate.completedAt = new Date();
      if (nDone > 0 && campaign.status === "designing") syncProgressUpdate.startedAt = new Date();
      await storage.updateSamplingCampaign(req.params.id, syncProgressUpdate);

      res.json({ synced: results.length, nDone, status: newStatus, details: results });
    } catch (error: any) {
      res.status(500).json({ message: `Error al sincronizar lecturas: ${error.message}` });
    }
  });

  // GET interpolation variogram data (from stored params)
  app.get("/api/interpolations/:id/variogram", isAuthenticated, async (req, res) => {
    try {
      const interp = await storage.getInterpolationResult(req.params.id);
      if (!interp) return res.status(404).json({ message: "Interpolación no encontrada" });
      const campaign = await storage.getSamplingCampaign(interp.campaignId);
      if (!campaign) return res.status(404).json({ message: "Campaña no encontrada" });
      const parcel = await storage.getParcel(campaign.parcelId);
      if (!parcel || parcel.userId !== (req.user as any).id && (req.user as any).role !== "admin") return res.status(403).json({ message: "No autorizado" });

      const params: any = interp.paramsJson || {};
      const rawLags: any[] = interp.variogramLags || params.variogram_lags || [];
      const lags = rawLags.map((l: any) => ({
        h: l.h ?? l.lag ?? 0,
        gamma: l.gamma ?? l.semivariance ?? 0,
        gamma_fit: l.gamma_fit ?? l.fitted ?? undefined,
      }));
      res.json({
        model: interp.variogramModel,
        range: interp.variogramRange,
        sill: interp.variogramSill,
        nugget: interp.variogramNugget,
        lags,
        rmse: interp.rmseCv,
        mae: interp.maeCv,
        r2: interp.r2Cv,
      });
    } catch (error) {
      res.status(500).json({ message: "Error al obtener variograma" });
    }
  });

  // Compare multiple interpolation methods for a campaign
  app.get("/api/sampling-campaigns/:id/compare", isAuthenticated, async (req, res) => {
    try {
      const campaign = await storage.getSamplingCampaign(req.params.id);
      if (!campaign) return res.status(404).json({ message: "Campaña no encontrada" });
      const parcel = await storage.getParcel(campaign.parcelId);
      if (!parcel || parcel.userId !== (req.user as any).id && (req.user as any).role !== "admin") return res.status(403).json({ message: "No autorizado" });

      const results = await storage.getInterpolationResultsByCampaign(req.params.id);

      // Deduplicate: one row per method (best RMSE wins); exclude failed runs
      const byMethod = new Map<string, typeof results[0]>();
      for (const r of results) {
        if (r.method.endsWith("-failed")) continue;
        const existing = byMethod.get(r.method);
        if (!existing) { byMethod.set(r.method, r); continue; }
        const rRmse = r.rmseCv != null ? Number(r.rmseCv) : Infinity;
        const eRmse = existing.rmseCv != null ? Number(existing.rmseCv) : Infinity;
        if (rRmse < eRmse) byMethod.set(r.method, r);
      }

      const comparison = Array.from(byMethod.values()).map(r => {
        const p = r.paramsJson as any;
        const isFallback = p?.degenerate_fallback === true
          || p?.model === "idw-fallback"
          || String(p?.method ?? "").includes("idw-fallback")
          || String(p?.kernel ?? "").includes("idw-fallback");
        const fallbackReason: string | null = p?.degenerate_reason ?? p?.error ?? null;
        return {
          id: r.id,
          method: r.method,
          rmseCv: r.rmseCv,
          maeCv: r.maeCv,
          r2Cv: r.r2Cv,
          variogramModel: r.variogramModel,
          createdAt: r.createdAt,
          isFallback,
          fallbackReason,
        };
      }).sort((a, b) => Number(a.rmseCv ?? 999) - Number(b.rmseCv ?? 999));

      const nonFallbacks = comparison.filter(c => !c.isFallback);
      const best = (nonFallbacks.length > 0 ? nonFallbacks : comparison)[0] ?? null;
      res.json({ comparison, best });
    } catch (error) {
      res.status(500).json({ message: "Error al comparar métodos" });
    }
  });

  // Compare interpolation methods scoped to the campaign that owns a given interpolation
  app.get("/api/interpolations/:id/compare", isAuthenticated, async (req, res) => {
    try {
      const interp = await storage.getInterpolationResult(req.params.id);
      if (!interp) return res.status(404).json({ message: "Interpolación no encontrada" });
      const campaign = await storage.getSamplingCampaign(interp.campaignId);
      if (!campaign) return res.status(404).json({ message: "Campaña no encontrada" });
      const parcel = await storage.getParcel(campaign.parcelId);
      if (!parcel || parcel.userId !== (req.user as any).id && (req.user as any).role !== "admin") return res.status(403).json({ message: "No autorizado" });

      const results = await storage.getInterpolationResultsByCampaign(interp.campaignId);

      // Deduplicate: one row per method (best RMSE wins); exclude failed runs
      const byMethod = new Map<string, typeof results[0]>();
      for (const r of results) {
        if (r.method.endsWith("-failed")) continue;
        const existing = byMethod.get(r.method);
        if (!existing) { byMethod.set(r.method, r); continue; }
        const rRmse = r.rmseCv != null ? Number(r.rmseCv) : Infinity;
        const eRmse = existing.rmseCv != null ? Number(existing.rmseCv) : Infinity;
        if (rRmse < eRmse) byMethod.set(r.method, r);
      }

      const comparison = Array.from(byMethod.values()).map(r => {
        const p = r.paramsJson as any;
        const isFallback = p?.degenerate_fallback === true
          || p?.model === "idw-fallback"
          || String(p?.method ?? "").includes("idw-fallback")
          || String(p?.kernel ?? "").includes("idw-fallback");
        const fallbackReason: string | null = p?.degenerate_reason ?? p?.error ?? null;
        return {
          id: r.id,
          method: r.method,
          rmseCv: r.rmseCv,
          maeCv: r.maeCv,
          r2Cv: r.r2Cv,
          variogramModel: r.variogramModel,
          createdAt: r.createdAt,
          isCurrent: r.id === req.params.id,
          isFallback,
          fallbackReason,
        };
      }).sort((a, b) => Number(a.rmseCv ?? 999) - Number(b.rmseCv ?? 999));

      const nonFallbacks = comparison.filter(c => !c.isFallback);
      const best = (nonFallbacks.length > 0 ? nonFallbacks : comparison)[0] ?? null;
      res.json({ comparison, best, campaignId: interp.campaignId });
    } catch (error) {
      res.status(500).json({ message: "Error al comparar métodos" });
    }
  });

  // Update management zone (labels, category, AI interpretation)
  app.patch("/api/management-zones/:id", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const zone = await storage.getManagementZone(req.params.id);
      if (!zone) return res.status(404).json({ message: "Zona no encontrada" });
      if (!zone.interpolationId) return res.status(422).json({ message: "Zona sin interpolación asociada" });
      const interp = await storage.getInterpolationResult(zone.interpolationId);
      if (!interp) return res.status(404).json({ message: "Interpolación no encontrada" });
      const campaign = await storage.getSamplingCampaign(interp.campaignId);
      if (!campaign) return res.status(404).json({ message: "Campaña no encontrada" });
      const parcel = await storage.getParcel(campaign.parcelId);
      if (!parcel || parcel.userId !== (req.user as any).id && (req.user as any).role !== "admin") return res.status(403).json({ message: "No autorizado" });

      const { zoneLabel, category, aiInterpretation, colorHex } = req.body;
      const updated = await storage.updateManagementZone(req.params.id, {
        ...(zoneLabel !== undefined ? { zoneLabel } : {}),
        ...(category !== undefined ? { category } : {}),
        ...(aiInterpretation !== undefined ? { aiInterpretation } : {}),
        ...(colorHex !== undefined ? { colorHex } : {}),
      });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Error al actualizar zona" });
    }
  });

  // Generate AI interpretation for a single management zone
  app.post("/api/management-zones/:id/interpret", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const zone = await storage.getManagementZone(req.params.id);
      if (!zone) return res.status(404).json({ message: "Zona no encontrada" });
      if (!zone.interpolationId) return res.status(422).json({ message: "Zona sin interpolación asociada" });
      const interp = await storage.getInterpolationResult(zone.interpolationId);
      if (!interp) return res.status(404).json({ message: "Interpolación no encontrada" });
      const campaign = await storage.getSamplingCampaign(interp.campaignId);
      if (!campaign) return res.status(404).json({ message: "Campaña no encontrada" });
      const parcel = await storage.getParcel(campaign.parcelId);
      if (!parcel || parcel.userId !== (req.user as any).id && (req.user as any).role !== "admin") return res.status(403).json({ message: "No autorizado" });
      const variable = await storage.getMasterVariable(campaign.variableId);
      if (!variable) return res.status(404).json({ message: "Variable no encontrada" });

      // Fetch all sibling zones for this interpolation so the AI has full spatial context
      const allZones = await storage.getManagementZonesByInterpolation(zone.interpolationId);

      const zonesCtx = allZones.map(z => ({
        zoneIndex: z.zoneIndex,
        category: z.category ?? undefined,
        valueMean: Number(z.valueMean ?? 0),
        valueMin: Number(z.valueMin ?? 0),
        valueMax: Number(z.valueMax ?? 0),
        areaHa: Number(z.areaHa ?? 0),
        colorHex: z.colorHex ?? undefined,
      }));

      const interpretation = await interpretInterpolationMap({
        variableName: variable.name,
        variableUnit: variable.unit,
        variableCode: variable.code,
        crop: parcel.crop ?? "cultivo",
        soilType: parcel.soilType ?? undefined,
        method: interp.method ?? "idw",
        rmseCv: interp.rmseCv != null ? Number(interp.rmseCv) : undefined,
        r2Cv: interp.r2Cv != null ? Number(interp.r2Cv) : undefined,
        optimalMin: variable.optimalMin != null ? Number(variable.optimalMin) : undefined,
        optimalMax: variable.optimalMax != null ? Number(variable.optimalMax) : undefined,
        zones: zonesCtx,
      });

      const updated = await storage.updateManagementZone(req.params.id, { aiInterpretation: interpretation });
      res.json(updated);
    } catch (error) {
      console.error("Zone interpret error:", error);
      res.status(500).json({ message: "Error al generar interpretación IA" });
    }
  });

  // Prescribe single zone
  app.post("/api/management-zones/:id/prescribe", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const zone = await storage.getManagementZone(req.params.id);
      if (!zone) return res.status(404).json({ message: "Zona no encontrada" });
      if (!zone.interpolationId) return res.status(422).json({ message: "Zona sin interpolación asociada" });
      const interp = await storage.getInterpolationResult(zone.interpolationId);
      if (!interp) return res.status(404).json({ message: "Interpolación no encontrada" });
      const campaign = await storage.getSamplingCampaign(interp.campaignId);
      if (!campaign) return res.status(404).json({ message: "Campaña no encontrada" });
      const parcel = await storage.getParcel(campaign.parcelId);
      if (!parcel || parcel.userId !== (req.user as any).id && (req.user as any).role !== "admin") return res.status(403).json({ message: "No autorizado" });
      const variable = await storage.getMasterVariable(campaign.variableId);
      if (!variable) return res.status(404).json({ message: "Variable no encontrada" });

      const ai = await generateZonePrescription({
        variableCode: variable.code,
        variableName: variable.name,
        variableUnit: variable.unit,
        optimalMin: variable.optimalMin != null ? Number(variable.optimalMin) : undefined,
        optimalMax: variable.optimalMax != null ? Number(variable.optimalMax) : undefined,
        crop: parcel.crop || "cultivo",
        soilType: parcel.soilType || undefined,
        zoneIndex: zone.zoneIndex,
        category: zone.category || zone.zoneLabel || "",
        valueMean: Number(zone.valueMean) || 0,
        valueMin: Number(zone.valueMin) || 0,
        valueMax: Number(zone.valueMax) || 0,
        areaHa: Number(zone.areaHa) || 0,
      });

      await storage.deleteZonePrescriptionsByZone(zone.id);
      const presc = await storage.createZonePrescription({
        zoneId: zone.id,
        amendment: ai.amendment,
        dosePerHa: ai.dosePerHa ?? null,
        doseUnit: ai.doseUnit,
        totalDose: ai.totalDose ?? null,
        applicationMethod: ai.applicationMethod,
        timing: ai.timing,
        aiRationale: ai.aiRationale,
        estimatedCost: ai.estimatedCostPerHa != null ? ai.estimatedCostPerHa * (Number(zone.areaHa) || 1) : null,
      });
      res.json({ prescription: presc, zone });
    } catch (error: any) {
      res.status(500).json({ message: `Error al prescribir zona: ${error.message}` });
    }
  });

  // Interpret interpolation map with AI
  app.post("/api/interpolations/:id/interpret", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const interp = await storage.getInterpolationResult(req.params.id);
      if (!interp) return res.status(404).json({ message: "Interpolación no encontrada" });
      const campaign = await storage.getSamplingCampaign(interp.campaignId);
      if (!campaign) return res.status(404).json({ message: "Campaña no encontrada" });
      const parcel = await storage.getParcel(campaign.parcelId);
      if (!parcel || parcel.userId !== (req.user as any).id && (req.user as any).role !== "admin") return res.status(403).json({ message: "No autorizado" });
      const variable = await storage.getMasterVariable(campaign.variableId);
      if (!variable) return res.status(404).json({ message: "Variable no encontrada" });

      const zones = await storage.getManagementZonesByInterpolation(req.params.id);
      if (zones.length === 0) return res.status(400).json({ message: "No hay zonas para interpretar" });

      const interpretation = await interpretInterpolationMap({
        variableName: variable.name,
        variableUnit: variable.unit,
        variableCode: variable.code,
        crop: parcel.crop || "cultivo",
        soilType: parcel.soilType || undefined,
        method: interp.method,
        rmseCv: interp.rmseCv != null ? Number(interp.rmseCv) : undefined,
        r2Cv: interp.r2Cv != null ? Number(interp.r2Cv) : undefined,
        optimalMin: variable.optimalMin != null ? Number(variable.optimalMin) : undefined,
        optimalMax: variable.optimalMax != null ? Number(variable.optimalMax) : undefined,
        zones: zones.map(z => ({
          zoneIndex: z.zoneIndex,
          category: z.category || z.zoneLabel || undefined,
          valueMean: Number(z.valueMean) || 0,
          valueMin: Number(z.valueMin) || 0,
          valueMax: Number(z.valueMax) || 0,
          areaHa: Number(z.areaHa) || 0,
          colorHex: z.colorHex || undefined,
        })),
      });
      res.json({ interpretation });
    } catch (error: any) {
      res.status(500).json({ message: `Error al interpretar mapa: ${error.message}` });
    }
  });

  // Generate management report for a campaign
  app.post("/api/sampling-campaigns/:id/report", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const campaign = await storage.getSamplingCampaign(req.params.id);
      if (!campaign) return res.status(404).json({ message: "Campaña no encontrada" });
      const parcel = await storage.getParcel(campaign.parcelId);
      if (!parcel || parcel.userId !== (req.user as any).id && (req.user as any).role !== "admin") return res.status(403).json({ message: "No autorizado" });
      const variable = await storage.getMasterVariable(campaign.variableId);
      if (!variable) return res.status(404).json({ message: "Variable no encontrada" });

      const interpolations = await storage.getInterpolationResultsByCampaign(req.params.id);
      if (interpolations.length === 0) return res.status(400).json({ message: "No hay interpolaciones para generar reporte" });

      // Use best interpolation (lowest RMSE)
      const bestInterp = interpolations.sort((a, b) => Number(a.rmseCv ?? 999) - Number(b.rmseCv ?? 999))[0];
      const zones = await storage.getManagementZonesByInterpolation(bestInterp.id);
      const allPrescriptions = await storage.getZonePrescriptionsByInterpolation(bestInterp.id);

      const report = await generateManagementReport({
        parcelName: parcel.name,
        parcelArea: Number(parcel.area) || 1,
        crop: parcel.crop || "cultivo",
        soilType: parcel.soilType || undefined,
        variableName: variable.name,
        variableUnit: variable.unit,
        method: bestInterp.method,
        samplingDate: campaign.completedAt ? new Date(campaign.completedAt).toLocaleDateString("es-MX") : undefined,
        zones: zones.map(z => ({
          zoneIndex: z.zoneIndex,
          category: z.category || z.zoneLabel || undefined,
          valueMean: Number(z.valueMean) || 0,
          areaHa: Number(z.areaHa) || 0,
          prescriptions: allPrescriptions.filter(p => p.zoneId === z.id).map(p => ({
            amendment: p.amendment,
            dosePerHa: Number(p.dosePerHa) || 0,
            doseUnit: p.doseUnit || "kg/ha",
            totalDose: Number(p.totalDose) || 0,
            estimatedCost: p.estimatedCost != null ? Number(p.estimatedCost) : undefined,
          })),
        })),
      });

      res.json({ report, campaignId: req.params.id, interpId: bestInterp.id });
    } catch (error: any) {
      res.status(500).json({ message: `Error al generar reporte: ${error.message}` });
    }
  });

  // Export campaign data as GeoJSON or KML
  app.get("/api/sampling-campaigns/:id/export/:format", isAuthenticated, async (req, res) => {
    try {
      const { id, format } = req.params;
      if (!["geojson", "kml"].includes(format)) {
        return res.status(400).json({ message: "Formato debe ser 'geojson' o 'kml'" });
      }

      const campaign = await storage.getSamplingCampaign(id);
      if (!campaign) return res.status(404).json({ message: "Campaña no encontrada" });
      const parcel = await storage.getParcel(campaign.parcelId);
      if (!parcel || parcel.userId !== (req.user as any).id && (req.user as any).role !== "admin") return res.status(403).json({ message: "No autorizado" });
      const variable = await storage.getMasterVariable(campaign.variableId);
      const points = await storage.getSamplingPointsByCampaign(id);

      const interpolations = await storage.getInterpolationResultsByCampaign(id);
      let zones: any[] = [];
      let prescriptions: any[] = [];
      if (interpolations.length > 0) {
        const bestInterp = interpolations.sort((a, b) => Number(a.rmseCv ?? 999) - Number(b.rmseCv ?? 999))[0];
        zones = await storage.getManagementZonesByInterpolation(bestInterp.id);
        prescriptions = await storage.getZonePrescriptionsByInterpolation(bestInterp.id);
      }

      if (format === "geojson") {
        const geojson = {
          type: "FeatureCollection",
          name: `${parcel.name} - ${variable?.name || "MVZ"} - ${campaign.name}`,
          features: [
            // Sampling points
            ...points.map(p => ({
              type: "Feature",
              geometry: {
                type: "Point",
                coordinates: [Number(p.lonActual || p.lonPlanned), Number(p.latActual || p.latPlanned)],
              },
              properties: {
                type: "sampling_point",
                pointIndex: p.pointIndex,
                value: p.value,
                unit: variable?.unit,
                isOutlier: p.isOutlier,
                capturedAt: p.capturedAt,
                soilCondition: p.soilCondition,
                notes: p.notes,
              },
            })),
            // Management zones
            ...zones.filter(z => z.polygonGeojson).map(z => {
              const zonePrescs = prescriptions.filter(p => p.zoneId === z.id);
              return {
                type: "Feature",
                geometry: z.polygonGeojson,
                properties: {
                  type: "management_zone",
                  zoneIndex: z.zoneIndex,
                  zoneLabel: z.zoneLabel,
                  category: z.category,
                  valueMean: z.valueMean,
                  valueMin: z.valueMin,
                  valueMax: z.valueMax,
                  areaHa: z.areaHa,
                  colorHex: z.colorHex,
                  prescriptions: zonePrescs.map(p => ({
                    amendment: p.amendment,
                    dosePerHa: p.dosePerHa,
                    doseUnit: p.doseUnit,
                    totalDose: p.totalDose,
                    estimatedCost: p.estimatedCost,
                    aiRationale: p.aiRationale,
                  })),
                },
              };
            }),
          ],
        };

        res.setHeader("Content-Type", "application/geo+json");
        res.setHeader("Content-Disposition", `attachment; filename="${parcel.name.replace(/\s+/g, "_")}_MVZ_${campaign.name.replace(/\s+/g, "_")}.geojson"`);
        res.json(geojson);

      } else {
        // KML export
        const pointsKml = points.map(p => `
    <Placemark>
      <name>Punto ${p.pointIndex + 1}${p.value != null ? ` (${p.value} ${variable?.unit || ""})` : " (pendiente)"}</name>
      <description>Valor: ${p.value ?? "N/A"} ${variable?.unit || ""} | Outlier: ${p.isOutlier ? "Sí" : "No"} | ${p.notes || ""}</description>
      <Point><coordinates>${Number(p.lonActual || p.lonPlanned)},${Number(p.latActual || p.latPlanned)},0</coordinates></Point>
    </Placemark>`).join("");

        const zonesKml = zones.filter(z => z.polygonGeojson?.coordinates).map(z => {
          const coords = z.polygonGeojson.coordinates?.[0];
          if (!coords) return "";
          const coordStr = coords.map((c: number[]) => `${c[0]},${c[1]},0`).join(" ");
          const zonePrescs = prescriptions.filter(p => p.zoneId === z.id);
          const prescStr = zonePrescs.map((p: any) => `${p.amendment}: ${p.dosePerHa} ${p.doseUnit}/ha`).join("; ");
          return `
    <Placemark>
      <name>Zona ${z.zoneIndex + 1} (${z.category || z.zoneLabel || ""})</name>
      <description>Media: ${z.valueMean} ${variable?.unit || ""} | Área: ${z.areaHa} ha | ${prescStr}</description>
      <Style><PolyStyle><color>${z.colorHex ? "80" + z.colorHex.replace("#", "") : "8000FF00"}</color></PolyStyle></Style>
      <Polygon><outerBoundaryIs><LinearRing><coordinates>${coordStr}</coordinates></LinearRing></outerBoundaryIs></Polygon>
    </Placemark>`;
        }).join("");

        const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${parcel.name} - ${variable?.name || "MVZ"} - ${campaign.name}</name>
    <description>Campaña de Muestreo: ${campaign.name} | Variable: ${variable?.name} | Parcela: ${parcel.name}</description>
    <Folder>
      <name>Puntos de Muestreo</name>${pointsKml}
    </Folder>
    <Folder>
      <name>Zonas de Manejo</name>${zonesKml}
    </Folder>
  </Document>
</kml>`;

        res.setHeader("Content-Type", "application/vnd.google-earth.kml+xml");
        res.setHeader("Content-Disposition", `attachment; filename="${parcel.name.replace(/\s+/g, "_")}_MVZ_${campaign.name.replace(/\s+/g, "_")}.kml"`);
        res.send(kml);
      }
    } catch (error: any) {
      res.status(500).json({ message: `Error al exportar: ${error.message}` });
    }
  });

  // Variogram lags proxy
  app.post("/api/sampling-campaigns/:id/variogram", isAuthenticated, async (req, res) => {
    try {
      const campaign = await storage.getSamplingCampaign(req.params.id);
      if (!campaign) return res.status(404).json({ message: "Campaña no encontrada" });
      const parcel = await storage.getParcel(campaign.parcelId);
      if (!parcel || parcel.userId !== (req.user as any).id && (req.user as any).role !== "admin") return res.status(403).json({ message: "No autorizado" });

      const points = await storage.getSamplingPointsByCampaign(req.params.id);
      const measured = points.filter(p => p.value != null);
      if (measured.length < 3) return res.status(400).json({ message: "Se necesitan al menos 3 puntos" });

      const polygonCoords = parcel.polygonCoordinates as any;
      const polygon = Array.isArray(polygonCoords)
        ? (polygonCoords as [number, number][]).map(([lat, lng]) => [lng, lat])
        : [[0, 0], [0, 0], [0, 0]];

      const geoServiceUrl = process.env.GEO_SERVICE_URL || "http://127.0.0.1:8000";
      const geoResponse = await fetchWithTimeout(`${geoServiceUrl}/variogram-lags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          points: measured.map(p => ({
            lon: Number(p.lonPlanned),
            lat: Number(p.latPlanned),
            value: Number(p.value),
          })),
          method: "kriging",
          polygon,
          resolution: 50,
          n_zones: 3,
        }),
      });

      if (!geoResponse.ok) return res.status(502).json({ message: "Geo-service unavailable" });
      const result = await geoResponse.json();
      const rawLags: any[] = result.lags || [];
      const lags = rawLags.map((l: any) => ({
        h: l.h ?? l.lag ?? 0,
        gamma: l.gamma ?? l.semivariance ?? 0,
        gamma_fit: l.gamma_fit ?? l.fitted ?? undefined,
      }));
      res.json({ ...result, lags });
    } catch (error: any) {
      const isTimeout = error?.name === "AbortError";
      res.status(isTimeout ? 504 : 500).json({
        message: isTimeout
          ? "Geo-service timeout (>45 s): el cálculo del variograma tardó demasiado."
          : "Error al calcular variograma",
      });
    }
  });

  // ── /api/geo/* — Direct proxy routes for the Python geo-service ────────────
  // These expose the FastAPI microservice endpoints under the Express API prefix.

  const GEO_SERVICE_URL = process.env.GEO_SERVICE_URL || "http://127.0.0.1:8000";

  /** GET /api/geo/health — Healthcheck del microservicio Python */
  app.get("/api/geo/health", async (_req, res) => {
    try {
      const r = await fetchWithTimeout(`${GEO_SERVICE_URL}/health`, {}, 5_000);
      const data = await r.json();
      res.status(r.status).json(data);
    } catch {
      res.status(503).json({ status: "unavailable", version: "unknown" });
    }
  });

  /** GET /api/geo-service/health — Proxy ligero al /health del geo-service (timeout 3 s). */
  app.get("/api/geo-service/health", isAuthenticated, async (req, res) => {
    const geoServiceUrl = process.env.GEO_SERVICE_URL || "http://127.0.0.1:8000";
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    try {
      const r = await fetch(`${geoServiceUrl}/health`, { signal: ctrl.signal });
      clearTimeout(timer);
      const body = await r.json().catch(() => ({}));
      res.status(r.ok ? 200 : 503).json(body);
    } catch (err: any) {
      clearTimeout(timer);
      const isTimeout = err?.name === "AbortError";
      res.status(503).json({ status: isTimeout ? "timeout" : "unreachable", message: err.message });
    }
  });

  /** POST /api/geo/sampling-grid — Genera malla de muestreo vía Python */
  app.post("/api/geo/sampling-grid", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const r = await fetchWithTimeout(`${GEO_SERVICE_URL}/grid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body),
      });
      const data = await r.json();
      res.status(r.ok ? 200 : r.status).json(data);
    } catch (err: any) {
      const isTimeout = (err as any)?.name === "AbortError";
      res.status(isTimeout ? 504 : 502).json({ message: isTimeout ? "Geo-service timeout (>45s)" : `Geo-service unreachable: ${err.message}` });
    }
  });

  /**
   * POST /api/geo/interpolate — Interpolación espacial + zonificación.
   *
   * Architectural note: the Python FastAPI service returns the raster image
   * as an inline base64 PNG (`raster_png_b64`). Object Storage upload is
   * intentionally handled here in the Express proxy (not in FastAPI) so that
   * GCS credentials remain in the Node.js runtime and the Python service
   * stays infrastructure-agnostic. The response replaces `raster_png_b64`
   * with a public `raster_url` on successful upload; the base64 payload is
   * preserved as an in-response fallback when Object Storage is unavailable.
   *
   * Canonical consumer contract: always check `raster_url` first, fall back
   * to `raster_png_b64` if present (dev/local environments).
   */
  app.post("/api/geo/interpolate", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const r = await fetchWithTimeout(`${GEO_SERVICE_URL}/interpolate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body),
      });
      if (!r.ok) {
        const err = await r.text();
        return res.status(r.status).json({ message: err });
      }
      const data: any = await r.json();

      // Upload raster PNG to Replit Object Storage and return a public URL.
      // Only remove base64 payload if upload succeeds; otherwise preserve it as fallback.
      if (data.raster_png_b64) {
        let uploadedToStorage = false;
        try {
          const { objectStorageClient } = await import("./replit_integrations/object_storage/objectStorage");
          const publicPaths = (process.env.PUBLIC_OBJECT_SEARCH_PATHS || "").split(",").filter(Boolean);
          if (publicPaths.length > 0) {
            const publicPath = publicPaths[0].trim();
            const pathParts = publicPath.replace(/^\//, "").split("/");
            const bucketName = pathParts[0];
            const prefix = pathParts.slice(1).join("/");
            const objectName = `${prefix ? prefix + "/" : ""}geo-rasters/${Date.now()}.png`;
            const buf = Buffer.from(data.raster_png_b64, "base64");
            const file = objectStorageClient.bucket(bucketName).file(objectName);
            await file.save(buf, { contentType: "image/png" });
            await file.makePublic();
            data.raster_url = `https://storage.googleapis.com/${bucketName}/${objectName}`;
            uploadedToStorage = true;
          }
        } catch (storageErr: any) {
          // Object Storage unavailable — keep base64 as fallback, don't fail
          console.warn("Raster PNG Object Storage upload failed:", storageErr.message);
        }
        // Only strip the base64 payload from the response when it was successfully stored
        if (uploadedToStorage) {
          delete data.raster_png_b64;
        }
      }

      res.json(data);
    } catch (err: any) {
      const isTimeout = (err as any)?.name === "AbortError";
      res.status(isTimeout ? 504 : 502).json({
        message: isTimeout
          ? "Geo-service timeout (>45 s): la interpolación tardó demasiado. Intenta reducir la resolución o usar IDW."
          : `Geo-service unreachable: ${err.message}`,
      });
    }
  });

  /** POST /api/geo/zonify — Re-zonificación de resultado de interpolación existente */
  app.post("/api/geo/zonify", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const r = await fetchWithTimeout(`${GEO_SERVICE_URL}/zonify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body),
      });
      const data = await r.json();
      res.status(r.ok ? 200 : r.status).json(data);
    } catch (err: any) {
      const isTimeout = (err as any)?.name === "AbortError";
      res.status(isTimeout ? 504 : 502).json({ message: isTimeout ? "Geo-service timeout (>45s)" : `Geo-service unreachable: ${err.message}` });
    }
  });

  /** POST /api/geo/sample-size — Cálculo de tamaño de muestra óptimo */
  app.post("/api/geo/sample-size", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const r = await fetchWithTimeout(`${GEO_SERVICE_URL}/sample-size`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body),
      });
      const data = await r.json();
      res.status(r.ok ? 200 : r.status).json(data);
    } catch (err: any) {
      const isTimeout = (err as any)?.name === "AbortError";
      res.status(isTimeout ? 504 : 502).json({ message: isTimeout ? "Geo-service timeout (>45s)" : `Geo-service unreachable: ${err.message}` });
    }
  });

  // ── F3-06: VRA prescription proxy routes ─────────────────────────────────

  // GET /api/geo/prescription/catalog — crop + product data tables
  app.get("/api/geo/prescription/catalog", isAuthenticated, async (_req, res) => {
    try {
      const r = await fetchWithTimeout(`${GEO_SERVICE_URL}/prescription/catalog`, { method: "GET" });
      const data = await r.json();
      res.status(r.ok ? 200 : r.status).json(data);
    } catch (err: any) {
      const isTimeout = err?.name === "AbortError";
      res.status(isTimeout ? 504 : 502).json({ message: isTimeout ? "Geo-service timeout" : `Geo-service no disponible: ${err.message}` });
    }
  });

  // POST /api/geo/prescription — compute agronomic balance doses for zones
  app.post("/api/geo/prescription", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const r = await fetchWithTimeout(`${GEO_SERVICE_URL}/prescription`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body),
      }, 60_000);
      const data = await r.json();
      res.status(r.ok ? 200 : r.status).json(data);
    } catch (err: any) {
      const isTimeout = err?.name === "AbortError";
      res.status(isTimeout ? 504 : 502).json({ message: isTimeout ? "Geo-service timeout (>60s)" : `Geo-service no disponible: ${err.message}` });
    }
  });

  // POST /api/geo/prescription-export — compute + export Shapefile ZIP or GeoJSON
  app.post("/api/geo/prescription-export", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const r = await fetchWithTimeout(`${GEO_SERVICE_URL}/prescription-export-shp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body),
      }, 90_000);

      if (!r.ok) {
        const errText = await r.text().catch(() => "");
        return res.status(r.status).json({ message: `Error en exportación: ${errText}` });
      }

      const contentType = r.headers.get("content-type") ?? "application/octet-stream";
      const disposition = r.headers.get("content-disposition") ?? 'attachment; filename="prescription_vra.zip"';
      const exportWarning = r.headers.get("x-export-warning");

      const buf = Buffer.from(await r.arrayBuffer());
      const headers: Record<string, string> = {
        "Content-Type": contentType,
        "Content-Disposition": disposition,
        "Content-Length": String(buf.length),
      };
      if (exportWarning) headers["X-Export-Warning"] = exportWarning;
      res.set(headers).send(buf);
    } catch (err: any) {
      const isTimeout = err?.name === "AbortError";
      res.status(isTimeout ? 504 : 502).json({ message: isTimeout ? "Geo-service timeout (>90s)" : `Geo-service no disponible: ${err.message}` });
    }
  });

  // ── T176: Setup Progress ────────────────────────────────────────────────
  app.get("/api/parcels/:id/setup-progress", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
      const user = req.user as User;
      if (parcel.userId !== user.id && user.role !== "admin") return res.status(403).json({ message: "Sin permiso" });
      const [progress, soilBioList, tissueList, waterList] = await Promise.all([
        storage.getParcelSetupProgress(req.params.id),
        storage.getSoilBiologyByParcel(req.params.id),
        storage.getPlantTissueAnalysisByParcel(req.params.id),
        storage.getWaterAnalysisByParcel(req.params.id),
      ]);
      res.json({
        progress: progress || null,
        stepCycle:      progress?.stepCycle     ?? false,
        stepSoil:       progress?.stepSoil      ?? false,
        stepEconomy:    progress?.stepEconomy   ?? false,
        stepPractices:  progress?.stepPractices ?? false,
        stepSoilBio:    soilBioList.length > 0,
        stepTissue:     tissueList.length > 0,
        stepWater:      waterList.length > 0,
      });
    } catch (error) {
      res.status(500).json({ message: "Error al obtener progreso" });
    }
  });

  app.put("/api/parcels/:id/setup-progress", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
      const user = req.user as User;
      if (parcel.userId !== user.id && user.role !== "admin") return res.status(403).json({ message: "Sin permiso" });
      const { stepCycle, stepSoil, stepEconomy, stepPractices } = req.body;
      const progress = await storage.upsertParcelSetupProgress(req.params.id, {
        stepCycle: stepCycle ?? undefined,
        stepSoil: stepSoil ?? undefined,
        stepEconomy: stepEconomy ?? undefined,
        stepPractices: stepPractices ?? undefined,
      });
      res.json({ progress });
    } catch (error) {
      res.status(500).json({ message: "Error al actualizar progreso" });
    }
  });

  // ── T176: Crop Cycle Detail ──────────────────────────────────────────────
  app.get("/api/parcels/:id/cycle-detail", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
      const user = req.user as User;
      if (parcel.userId !== user.id && !parcel.isPublic && user.role !== "admin") return res.status(403).json({ message: "Sin permiso" });
      const details = await storage.getCropCycleDetails(req.params.id);
      const latest = details[0] || null;
      res.json({ details, latest });
    } catch (error) {
      res.status(500).json({ message: "Error al obtener detalle de ciclo" });
    }
  });

  app.post("/api/parcels/:id/cycle-detail", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
      const user = req.user as User;
      if (parcel.userId !== user.id && user.role !== "admin") return res.status(403).json({ message: "Sin permiso" });
      const parsed = insertCropCycleDetailSchema.safeParse({ ...req.body, parcelId: req.params.id });
      if (!parsed.success) return res.status(400).json({ message: "Datos inválidos", errors: parsed.error.issues });
      // Always create a new record so multiple cycles accumulate as history
      const record = await storage.createCropCycleDetail(parsed.data);
      // Re-generate phenology prompts whenever cycleDurationDays is provided and the
      // parcel has both a crop and a planting date — dates are rescaled to the new duration.
      if (parsed.data.cycleDurationDays && parcel.crop && parcel.plantingDate) {
        autoGeneratePhenologyPrompts(
          storage,
          req.params.id,
          parcel.crop,
          new Date(parcel.plantingDate),
          parsed.data.cycleDurationDays
        ).catch(e => console.error("Prompt regen on cycle-detail (non-fatal):", e));
      }
      res.status(201).json({ record });
    } catch (error) {
      res.status(500).json({ message: "Error al crear detalle de ciclo" });
    }
  });

  app.put("/api/cycle-detail/:id", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const user = req.user as User;
      const existing = await storage.getCropCycleDetailById(req.params.id);
      if (!existing) return res.status(404).json({ message: "Registro no encontrado" });
      const parcel = await storage.getParcel(existing.parcelId);
      if (!parcel || (parcel.userId !== user.id && user.role !== "admin")) {
        return res.status(403).json({ message: "Sin permiso" });
      }
      // Whitelist editable fields — never allow parcelId, id, or ownership columns
      const {
        cycleYear, cycleSeason, variety, density, cycleDurationDays, estimatedHarvestDate,
        expectedYieldTon, targetPricePerTon, actualYieldTon, actualPricePerTon,
        totalPlannedCost, saleChannel, financingType, practicesJson, notes,
      } = req.body;
      const safeUpdate = {
        ...(cycleYear !== undefined && { cycleYear }),
        ...(cycleSeason !== undefined && { cycleSeason }),
        ...(variety !== undefined && { variety }),
        ...(density !== undefined && { density }),
        ...(cycleDurationDays !== undefined && { cycleDurationDays }),
        ...(estimatedHarvestDate !== undefined && { estimatedHarvestDate }),
        ...(expectedYieldTon !== undefined && { expectedYieldTon }),
        ...(targetPricePerTon !== undefined && { targetPricePerTon }),
        ...(actualYieldTon !== undefined && { actualYieldTon }),
        ...(actualPricePerTon !== undefined && { actualPricePerTon }),
        ...(totalPlannedCost !== undefined && { totalPlannedCost }),
        ...(saleChannel !== undefined && { saleChannel }),
        ...(financingType !== undefined && { financingType }),
        ...(practicesJson !== undefined && { practicesJson }),
        ...(notes !== undefined && { notes }),
      };
      const updated = await storage.updateCropCycleDetail(req.params.id, safeUpdate);
      res.json({ record: updated });
    } catch (error) {
      res.status(500).json({ message: "Error al actualizar detalle de ciclo" });
    }
  });

  // PATCH by parcel-scoped cycleId — used by the wizard when editing an existing cycle
  app.patch("/api/parcels/:id/cycle-detail/:cycleId", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const user = req.user as User;
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
      if (parcel.userId !== user.id && user.role !== "admin") return res.status(403).json({ message: "Sin permiso" });
      const existing = await storage.getCropCycleDetailById(req.params.cycleId);
      if (!existing || existing.parcelId !== req.params.id) return res.status(404).json({ message: "Ciclo no encontrado" });
      // Whitelist editable fields — never allow parcelId, id, or other ownership columns
      const {
        cycleYear, cycleSeason, variety, density, cycleDurationDays, estimatedHarvestDate,
        expectedYieldTon, targetPricePerTon, actualYieldTon, actualPricePerTon,
        totalPlannedCost, saleChannel, financingType, practicesJson, notes,
      } = req.body;
      const safeUpdate = {
        ...(cycleYear !== undefined && { cycleYear }),
        ...(cycleSeason !== undefined && { cycleSeason }),
        ...(variety !== undefined && { variety }),
        ...(density !== undefined && { density }),
        ...(cycleDurationDays !== undefined && { cycleDurationDays }),
        ...(estimatedHarvestDate !== undefined && { estimatedHarvestDate }),
        ...(expectedYieldTon !== undefined && { expectedYieldTon }),
        ...(targetPricePerTon !== undefined && { targetPricePerTon }),
        ...(actualYieldTon !== undefined && { actualYieldTon }),
        ...(actualPricePerTon !== undefined && { actualPricePerTon }),
        ...(totalPlannedCost !== undefined && { totalPlannedCost }),
        ...(saleChannel !== undefined && { saleChannel }),
        ...(financingType !== undefined && { financingType }),
        ...(practicesJson !== undefined && { practicesJson }),
        ...(notes !== undefined && { notes }),
      };
      const updated = await storage.updateCropCycleDetail(req.params.cycleId, safeUpdate);
      if (updated?.cycleDurationDays && parcel.crop && parcel.plantingDate) {
        autoGeneratePhenologyPrompts(
          storage,
          req.params.id,
          parcel.crop,
          new Date(parcel.plantingDate),
          updated.cycleDurationDays
        ).catch(e => console.error("Prompt regen on cycle PATCH (non-fatal):", e));
      }
      res.json({ record: updated });
    } catch (error) {
      res.status(500).json({ message: "Error al actualizar ciclo" });
    }
  });

  // ── T176: Phenology Prompts ──────────────────────────────────────────────
  app.get("/api/parcels/:id/phenology-prompts", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
      const user = req.user as User;
      if (parcel.userId !== user.id && user.role !== "admin") return res.status(403).json({ message: "Sin permiso" });
      const prompts = await storage.getPhenologyPrompts(req.params.id);
      res.json({ prompts });
    } catch (error) {
      res.status(500).json({ message: "Error al obtener prompts fenológicos" });
    }
  });

  app.post("/api/parcels/:id/phenology-prompts", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
      const user = req.user as User;
      if (parcel.userId !== user.id && user.role !== "admin") return res.status(403).json({ message: "Sin permiso" });
      const parsed = insertPhenologyPromptSchema.safeParse({ ...req.body, parcelId: req.params.id });
      if (!parsed.success) return res.status(400).json({ message: "Datos inválidos", errors: parsed.error.issues });
      const prompt = await storage.createPhenologyPrompt(parsed.data);
      res.status(201).json({ prompt });
    } catch (error) {
      res.status(500).json({ message: "Error al crear prompt" });
    }
  });

  // POST /api/parcels/:id/prompts/:promptId/complete
  app.post("/api/parcels/:id/prompts/:promptId/complete", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const user = req.user as User;
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
      if (parcel.userId !== user.id && user.role !== "admin") return res.status(403).json({ message: "Sin permiso" });
      const existing = await storage.getPhenologyPromptById(req.params.promptId);
      if (!existing || existing.parcelId !== req.params.id) return res.status(404).json({ message: "Prompt no encontrado" });
      const updated = await storage.completePhenologyPrompt(req.params.promptId);
      res.json({ prompt: updated });
    } catch (error) {
      res.status(500).json({ message: "Error al completar prompt" });
    }
  });

  // POST /api/parcels/:id/phenology-prompts/generate — manual trigger (uses module-level helper)
  app.post("/api/parcels/:id/phenology-prompts/generate", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const user = req.user as User;
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
      if (parcel.userId !== user.id && user.role !== "admin") return res.status(403).json({ message: "Sin permiso" });
      if (!parcel.plantingDate || !parcel.crop) {
        return res.status(400).json({ message: "La parcela debe tener cultivo y fecha de siembra para generar prompts" });
      }
      const before = await storage.getPhenologyPrompts(req.params.id);
      const beforeStages = new Set((before || []).map((p: any) => p.stage));
      await autoGeneratePhenologyPrompts(storage, req.params.id, parcel.crop, new Date(parcel.plantingDate));
      const after = await storage.getPhenologyPrompts(req.params.id);
      const created = (after || []).filter((p: any) => !beforeStages.has(p.stage));
      res.status(201).json({ prompts: created, message: `${created.length} prompts generados para ${parcel.crop}` });
    } catch (error) {
      console.error("Error generating phenology prompts:", error);
      res.status(500).json({ message: "Error al generar prompts fenológicos" });
    }
  });

  // ── T250: Stage Observations ─────────────────────────────────────────────
  app.get("/api/parcels/:id/stage-observations", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const user = req.user as User;
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
      if (parcel.userId !== user.id && !parcel.isPublic && user.role !== "admin") return res.status(403).json({ message: "Sin permiso" });
      const observations = await storage.getStageObservationsByParcel(req.params.id);
      // Group by stage when ?grouped=true (default), return flat list when ?grouped=false
      const grouped = req.query.grouped !== "false";
      if (grouped) {
        const byStage: Record<string, typeof observations> = {};
        for (const obs of observations) {
          if (!byStage[obs.stage]) byStage[obs.stage] = [];
          byStage[obs.stage].push(obs);
        }
        return res.json({ grouped: true, stages: byStage, total: observations.length });
      }
      res.json(observations);
    } catch (error) {
      console.error("Error getting stage observations:", error);
      res.status(500).json({ message: "Error al obtener observaciones" });
    }
  });

  app.post("/api/parcels/:id/stage-observations", isAuthenticated, isActiveUser, uploadImage.single("photo"), async (req, res) => {
    try {
      const user = req.user as User;
      const parcel = await storage.getParcel(String(req.params.id));
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
      if (parcel.userId !== user.id && user.role !== "admin") return res.status(403).json({ message: "Sin permiso" });

      let photoUrl: string | null = null;
      if (req.file) {
        const ext = path.extname(req.file.originalname).replace(/[^a-zA-Z0-9.]/g, "") || ".jpg";
        const fileName = `stage-observations/${req.params.id}/${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
        photoUrl = await uploadToPublicStorage(req.file.buffer, req.file.mimetype, fileName);
      }

      const body = {
        ...req.body,
        parcelId: req.params.id,
        ...(photoUrl ? { photoUrl } : {}),
      };

      const parsed = insertParcelStageObservationSchema.safeParse(body);
      if (!parsed.success) return res.status(400).json({ message: "Datos inválidos", errors: parsed.error.errors });

      const observation = await storage.createStageObservation(parsed.data);
      res.status(201).json(observation);
    } catch (error) {
      console.error("Error creating stage observation:", error);
      res.status(500).json({ message: "Error al guardar observación" });
    }
  });

  app.delete("/api/parcels/:id/stage-observations/:obsId", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const user = req.user as User;
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
      if (parcel.userId !== user.id && user.role !== "admin") return res.status(403).json({ message: "Sin permiso" });
      const ok = await storage.deleteStageObservation(req.params.obsId, req.params.id);
      if (!ok) return res.status(404).json({ message: "Observación no encontrada" });
      res.json({ message: "Observación eliminada" });
    } catch (error) {
      console.error("Error deleting stage observation:", error);
      res.status(500).json({ message: "Error al eliminar observación" });
    }
  });

  // ── T176: Profitability KPIs ─────────────────────────────────────────────
  app.get("/api/parcels/:id/profitability", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
      const user = req.user as User;
      if (parcel.userId !== user.id && !parcel.isPublic && user.role !== "admin") return res.status(403).json({ message: "Sin permiso" });

      const [manualCosts, cycleDetail, ledgerEntries] = await Promise.all([
        storage.getProductionCostsByParcel(req.params.id),
        storage.getLatestCropCycleDetail(req.params.id),
        storage.getActiveFieldLogs(parcel.userId, parcel.id),
      ]);
      const costs = projectParcelCosts(manualCosts, ledgerEntries, cycleDetail).filter(c => c.currency === "MXN");

      const parcelArea = parseFloat(parcel.area || "1") || 1;
      // Deterministic cycle scoping: use cycleDetail's year+season when available,
      // otherwise fall back to current calendar year. Never use a "costs.length <= 5"
      // heuristic — that silently drops costs once a parcel has more than 5 rows.
      const targetYear = cycleDetail?.cycleYear ?? new Date().getFullYear();
      const targetSeason = cycleDetail?.cycleSeason ?? null;
      const yearCosts = costs.filter(c => {
        if (c.cycleYear !== targetYear) return false;
        if (targetSeason && c.cycleSeason && c.cycleSeason !== targetSeason) return false;
        return true;
      });
      // production_costs.totalCost stores the TOTAL cost for the whole field (not per-ha).
      // Divide by area to get the per-ha figure used in costPerTon / breakEvenTon formulas.
      const totalCost = yearCosts.reduce((s, c) => s + parseFloat(String(c.totalCost) || "0"), 0);
      const totalCostPerHa = parcelArea > 0 ? totalCost / parcelArea : 0;

      let grossMargin: number | null = null;
      let costPerTon: number | null = null;
      let roi: number | null = null;
      let breakEvenTon: number | null = null;
      let projectedRevenue: number | null = null;

      // ── Auto-estimate fields (SNIIM + SIAP when no manual cycle config) ──
      let autoEstimate = false;
      let sniimPrice: number | null = null;
      let sniimDate: string | null = null;
      let siapBenchmarkTonHa: number | null = null;
      let siapCycle: string | null = null;
      let siapSource: string = "Nacional";

      if (cycleDetail) {
        const yield_tn = parseFloat(String(cycleDetail.expectedYieldTon) || "0");
        const price = parseFloat(String(cycleDetail.targetPricePerTon) || "0");
        if (yield_tn > 0 && price > 0) {
          projectedRevenue = yield_tn * price * parcelArea;
          grossMargin = projectedRevenue - totalCost;
          costPerTon = yield_tn > 0 ? totalCostPerHa / yield_tn : null;
          roi = totalCost > 0 ? ((grossMargin / totalCost) * 100) : null;
          breakEvenTon = price > 0 ? totalCostPerHa / price : null;
        }
      }

      // ── Auto-estimate: SNIIM price × SIAP benchmark when no manual config ─
      if (grossMargin == null && parcel.crop) {
        try {
          let stateRaw: string | null = inferStateFromText(parcel.location ?? "");
          if (!stateRaw) {
            const owner = await storage.getUser(parcel.userId);
            stateRaw = owner?.state ? (inferStateFromText(owner.state) ?? owner.state) : null;
          }
          const { normalizeCycle } = await import("./services/siap");
          const cycle = normalizeCycle(cycleDetail?.cycleSeason ?? null);
          const [benchmark, marketData] = await Promise.all([
            Promise.resolve(getSIAPYieldBenchmark(parcel.crop, stateRaw, cycle, null)),
            getMarketPrices(parcel.crop, stateRaw ?? ""),
          ]);
          const benchmarkYield = benchmark.stateAvg ?? benchmark.nationalAvg;
          const marketPrice = marketData.sniim?.price ?? null;
          if (benchmarkYield != null && marketPrice != null) {
            autoEstimate = true;
            sniimPrice = marketPrice;
            sniimDate = marketData.sniim?.date ?? null;
            siapBenchmarkTonHa = benchmarkYield;
            siapCycle = cycle;
            siapSource = benchmark.stateAvg != null ? (stateRaw ?? "Nacional") : "Nacional";
            const estimatedRevenue = marketPrice * benchmarkYield * parcelArea;
            grossMargin = estimatedRevenue - totalCost;
            costPerTon = benchmarkYield > 0 ? totalCostPerHa / benchmarkYield : null;
            roi = totalCost > 0 ? ((grossMargin / totalCost) * 100) : null;
            breakEvenTon = marketPrice > 0 ? totalCostPerHa / marketPrice : null;
            projectedRevenue = estimatedRevenue;
          }
        } catch (_e) {
          // Auto-estimate failed — leave KPIs as null, no crash
        }
      }

      const estimatedGrossMarginPerHa = grossMargin != null && parcelArea > 0 ? grossMargin / parcelArea : null;
      const estimatedRoiPct = roi;
      const estimatedBreakEvenTonHa = breakEvenTon;

      res.json({
        totalCostPerHa,
        totalCost,
        projectedRevenue,
        grossMargin,
        costPerTon,
        roi,
        breakEvenTon,
        parcelArea,
        cycleDetail: cycleDetail || null,
        costBreakdown: yearCosts.map(c => ({ category: c.category, totalCost: parseFloat(String(c.totalCost)) })),
        autoEstimate,
        sniimPrice,
        sniimDate,
        siapBenchmarkTonHa,
        siapCycle,
        siapSource,
        estimatedGrossMarginPerHa,
        estimatedRoiPct,
        estimatedBreakEvenTonHa,
      });
    } catch (error) {
      console.error("Error calculating profitability:", error);
      res.status(500).json({ message: "Error al calcular rentabilidad" });
    }
  });

  // ── Market prices: SNIIM (local grain prices) + exchange rate (USD/MXN) ────
  // Contract: GET /api/market/prices?crop=maiz&state=jalisco
  // Returns flat: { price, currency, plaza, date, usdMxn, crop, state, supported }
  app.get("/api/market/prices", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const crop = (req.query.crop as string | undefined) || "";
      const state = (req.query.state as string | undefined) || "";

      if (!crop) {
        return res.status(400).json({ message: "Parámetro 'crop' requerido" });
      }

      const result = await getMarketPriceFlat(crop, state);
      res.json(result);
    } catch (error) {
      console.error("Error fetching market prices:", error);
      res.status(500).json({ message: "Error al obtener precios de mercado" });
    }
  });

  // Convenience: parcel-specific market prices — resolves crop from parcel, state from owner profile
  app.get("/api/parcels/:id/market-prices", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });

      const requestingUser = req.user as User;
      if (parcel.userId !== requestingUser.id && !parcel.isPublic && requestingUser.role !== "admin") {
        return res.status(403).json({ message: "Sin permiso" });
      }

      const crop = parcel.crop || "";

      // Resolve state from parcel owner's profile (users.state is a free-text state name)
      let ownerState = "";
      try {
        const owner = await storage.getUser(parcel.userId);
        ownerState = owner?.state || "";
      } catch {
        // silently ignore — proceed with empty state (SNIIM will return national average)
      }

      const [flat, fullResult] = await Promise.all([
        getMarketPriceFlat(crop, ownerState),
        getMarketPrices(crop, ownerState),
      ]);

      res.json({
        // Flat fields for compatibility with GET /api/market/prices contract
        ...flat,
        // Additional enriched fields for the parcel widget
        sniim: fullResult.sniim,
        exchange: fullResult.exchange,
        parcelCrop: crop,
        parcelState: ownerState,
        supportedCrops: SUPPORTED_SNIIM_CROPS,
        cachedAt: fullResult.cachedAt,
      });
    } catch (error) {
      console.error("Error fetching parcel market prices:", error);
      res.status(500).json({ message: "Error al obtener precios de mercado" });
    }
  });

  // ── International commodity benchmarks (World Bank + CME/CBOT) ───────────
  // Contract: GET /api/market/fertilizers
  // Returns FAOFertilizerPrice[] for Urea, DAP, MAP, KCl.
  // Data from FAOSTAT PP dataset; falls back to embedded 2025 reference prices.
  // Cached 7 days server-side.
  app.get("/api/market/fertilizers", isAuthenticated, isActiveUser, async (_req, res) => {
    try {
      const prices = await getFAOFertilizerPrices();
      res.json(prices);
    } catch (error) {
      console.error("Error fetching FAO fertilizer prices:", error);
      res.status(500).json({ message: "Error al obtener precios de fertilizantes" });
    }
  });

  // Contract: GET /api/market/international?crop=maiz
  // Returns {
  //   benchmarks: CommodityBenchmark[],   // all three covered crops
  //   worldBankPrice, cmeFuturePrice, unit, date,  // flat fields for the queried crop
  //   supportedCrops, fetchedAt
  // }
  app.get("/api/market/international", isAuthenticated, isActiveUser, async (req, res) => {
    try {
      const crop = (req.query.crop as string | undefined) || "";
      const result = await getInternationalPrices(crop || undefined);

      // Build flat fields for the specific crop queried (first benchmark when crop is provided)
      const matched = crop ? result.benchmarks[0] : null;
      const flatFields = matched
        ? {
            worldBankPrice: matched.worldBankPrice,
            cmeFuturePrice: matched.cmeFuturePrice,
            unit: matched.unit,
            date: matched.cmeFutureDate ?? matched.worldBankDate ?? null,
            worldBankSource: matched.worldBankSource,
            cmeFutureSource: matched.cmeFutureSource,
          }
        : {};

      res.json({ ...result, ...flatFields, supportedCrops: INTERNATIONAL_CROPS });
    } catch (error) {
      console.error("Error fetching international prices:", error);
      res.status(500).json({ message: "Error al obtener precios internacionales" });
    }
  });
}

// ── Proactive AI Alert helpers ────────────────────────────────────────────

/**
 * Canonical wrapper for all parcel data inserts.
 * Persists the new record and asynchronously checks for an NDVI drop alert.
 * All code that creates ParcelData should call this instead of storage.createParcelData directly.
 */
async function saveParcelDataWithAlertCheck(data: InsertParcelData): Promise<ParcelData> {
  const saved = await storage.createParcelData(data);
  if (data.ndvi != null) {
    triggerNdviAlertIfNeeded(data.parcelId, Number(data.ndvi)).catch(() => {});
  }
  return saved;
}

/**
 * Called asynchronously after saving new parcel data.
 * Checks for a meaningful NDVI drop (≥10%) and creates an AI-generated alert.
 */
async function triggerNdviAlertIfNeeded(
  parcelId: string,
  newNdvi: number | null | undefined
): Promise<void> {
  if (newNdvi == null) return;
  try {
    const parcel = await storage.getParcel(parcelId);
    if (!parcel) return;
    const recentData = await storage.getParcelData(parcelId, 5);
    const previousNdvi = recentData.length >= 2 ? recentData[1]?.ndvi : null;
    const prevNdvi = previousNdvi == null ? null : Number(previousNdvi);
    if (prevNdvi == null || prevNdvi <= 0) return;
    const dropPct = Math.round(((prevNdvi - newNdvi) / prevNdvi) * 100);
    if (dropPct < 10) return;
    const crop = parcel.crop || "cultivo desconocido";
    const loc = `${parcel.latitude ?? ""}, ${parcel.longitude ?? ""}`;
    const frequencyHours = parcel.proactiveAlertFrequencyHours ?? 24;
    const existing = await storage.getRecentProactiveAlert(parcelId, "ndvi_drop", frequencyHours);
    if (existing) return;
    const aiResult = await generateProactiveAlert(
      parcel.name, crop, loc, "ndvi_drop",
      { prevNdvi: prevNdvi.toFixed(3), newNdvi: newNdvi.toFixed(3), dropPct }
    );
    if (!aiResult) return;
    await storage.createAlert({
      parcelId,
      severity: aiResult.severity,
      title: aiResult.title,
      description: aiResult.description,
      type: "ai_proactive",
      actionStatus: null,
      reasoningBullets: aiResult.reasoningBullets,
      eventType: "ndvi_drop",
      isRead: false,
    });
    console.log(`[ProactiveAlert] NDVI drop alert created for parcel ${parcelId} (${dropPct}% drop, freq=${frequencyHours}h)`);
  } catch (err) {
    console.error("[ProactiveAlert] triggerNdviAlertIfNeeded error:", err);
  }
}

async function runClimateAlertCron(): Promise<void> {
  console.log("[ProactiveAlertCron] Starting climate alert sweep...");
  try {
    const allParcels = (await storage.getAllParcels()).filter(p => p.status !== "inactive");
    let created = 0;
    for (const parcel of allParcels) {
      const lat = Number(parcel.latitude);
      const lng = Number(parcel.longitude);
      if (!lat || !lng) continue;
      try {
        const forecast = await getWeatherForecast(lat, lng);
        if (!forecast || forecast.length === 0) continue;
        const crop = parcel.crop || "cultivo";
        const loc = `${lat}, ${lng}`;
        const freq = parcel.proactiveAlertFrequencyHours ?? 24;
        const frostDay = forecast.slice(0, 3).find(d => d.tempMin != null && d.tempMin <= 2);
        if (frostDay) {
          const existing = await storage.getRecentProactiveAlert(parcel.id, "frost", freq);
          if (!existing) {
            const ai = await generateProactiveAlert(parcel.name, crop, loc, "frost", { tempMin: frostDay.tempMin });
            if (ai) { await storage.createAlert({ parcelId: parcel.id, severity: ai.severity, title: ai.title, description: ai.description, type: "ai_proactive", actionStatus: null, reasoningBullets: ai.reasoningBullets, eventType: "frost", isRead: false }); created++; }
          }
        }
        const totalRain = forecast.slice(0, 7).reduce((s, d) => s + (d.precipitation || 0), 0);
        const avgTempMax = forecast.slice(0, 7).reduce((s, d) => s + (d.tempMax || 0), 0) / 7;
        if (totalRain < 5 && avgTempMax > 32) {
          const existing = await storage.getRecentProactiveAlert(parcel.id, "drought", freq);
          if (!existing) {
            const ai = await generateProactiveAlert(parcel.name, crop, loc, "drought", { precipitation: totalRain.toFixed(1), tempMax: avgTempMax.toFixed(1) });
            if (ai) { await storage.createAlert({ parcelId: parcel.id, severity: ai.severity, title: ai.title, description: ai.description, type: "ai_proactive", actionStatus: null, reasoningBullets: ai.reasoningBullets, eventType: "drought", isRead: false }); created++; }
          }
        }
        const rain3d = forecast.slice(0, 3).reduce((s, d) => s + (d.precipitation || 0), 0);
        if (rain3d > 80) {
          const existing = await storage.getRecentProactiveAlert(parcel.id, "excess_water", freq);
          if (!existing) {
            const ai = await generateProactiveAlert(parcel.name, crop, loc, "excess_water", { precipitation: rain3d.toFixed(1) });
            if (ai) { await storage.createAlert({ parcelId: parcel.id, severity: ai.severity, title: ai.title, description: ai.description, type: "ai_proactive", actionStatus: null, reasoningBullets: ai.reasoningBullets, eventType: "excess_water", isRead: false }); created++; }
          }
        }
      } catch (parcelErr) {
        console.warn(`[ProactiveAlertCron] Skipped parcel ${parcel.id}:`, parcelErr);
      }
    }
    console.log(`[ProactiveAlertCron] Done — ${created} new alerts created.`);
  } catch (err) {
    console.error("[ProactiveAlertCron] Sweep failed:", err);
  }
}


// ─── Seed Master Variables ───────────────────────────────────────────────────

async function seedMasterVariables() {
  const defaultVariables = [
    // Core soil chemical properties (task spec: pH, CE, MO, N, P, K, Ca, Mg)
    { code: "ph", name: "pH del suelo", unit: "pH", minValue: "3.5", maxValue: "10.0", optimalMin: "6.0", optimalMax: "7.5", defaultCv: "8.0", description: "Acidez o alcalinidad del suelo", protocol: "Método potenciométrico (relación suelo:agua 1:2.5)" },
    { code: "ce", name: "Conductividad Eléctrica", unit: "dS/m", minValue: "0.1", maxValue: "20.0", optimalMin: "0.1", optimalMax: "2.0", defaultCv: "50.0", description: "Salinidad del suelo", protocol: "Medición en extracto de pasta saturada" },
    { code: "mo", name: "Materia Orgánica", unit: "%", minValue: "0.1", maxValue: "15.0", optimalMin: "3.0", optimalMax: "6.0", defaultCv: "25.0", description: "Contenido de materia orgánica del suelo", protocol: "Walkley-Black" },
    { code: "n", name: "Nitrógeno Total", unit: "mg/kg", minValue: "10", maxValue: "5000", optimalMin: "800", optimalMax: "2000", defaultCv: "30.0", description: "Nitrógeno total en suelo", protocol: "Kjeldahl" },
    { code: "p", name: "Fósforo Disponible", unit: "mg/kg", minValue: "1", maxValue: "200", optimalMin: "15", optimalMax: "50", defaultCv: "40.0", description: "Fósforo extractable (Olsen o Bray-1)", protocol: "Olsen (suelos alcalinos) o Bray-1 (suelos ácidos)" },
    { code: "k", name: "Potasio Intercambiable", unit: "cmol/kg", minValue: "0.1", maxValue: "5.0", optimalMin: "0.3", optimalMax: "0.8", defaultCv: "35.0", description: "Potasio intercambiable", protocol: "Extracción con acetato de amonio 1N, pH 7" },
    { code: "ca", name: "Calcio Intercambiable", unit: "cmol/kg", minValue: "0.5", maxValue: "40.0", optimalMin: "8.0", optimalMax: "20.0", defaultCv: "30.0", description: "Calcio intercambiable en el suelo", protocol: "Extracción con acetato de amonio 1N, pH 7, absorción atómica" },
    { code: "mg", name: "Magnesio Intercambiable", unit: "cmol/kg", minValue: "0.1", maxValue: "15.0", optimalMin: "1.5", optimalMax: "5.0", defaultCv: "35.0", description: "Magnesio intercambiable en el suelo", protocol: "Extracción con acetato de amonio 1N, pH 7, absorción atómica" },
    // Physical properties (task spec: HG, RP, CLAY)
    { code: "hg", name: "Conductividad Hidráulica", unit: "mm/h", minValue: "0.1", maxValue: "500.0", optimalMin: "10.0", optimalMax: "50.0", defaultCv: "60.0", description: "Conductividad hidráulica saturada del suelo (Hydraulic conductivity)", protocol: "Permeámetro de disco Guelph o cilindros concéntricos en campo" },
    { code: "rp", name: "Resistencia a la Penetración", unit: "MPa", minValue: "0.1", maxValue: "6.0", optimalMin: "0.1", optimalMax: "2.0", defaultCv: "45.0", description: "Compactación del suelo (Resistance Penetration). Valores >2 MPa limitan el crecimiento radicular", protocol: "Penetrómetro de cono ASABE S313.3, en suelo a capacidad de campo" },
    { code: "clay", name: "Arcilla", unit: "%", minValue: "0", maxValue: "100", optimalMin: "15", optimalMax: "40", defaultCv: "20.0", description: "Fracción arcilla del suelo (<0.002 mm). Afecta retención de agua, CIC y labranza", protocol: "Método de Bouyoucos (hidrómetro) o pipeta; previa oxidación de MO" },
    // Micronutrient (task spec: Zn)
    { code: "zn", name: "Zinc Disponible", unit: "mg/kg", minValue: "0.1", maxValue: "30.0", optimalMin: "1.0", optimalMax: "6.0", defaultCv: "55.0", description: "Zinc disponible para las plantas. Deficiencia común en suelos calcáreos y pH>7", protocol: "DTPA-TEA (Lindsay & Norvell) en suelos neutros a alcalinos; espectrofotometría de absorción atómica" },
    // Supplementary precision ag variables (kept from previous version)
    { code: "ndvi", name: "NDVI (Dron)", unit: "índice", minValue: "0.0", maxValue: "1.0", optimalMin: "0.5", optimalMax: "0.9", defaultCv: "15.0", description: "Índice de vegetación de diferencia normalizada por dron", protocol: "Cámara multiespectral, Vuelo a 60-120m" },
    { code: "hum_suelo", name: "Humedad del Suelo", unit: "%", minValue: "0", maxValue: "100", optimalMin: "40", optimalMax: "70", defaultCv: "20.0", description: "Contenido volumétrico de agua en suelo", protocol: "Sensor TDR o FDR, o método gravimétrico" },
    { code: "temp_suelo", name: "Temperatura del Suelo", unit: "°C", minValue: "5", maxValue: "50", optimalMin: "18", optimalMax: "28", defaultCv: "10.0", description: "Temperatura del suelo a 10 cm de profundidad", protocol: "Termómetro digital de suelo" },
    { code: "rendimiento", name: "Rendimiento de Cosecha", unit: "t/ha", minValue: "0.1", maxValue: "30.0", optimalMin: "3", optimalMax: "10", defaultCv: "25.0", description: "Rendimiento estimado o medido en campo", protocol: "Corte y pesaje de biomasa en cuadros de 1m²" },
  ];

  for (const v of defaultVariables) {
    try {
      const existing = await storage.getMasterVariableByCode(v.code);
      if (!existing) {
        await storage.createMasterVariable(v as any);
      }
    } catch (e) {
      console.warn(`Could not seed variable ${v.code}:`, e);
    }
  }
}

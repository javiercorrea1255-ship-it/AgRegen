/**
 * Drone MVZ Routes
 * POST /api/parcels/:id/zones/from-drone  — upload GeoTIFF → index → zones
 * GET  /api/parcels/:id/zones/from-drone  — list drone zone-sets for a parcel
 * DELETE /api/parcels/:id/drone-zone-sets/:zoneSetId — delete zone set
 * POST /api/drone-zone-sets/:zoneSetId/prescribe — AI prescriptions
 */
import type { Express, RequestHandler } from "express";
import multer from "multer";
import FormData from "form-data";
import type { IStorage } from "../storage";
import { generatePrescriptions } from "../services/ai-assistant";

export interface DroneZoneDeps {
  storage: IStorage;
  fetchWithTimeout: (url: string, init?: RequestInit, timeoutMs?: number) => Promise<Response>;
  geoServiceUrl?: string;
}

export interface DroneZoneAuth {
  isAuthenticated: RequestHandler;
  isActiveUser: RequestHandler;
}

const ZONE_COLORS = ["#d73027", "#fdae61", "#1a9850", "#2166ac", "#762a83", "#b35806", "#1b7837", "#8c510a"];

const DRONE_INDEX_META: Record<string, { name: string; unit: string; code: string; optimalMin?: number; optimalMax?: number }> = {
  ndvi:  { name: "Vigor (NDVI)",                    unit: "índice", code: "NDVI",  optimalMin: 0.55, optimalMax: 0.85 },
  ndre:  { name: "Estado nitrogenado (NDRE)",       unit: "índice", code: "NDRE",  optimalMin: 0.30, optimalMax: 0.55 },
  ndmi:  { name: "Humedad foliar (NDMI)",           unit: "índice", code: "NDMI",  optimalMin: 0.20, optimalMax: 0.50 },
  evi:   { name: "Vigor mejorado (EVI)",            unit: "índice", code: "EVI",   optimalMin: 0.40, optimalMax: 0.70 },
  gndvi: { name: "Verdor / clorofila (GNDVI)",      unit: "índice", code: "GNDVI", optimalMin: 0.40, optimalMax: 0.70 },
  msavi: { name: "Vigor con suelo desnudo (MSAVI)", unit: "índice", code: "MSAVI", optimalMin: 0.30, optimalMax: 0.65 },
};

const droneUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype === "image/tiff" ||
      file.mimetype === "image/geotiff" ||
      file.mimetype === "application/octet-stream" ||
      file.originalname.toLowerCase().endsWith(".tif") ||
      file.originalname.toLowerCase().endsWith(".tiff");
    cb(null, ok);
  },
});

export function registerDroneZoneRoutes(app: Express, deps: DroneZoneDeps, auth: DroneZoneAuth): void {
  const { storage, fetchWithTimeout } = deps;
  const geoServiceUrl = deps.geoServiceUrl ?? process.env.GEO_SERVICE_URL ?? "http://127.0.0.1:8000";
  const { isAuthenticated, isActiveUser } = auth;

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /api/parcels/:id/zones/from-drone
  // ─────────────────────────────────────────────────────────────────────────────
  app.post(
    "/api/parcels/:id/zones/from-drone",
    isAuthenticated,
    isActiveUser,
    droneUpload.single("file"),
    async (req: any, res) => {
      try {
        const parcel = await storage.getParcel(req.params.id);
        if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
        if (parcel.userId !== req.user.id && req.user.role !== "admin") return res.status(403).json({ message: "No autorizado" });

        if (!req.file) {
          return res.status(400).json({
            message: "Se requiere un archivo GeoTIFF (.tif). Exporta el ortomosaico desde DJI Terra, Pix4D o Metashape.",
          });
        }

        const {
          index_type = "ndvi",
          camera_type = "dji_p4m",
          n_zones = "3",
          method = "spatial_kmeans",
          auto_k = "false",
          red_band,
          nir_band,
          rededge_band,
          green_band,
          blue_band,
          max_side = "200",
          min_zone_area_ha = "0.1",
        } = req.body ?? {};

        // Build multipart request to geo-service
        const formData = new FormData();
        formData.append("file", req.file.buffer, {
          filename: req.file.originalname || "ortho.tif",
          contentType: req.file.mimetype || "image/tiff",
        });
        formData.append("index_type", index_type);
        formData.append("camera_type", camera_type);
        formData.append("n_zones", n_zones);
        formData.append("method", method);
        formData.append("auto_k", auto_k);
        formData.append("max_side", max_side);
        formData.append("min_zone_area_ha", min_zone_area_ha);

        if (red_band)     formData.append("red_band",     red_band);
        if (nir_band)     formData.append("nir_band",     nir_band);
        if (rededge_band) formData.append("rededge_band", rededge_band);
        if (green_band)   formData.append("green_band",   green_band);
        if (blue_band)    formData.append("blue_band",    blue_band);

        const poly = parcel.polygonCoordinates;
        if (Array.isArray(poly) && poly.length >= 3) {
          formData.append("polygon", JSON.stringify(poly));
        }

        const geoResp = await fetchWithTimeout(
          `${geoServiceUrl}/drone-zonify`,
          {
            method: "POST",
            body: formData as unknown as BodyInit,
            headers: formData.getHeaders() as Record<string, string>,
          } as RequestInit,
          120_000,
        );

        if (!geoResp.ok) {
          const errText = await geoResp.text();
          let detail = errText;
          try { detail = JSON.parse(errText)?.detail ?? errText; } catch { /* empty */ }
          console.error("[drone-zones] geo-service error:", geoResp.status, detail);
          return res.status(502).json({ message: `Error en el servicio geo: ${detail}` });
        }

        const geoData = await geoResp.json() as {
          zones: any[];
          bbox: { minx: number; miny: number; maxx: number; maxy: number };
          index_type: string;
          n_bands_in_file: number;
          camera_type: string;
        };

        if (!geoData.zones || geoData.zones.length === 0) {
          return res.status(500).json({
            message: "El geo-servicio no generó ninguna zona. Verifica que el GeoTIFF cubre la parcela y tiene suficiente variabilidad espectral.",
          });
        }

        const zoneSetId = `drone_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const indexMeta = DRONE_INDEX_META[geoData.index_type] ?? { name: geoData.index_type.toUpperCase(), unit: "índice", code: geoData.index_type.toUpperCase() };

        const zonesToInsert = geoData.zones.map((z: any, i: number) => ({
          parcelId: parcel.id,
          source: "drone_index",
          zoneSetId,
          sourceMetadata: {
            indexType: geoData.index_type,
            indexName: indexMeta.name,
            indexUnit: indexMeta.unit,
            cameraType: geoData.camera_type,
            nBands: geoData.n_bands_in_file,
            bbox: geoData.bbox,
            method,
            autoK: auto_k === "true",
            flightDate: req.body?.flight_date ?? null,
            filename: req.file!.originalname ?? null,
            fileSizeKb: Math.round(req.file!.size / 1024),
          },
          zoneIndex: z.zone_index ?? i + 1,
          zoneLabel: z.zone_label ?? `Zona ${i + 1}`,
          category: z.category ?? null,
          // InsertManagementZone uses z.coerce.number() so pass numbers directly
          areaHa: z.area_ha != null ? parseFloat(z.area_ha) : null,
          valueMean: z.value_mean != null ? parseFloat(z.value_mean) : null,
          valueStd: z.value_std != null ? parseFloat(z.value_std) : null,
          valueMin: z.value_min != null ? parseFloat(z.value_min) : null,
          valueMax: z.value_max != null ? parseFloat(z.value_max) : null,
          polygonGeojson: z.polygon_geojson,
          colorHex: z.color_hex ?? ZONE_COLORS[i % ZONE_COLORS.length],
        }));

        await storage.bulkCreateManagementZones(zonesToInsert as any);
        console.log(`[drone-zones] created ${zonesToInsert.length} zones, zoneSetId=${zoneSetId}`);

        return res.status(201).json({
          zoneSetId,
          zonesCreated: zonesToInsert.length,
          indexType: geoData.index_type,
          indexName: indexMeta.name,
          bbox: geoData.bbox,
        });
      } catch (err: any) {
        console.error("[drone-zones] unexpected error:", err);
        return res.status(500).json({ message: err?.message ?? "Error interno del servidor" });
      }
    },
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // GET /api/parcels/:id/zones/from-drone
  // ─────────────────────────────────────────────────────────────────────────────
  app.get("/api/parcels/:id/zones/from-drone", isAuthenticated, isActiveUser, async (req: any, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
      if (parcel.userId !== req.user.id && req.user.role !== "admin") return res.status(403).json({ message: "No autorizado" });

      const allZones = await storage.getManagementZonesByParcel(req.params.id);
      const droneZones = allZones.filter((z) => z.source === "drone_index");

      const setsMap = new Map<string, any>();
      for (const z of droneZones) {
        if (!z.zoneSetId) continue;
        if (!setsMap.has(z.zoneSetId)) {
          const meta = (z.sourceMetadata ?? {}) as any;
          setsMap.set(z.zoneSetId, {
            zoneSetId: z.zoneSetId,
            indexType: meta.indexType ?? "ndvi",
            indexName: meta.indexName ?? "NDVI",
            cameraType: meta.cameraType ?? "unknown",
            filename: meta.filename ?? null,
            flightDate: meta.flightDate ?? null,
            method: meta.method ?? "spatial_kmeans",
            createdAt: z.createdAt,
            zoneCount: 0,
            zones: [] as any[],
          });
        }
        const set = setsMap.get(z.zoneSetId)!;
        set.zoneCount += 1;
        set.zones.push(z);
      }

      return res.json({ zoneSets: Array.from(setsMap.values()) });
    } catch (err: any) {
      return res.status(500).json({ message: err?.message ?? "Error interno del servidor" });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // DELETE /api/parcels/:id/drone-zone-sets/:zoneSetId
  // ─────────────────────────────────────────────────────────────────────────────
  app.delete("/api/parcels/:id/drone-zone-sets/:zoneSetId", isAuthenticated, isActiveUser, async (req: any, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
      if (parcel.userId !== req.user.id && req.user.role !== "admin") return res.status(403).json({ message: "No autorizado" });

      const zones = await storage.getManagementZonesByZoneSet(req.params.zoneSetId);
      if (zones.length === 0) return res.status(404).json({ message: "Zone-set no encontrado" });
      if (zones[0].parcelId !== req.params.id) return res.status(403).json({ message: "No autorizado" });

      await storage.deleteManagementZonesByZoneSet(req.params.zoneSetId);
      return res.json({ message: "Zonas eliminadas", deleted: zones.length });
    } catch (err: any) {
      return res.status(500).json({ message: err?.message ?? "Error interno del servidor" });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // POST /api/drone-zone-sets/:zoneSetId/prescribe
  // ─────────────────────────────────────────────────────────────────────────────
  app.post("/api/drone-zone-sets/:zoneSetId/prescribe", isAuthenticated, isActiveUser, async (req: any, res) => {
    try {
      const zones = await storage.getManagementZonesByZoneSet(req.params.zoneSetId);
      if (zones.length === 0) return res.status(404).json({ message: "Zone-set no encontrado" });
      const parcelId = zones[0].parcelId;
      if (!parcelId) return res.status(400).json({ message: "Las zonas no tienen parcela asociada" });
      const parcel = await storage.getParcel(parcelId);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
      if (parcel.userId !== req.user.id && req.user.role !== "admin") return res.status(403).json({ message: "No autorizado" });

      const meta = (zones[0].sourceMetadata ?? {}) as { indexType?: string; indexName?: string; indexUnit?: string };
      const indexType = meta.indexType ?? "ndvi";
      const idxMeta = DRONE_INDEX_META[indexType] ?? { name: indexType.toUpperCase(), unit: "índice", code: indexType.toUpperCase() };

      // Map DB zones → ZoneContext for AI
      const zoneContexts = zones.map((z) => ({
        zoneIndex: z.zoneIndex,
        category: z.category ?? z.zoneLabel ?? `Zona ${z.zoneIndex}`,
        valueMean: parseFloat(String(z.valueMean ?? "0")),
        valueMin: parseFloat(String(z.valueMin ?? "0")),
        valueMax: parseFloat(String(z.valueMax ?? "0")),
        areaHa: parseFloat(String(z.areaHa ?? "1")),
        colorHex: z.colorHex ?? ZONE_COLORS[z.zoneIndex % ZONE_COLORS.length],
      }));

      const prescriptions = await generatePrescriptions({
        variableCode: idxMeta.code,
        variableName: idxMeta.name,
        variableUnit: idxMeta.unit,
        optimalMin: idxMeta.optimalMin,
        optimalMax: idxMeta.optimalMax,
        crop: parcel.crop ?? "cultivo",
        parcelArea: parseFloat(String(parcel.area ?? "1")),
        zones: zoneContexts,
      });

      if (prescriptions.length === 0) {
        return res.status(500).json({ message: "La IA no generó prescripciones. Intenta de nuevo." });
      }

      // Match prescriptions to saved zone IDs so we can insert ZonePrescription rows
      const zoneIdByIndex = new Map(zones.map((z) => [z.zoneIndex, z.id]));
      const prescsToInsert = prescriptions.map((p) => {
        const zoneId = zoneIdByIndex.get(p.zoneIndex) ?? zones[0].id;
        return {
          zoneId,
          amendment: p.amendment,
          dosePerHa: p.dosePerHa,
          doseUnit: p.doseUnit,
          totalDose: p.totalDose,
          applicationMethod: p.applicationMethod,
          timing: p.timing,
          aiRationale: p.aiRationale,
          estimatedCost: p.estimatedCostPerHa,
        };
      });

      await storage.bulkCreateZonePrescriptions(prescsToInsert as any);

      return res.status(201).json({ prescriptionsCreated: prescsToInsert.length, prescriptions: prescsToInsert });
    } catch (err: any) {
      console.error("[drone-zones/prescribe]", err);
      return res.status(500).json({ message: err?.message ?? "Error generando prescripciones" });
    }
  });
}

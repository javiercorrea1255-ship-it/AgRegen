import type { Express, RequestHandler } from "express";
import { fromZodError } from "zod-validation-error";
import { satelliteZoneBodySchema } from "@shared/satellite-zone-schema";
import type { IStorage } from "../storage";
import type * as EarthEngine from "../services/earth-engine";
import { ndviNitrogenRule } from "@shared/ndvi-nitrogen";
import { explainNdviNitrogen } from "../services/ndvi-nitrogen-explanation";

export interface SatelliteZoneDeps {
  storage: IStorage;
  isGEEAvailable: typeof EarthEngine.isGEEAvailable;
  getIndexRaster: typeof EarthEngine.getIndexRaster;
  fetchWithTimeout: (url: string, init?: RequestInit, timeoutMs?: number) => Promise<Response>;
  geoServiceUrl?: string;
  explainNdviNitrogen?: typeof explainNdviNitrogen;
}

export interface SatelliteZoneAuth {
  isAuthenticated: RequestHandler;
  isActiveUser: RequestHandler;
}

const ZONE_COLORS = ["#d73027", "#fdae61", "#1a9850", "#2166ac", "#762a83", "#b35806", "#1b7837", "#8c510a"];

type SatZoneSetContext =
  | { error: { status: number; message: string }; zones?: undefined; parcel?: undefined; indexType?: undefined }
  | {
      error?: undefined;
      zones: any[];
      parcel: any;
      indexType: string;
    };

async function loadZoneSetContext(deps: SatelliteZoneDeps, zoneSetId: string, userId: string, isAdmin = false): Promise<SatZoneSetContext> {
  const zones = await deps.storage.getManagementZonesByZoneSet(zoneSetId);
  if (zones.length === 0) return { error: { status: 404, message: "Zona-set no encontrado" } };
  const parcelId = zones[0].parcelId;
  if (!parcelId) return { error: { status: 400, message: "Las zonas no tienen parcela asociada" } };
  const parcel = await deps.storage.getParcel(parcelId);
  if (!parcel) return { error: { status: 404, message: "Parcela no encontrada" } };
  if (parcel.userId !== userId && !isAdmin) return { error: { status: 403, message: "No autorizado" } };
  const meta = (zones[0].sourceMetadata ?? {}) as { indexType?: string };
  const indexType = (meta.indexType ?? "ndvi").toLowerCase();
  return { zones, parcel, indexType };
}

/**
 * Register the six satellite-zone HTTP routes on the given Express app.
 * Auth middleware is injected so the same handlers can be exercised end-to-end
 * by a supertest harness with a stubbed authenticator.
 */
export function registerSatelliteZoneRoutes(app: Express, deps: SatelliteZoneDeps, auth: SatelliteZoneAuth): void {
  const { storage, isGEEAvailable, getIndexRaster, fetchWithTimeout } = deps;
  const geoServiceUrl = deps.geoServiceUrl ?? process.env.GEO_SERVICE_URL ?? "http://127.0.0.1:8000";
  const { isAuthenticated, isActiveUser } = auth;

  // ── Create satellite-derived management zones for a parcel ────────────────
  app.post("/api/parcels/:id/zones/from-satellite", isAuthenticated, isActiveUser, async (req: any, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
      if (parcel.userId !== req.user.id && req.user.role !== "admin") return res.status(403).json({ message: "No autorizado" });

      const polyCoords = parcel.polygonCoordinates as [number, number][] | null | undefined;
      if (!Array.isArray(polyCoords) || polyCoords.length < 3) {
        return res.status(400).json({
          message: "La parcela no tiene polígono definido (mínimo 3 vértices). Edítala desde 'Mis parcelas' antes de generar zonas satelitales.",
        });
      }

      const parsed = satelliteZoneBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ message: fromZodError(parsed.error).message });
      }
      const opts = parsed.data;

      if (!isGEEAvailable()) {
        return res.status(503).json({ message: "Earth Engine no está disponible. Verifica las credenciales del servicio." });
      }

      let raster;
      try {
        raster = await getIndexRaster(
          { coordinates: polyCoords },
          opts.indexType,
          {
            specificDate: opts.date ?? undefined,
            dateFrom: opts.dateFrom ?? undefined,
            dateTo: opts.dateTo ?? undefined,
            daysBack: opts.daysBack,
            maxCloudPct: opts.maxCloudPct,
          },
        );
      } catch (eeErr: any) {
        return res.status(502).json({ message: `Earth Engine: ${eeErr?.message ?? "error desconocido al obtener la imagen"}` });
      }
      if (!raster) {
        return res.status(503).json({ message: "Earth Engine no respondió. Reintenta más tarde." });
      }

      const polygonLonLat = polyCoords.map(([lat, lng]) => [lng, lat]);
      const gridValues = raster.values.map((row: any[]) => row.map((v: any) => (v == null || !Number.isFinite(v) ? Number.NaN : v)));

      let geoResult: any;
      try {
        const geoResp = await fetchWithTimeout(`${geoServiceUrl}/zonify-from-raster`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            grid_values: gridValues,
            bbox: raster.bbox,
            n_zones: opts.nZones,
            method: opts.method,
            variable_code: opts.indexType,
            auto_k: !!opts.autoK,
            polygon: polygonLonLat,
            min_zone_area_ha: opts.minZoneAreaHa,
            apply_mode_filter: true,
            transform_type: "none",
          }),
        });
        if (!geoResp.ok) {
          const errText = await geoResp.text().catch(() => "");
          return res.status(502).json({ message: `Geo-service /zonify-from-raster falló (${geoResp.status}): ${errText.slice(0, 200)}` });
        }
        geoResult = await geoResp.json();
      } catch (geoErr: any) {
        if (geoErr?.name === "AbortError") {
          return res.status(504).json({ message: "Geo-service excedió el tiempo de espera. Reduce el nº de zonas o usa una imagen más pequeña." });
        }
        return res.status(502).json({ message: `Geo-service no accesible: ${geoErr?.message ?? "error de red"}` });
      }

      const rawZones: any[] = Array.isArray(geoResult.zones) ? geoResult.zones : [];
      const validZones = rawZones.filter(z => z.geojson != null);
      if (validZones.length === 0) {
        return res.status(422).json({ message: "El geo-servicio no devolvió zonas válidas (raster degenerado o todos los píxeles iguales)." });
      }

      const zoneSetId = `sat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const sourceMetadata = {
        indexType: raster.indexType,
        imageDate: raster.imageDate,
        scaleM: raster.scaleM,
        rows: raster.rows,
        cols: raster.cols,
        validPixels: raster.validPixels,
        bbox: raster.bbox,
        vmin: raster.vmin,
        vmax: raster.vmax,
        cloudyPixelPercentage: raster.cloudyPixelPercentage,
        method: opts.method,
        autoK: !!opts.autoK,
        nZonesRequested: opts.nZones,
        nZonesActual: validZones.length,
        minZoneAreaHa: opts.minZoneAreaHa,
        generatedAt: new Date().toISOString(),
      } as const;

      const persisted = await storage.bulkCreateManagementZones(
        validZones.map((z: any, i: number) => ({
          interpolationId: null,
          parcelId: parcel.id,
          source: "satellite_index",
          zoneSetId,
          sourceMetadata,
          zoneIndex: i,
          zoneLabel: z.label || z.zone_label || `Zona ${i + 1}`,
          colorHex: z.color || ZONE_COLORS[i] || "#888",
          valueMean: z.mean ?? z.value_mean ?? null,
          valueStd: z.std ?? z.value_std ?? null,
          valueMin: z.min ?? z.value_min ?? null,
          valueMax: z.max ?? z.value_max ?? null,
          areaHa: z.area_ha != null ? Number(Number(z.area_ha).toFixed(4)) : null,
          polygonGeojson: z.geojson,
          category: z.category ?? null,
          aiInterpretation: null,
        })),
      );

      res.json({
        zoneSetId,
        zones: persisted,
        raster: {
          indexType: raster.indexType,
          imageDate: raster.imageDate,
          scaleM: raster.scaleM,
          rows: raster.rows,
          cols: raster.cols,
          bbox: raster.bbox,
          vmin: raster.vmin,
          vmax: raster.vmax,
          cloudyPixelPercentage: raster.cloudyPixelPercentage,
        },
        nZones: persisted.length,
      });
    } catch (error: any) {
      console.error("Error in /api/parcels/:id/zones/from-satellite:", error);
      res.status(500).json({ message: `Error al generar zonas satelitales: ${error.message ?? error}` });
    }
  });

  // ── List satellite zone-sets for a parcel ─────────────────────────────────
  app.get("/api/parcels/:id/zones/from-satellite", isAuthenticated, isActiveUser, async (req: any, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
      if (parcel.userId !== req.user.id && req.user.role !== "admin") return res.status(403).json({ message: "No autorizado" });

      const zones = await storage.getManagementZonesByParcel(parcel.id, "satellite_index");
      const sets = new Map<string, { zoneSetId: string; createdAt: Date; metadata: any; zones: typeof zones }>();
      for (const z of zones) {
        const key = z.zoneSetId ?? `legacy_${z.id}`;
        const ex = sets.get(key);
        if (!ex) {
          sets.set(key, { zoneSetId: key, createdAt: z.createdAt, metadata: z.sourceMetadata, zones: [z] });
        } else {
          ex.zones.push(z);
          if (z.createdAt > ex.createdAt) ex.createdAt = z.createdAt;
        }
      }
      const result = Array.from(sets.values())
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map(s => ({ ...s, zones: s.zones.sort((a, b) => a.zoneIndex - b.zoneIndex) }));
      res.json({ zoneSets: result });
    } catch (error: any) {
      res.status(500).json({ message: `Error al listar zonas satelitales: ${error.message}` });
    }
  });

  // ── Delete one satellite zone-set ─────────────────────────────────────────
  app.delete("/api/parcels/:id/zones/from-satellite/:zoneSetId", isAuthenticated, isActiveUser, async (req: any, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
      if (parcel.userId !== req.user.id && req.user.role !== "admin") return res.status(403).json({ message: "No autorizado" });

      const existing = await storage.getManagementZonesByZoneSet(req.params.zoneSetId);
      if (existing.length === 0 || existing.some(z => z.parcelId !== parcel.id)) {
        return res.status(404).json({ message: "Conjunto de zonas no encontrado" });
      }
      await storage.deleteManagementZonesByZoneSet(req.params.zoneSetId);
      res.json({ ok: true, deleted: existing.length });
    } catch (error: any) {
      res.status(500).json({ message: `Error al eliminar zonas: ${error.message}` });
    }
  });

  // ── Export zone-set as GeoJSON / KML / Shapefile / GeoTIFF ────────────────
  app.get("/api/parcels/:id/zones/from-satellite/:zoneSetId/export", isAuthenticated, isActiveUser, async (req: any, res) => {
    try {
      const parcel = await storage.getParcel(req.params.id);
      if (!parcel) return res.status(404).json({ message: "Parcela no encontrada" });
      if (parcel.userId !== req.user.id && req.user.role !== "admin") return res.status(403).json({ message: "No autorizado" });

      const zones = await storage.getManagementZonesByZoneSet(req.params.zoneSetId);
      if (zones.length === 0 || zones.some(z => z.parcelId !== parcel.id)) {
        return res.status(404).json({ message: "Conjunto de zonas no encontrado" });
      }

      const format = String(req.query.format ?? "geojson").toLowerCase();
      const meta = (zones[0].sourceMetadata ?? {}) as Record<string, unknown>;
      const baseName = `zonas_${(meta.indexType as string) ?? "satelite"}_${(meta.imageDate as string) ?? "sin_fecha"}_${parcel.id.slice(0, 6)}`;

      if (format === "shapefile" || format === "shp" || format === "geotiff" || format === "tif" || format === "tiff") {
        const features = zones.map(z => {
          const g = z.polygonGeojson as any;
          return {
            zone_index: z.zoneIndex,
            zone_label: z.zoneLabel,
            category: z.category ?? null,
            color_hex: z.colorHex,
            area_ha: z.areaHa != null ? Number(z.areaHa) : null,
            value_mean: z.valueMean != null ? Number(z.valueMean) : null,
            value_std: z.valueStd != null ? Number(z.valueStd) : null,
            value_min: z.valueMin != null ? Number(z.valueMin) : null,
            value_max: z.valueMax != null ? Number(z.valueMax) : null,
            polygon_geojson: g?.type === "Feature" ? g.geometry : g,
          };
        });
        const isGeotiff = format === "geotiff" || format === "tif" || format === "tiff";
        const path = isGeotiff ? "/zones-export-geotiff" : "/zones-export-shp";
        const body: Record<string, unknown> = { zones: features, base_filename: baseName, metadata: meta };
        if (isGeotiff) {
          const bbox = (meta.bbox ?? null) as { minX?: number; minY?: number; maxX?: number; maxY?: number; minx?: number; miny?: number; maxx?: number; maxy?: number } | null;
          if (!bbox) return res.status(422).json({ message: "El conjunto de zonas no tiene bbox; regenera las zonas para exportar GeoTIFF." });
          body.bbox = {
            minx: bbox.minx ?? bbox.minX,
            miny: bbox.miny ?? bbox.minY,
            maxx: bbox.maxx ?? bbox.maxX,
            maxy: bbox.maxy ?? bbox.maxY,
          };
        }
        const upstream = await fetchWithTimeout(`${geoServiceUrl}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!upstream.ok) {
          const txt = await upstream.text().catch(() => "");
          return res.status(502).json({ message: `Geo-service ${path} falló (${upstream.status}): ${txt.slice(0, 200)}` });
        }
        const ct = upstream.headers.get("content-type") || (isGeotiff ? "image/tiff" : "application/zip");
        const disposition = upstream.headers.get("content-disposition")
          || `attachment; filename="${baseName}${isGeotiff ? ".tif" : ".zip"}"`;
        const warning = upstream.headers.get("x-export-warning");
        res.setHeader("Content-Type", ct);
        res.setHeader("Content-Disposition", disposition);
        if (warning) res.setHeader("X-Export-Warning", warning);
        const buf = Buffer.from(await upstream.arrayBuffer());
        return res.send(buf);
      }

      if (format === "geojson") {
        const fc = {
          type: "FeatureCollection" as const,
          features: zones.map(z => {
            const g = z.polygonGeojson as any;
            const geom = g?.type === "Feature" ? g.geometry : g;
            return {
              type: "Feature" as const,
              properties: {
                zoneIndex: z.zoneIndex,
                zoneLabel: z.zoneLabel,
                category: z.category,
                color: z.colorHex,
                areaHa: z.areaHa != null ? Number(z.areaHa) : null,
                valueMean: z.valueMean != null ? Number(z.valueMean) : null,
                valueStd: z.valueStd != null ? Number(z.valueStd) : null,
                valueMin: z.valueMin != null ? Number(z.valueMin) : null,
                valueMax: z.valueMax != null ? Number(z.valueMax) : null,
                indexType: meta.indexType ?? null,
                imageDate: meta.imageDate ?? null,
              },
              geometry: geom,
            };
          }),
        };
        res.setHeader("Content-Type", "application/geo+json");
        res.setHeader("Content-Disposition", `attachment; filename="${baseName}.geojson"`);
        return res.send(JSON.stringify(fc, null, 2));
      }

      if (format === "kml") {
        const escape = (s: any) =>
          String(s ?? "").replace(/[<>&'"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" } as any)[c]);
        const placemarks = zones.map(z => {
          const g = z.polygonGeojson as any;
          const geom = g?.type === "Feature" ? g.geometry : g;
          const ringsToKml = (rings: number[][][]) =>
            rings.map((ring, i) => {
              const coordStr = ring.map(c => `${c[0]},${c[1]},0`).join(" ");
              return i === 0
                ? `<outerBoundaryIs><LinearRing><coordinates>${coordStr}</coordinates></LinearRing></outerBoundaryIs>`
                : `<innerBoundaryIs><LinearRing><coordinates>${coordStr}</coordinates></LinearRing></innerBoundaryIs>`;
            }).join("");
          let polyXml = "";
          if (geom?.type === "Polygon") {
            polyXml = `<Polygon>${ringsToKml(geom.coordinates as number[][][])}</Polygon>`;
          } else if (geom?.type === "MultiPolygon") {
            polyXml = `<MultiGeometry>${(geom.coordinates as number[][][][]).map(p => `<Polygon>${ringsToKml(p)}</Polygon>`).join("")}</MultiGeometry>`;
          }
          const colorAbgr = (z.colorHex ?? "#888888").replace("#", "").match(/.{2}/g);
          const kmlColor = colorAbgr ? `cc${colorAbgr[2]}${colorAbgr[1]}${colorAbgr[0]}` : "ccaaaaaa";
          return `<Placemark>
  <name>${escape(z.zoneLabel ?? `Zona ${z.zoneIndex + 1}`)}</name>
  <description><![CDATA[Índice: ${escape(meta.indexType)} | Media: ${z.valueMean ?? "N/A"} | Área: ${z.areaHa ?? "N/A"} ha]]></description>
  <Style><PolyStyle><color>${kmlColor}</color><fill>1</fill><outline>1</outline></PolyStyle></Style>
  ${polyXml}
</Placemark>`;
        }).join("\n");
        const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>${escape(baseName)}</name>
  <description>Zonas de manejo satelitales — AgRegen</description>
  ${placemarks}
</Document>
</kml>`;
        res.setHeader("Content-Type", "application/vnd.google-earth.kml+xml");
        res.setHeader("Content-Disposition", `attachment; filename="${baseName}.kml"`);
        return res.send(kml);
      }

      return res.status(400).json({ message: `Formato no soportado: ${format}. Usa 'geojson', 'kml', 'shapefile' o 'geotiff'.` });
    } catch (error: any) {
      res.status(500).json({ message: `Error al exportar: ${error.message}` });
    }
  });

  // ── Prescription handoff for satellite zone-sets ──────────────────────────
  app.post("/api/zone-sets/:zoneSetId/prescribe", isAuthenticated, isActiveUser, async (req: any, res) => {
    try {
      const ctx = await loadZoneSetContext(deps, req.params.zoneSetId, req.user.id, req.user.role === "admin");
      if (ctx.error) return res.status(ctx.error.status).json({ message: ctx.error.message });
      const { zones, indexType } = ctx;
      if (indexType !== "ndvi" || zones.some(zone => zone.source !== "satellite_index")) {
        return res.status(400).json({ message: "La prescripción satelital de nitrógeno requiere zonas NDVI. Genera un conjunto NDVI para continuar." });
      }
      const numberOrNaN = (value: unknown) =>
        typeof value === "number" || (typeof value === "string" && value.trim()) ? Number(value) : NaN;
      const inputs = zones.map(zone => ({
        zone, meanNdvi: numberOrNaN(zone.valueMean), areaHa: numberOrNaN(zone.areaHa),
      }));
      if (inputs.some(({ meanNdvi, areaHa }) => !Number.isFinite(meanNdvi) || meanNdvi < -1 ||
        meanNdvi > 1 || !Number.isFinite(areaHa) || areaHa <= 0)) {
        return res.status(422).json({ message: "Cada zona requiere un NDVI medio válido y un área positiva." });
      }
      const fixed = inputs.map(input => ({ ...input, rule: ndviNitrogenRule(input.meanNdvi) }));
      let explanations = new Map<number, string>();
      if (process.env.NDVI_NITROGEN_AI_EXPLANATION === "true") {
        try {
          explanations = await (deps.explainNdviNitrogen ?? explainNdviNitrogen)(fixed.map(({ zone, meanNdvi, rule }) => ({
            zoneIndex: zone.zoneIndex, meanNdvi, dose: rule.dose, unit: rule.unit, label: rule.label,
          })));
        } catch {
          console.warn("[prescribe] Explicación opcional NDVI no disponible; se conserva la regla determinista.");
        }
      }
      const rows = fixed.map(({ zone, meanNdvi, areaHa, rule }) => {
        const prose = explanations.get(zone.zoneIndex);
        const rationale = `Motor determinista NDVI v${rule.version}: media ${meanNdvi}, banda ${rule.label}, ${rule.dose} ${rule.unit}. El NDVI por sí solo no diagnostica deficiencia de N.`;
        return {
          zoneId: zone.id,
          amendment: "Nitrógeno (N)",
          dosePerHa: rule.dose,
          doseUnit: "kg N",
          totalDose: Number((rule.dose * areaHa).toFixed(4)),
          applicationMethod: null,
          timing: null,
          aiRationale: prose && !/\d/.test(prose) ? `${rationale} ${prose}` : rationale,
          estimatedCost: null,
        };
      });
      const saved = await storage.replaceUnappliedZonePrescriptions(rows);
      if (!saved) {
        return res.status(409).json({ message: "Ya hay aplicaciones registradas. Genera otro conjunto de zonas para conservar el historial." });
      }
      const byZone = new Map(zones.map(zone => [zone.id, zone]));
      res.json({ prescriptions: saved.map(row => ({ ...row, zone: byZone.get(row.zoneId) })) });
    } catch (error: any) {
      console.error("Satellite prescription error:", error);
      res.status(500).json({ message: `Error al generar prescripciones: ${error.message}` });
    }
  });

  app.get("/api/zone-sets/:zoneSetId/prescriptions", isAuthenticated, async (req: any, res) => {
    try {
      const ctx = await loadZoneSetContext(deps, req.params.zoneSetId, req.user.id, req.user.role === "admin");
      if (ctx.error) return res.status(ctx.error.status).json({ message: ctx.error.message });
      const { zones } = ctx;
      const prescriptions: any[] = [];
      for (const z of zones) {
        const ps = await storage.getZonePrescriptionsByZone(z.id);
        prescriptions.push(...ps);
      }
      const applications = (await Promise.all(prescriptions.map(
        p => storage.getPrescriptionApplicationsByPrescription(p.id),
      ))).flat();
      res.json({ prescriptions, zones, applications });
    } catch (error) {
      res.status(500).json({ message: "Error al obtener prescripciones" });
    }
  });
}

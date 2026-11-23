/**
 * Body schema for POST /api/parcels/:id/zones/from-satellite.
 *
 * Extracted into shared/ so the Express route handler and the integration tests
 * use the same source of truth for input validation.
 *
 * Classification methods:
 *   - spatial_kmeans : K-means with x/y coords for spatial coherence (default).
 *   - jenks          : 1-D Fisher-Jenks natural breaks. 'kmeans' is a legacy alias.
 *   - quantiles      : equal-count classes (zones with ~same area).
 *   - fuzzy          : Fuzzy C-means (soft membership).
 *   - agronomic      : threshold-based; only meaningful for soil variables.
 *
 * Date selection:
 *   - date           : a single specific YYYY-MM-DD.
 *   - dateFrom+dateTo: inclusive range; the most-recent low-cloud scene wins.
 *   - neither set    : daysBack rolling window (default 30).
 */
import { z } from "zod";

export const satelliteZoneBodySchema = z.object({
  indexType: z.enum(["ndvi", "ndre", "ndmi", "evi", "msavi", "gndvi"]).default("ndvi"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  nZones: z.coerce.number().int().min(2).max(6).default(3),
  method: z.enum(["spatial_kmeans", "kmeans", "jenks", "quantiles", "fuzzy", "agronomic"]).default("spatial_kmeans"),
  autoK: z.boolean().optional(),
  minZoneAreaHa: z.coerce.number().min(0.01).max(10).default(0.25),
  maxCloudPct: z.coerce.number().min(0).max(100).default(20),
  daysBack: z.coerce.number().int().min(1).max(365).default(30),
}).strict().refine(
  (v) => !(v.dateFrom && !v.dateTo) && !(v.dateTo && !v.dateFrom),
  { message: "dateFrom y dateTo deben proporcionarse juntos", path: ["dateTo"] },
);

export type SatelliteZoneBody = z.infer<typeof satelliteZoneBodySchema>;

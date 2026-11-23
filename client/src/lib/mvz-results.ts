import type { ManagementZone } from "@shared/schema";

/** The direct geo re-run returns snake_case; saved server results use camelCase. */
export function normalizeMvzZones(input: unknown): ManagementZone[] {
  if (!Array.isArray(input)) return [];
  return input.map((raw, i) => {
    if (raw?.zoneIndex != null && raw?.polygonGeojson) return raw as ManagementZone;
    const numeric = (v: unknown) => v != null && Number.isFinite(Number(v)) ? String(v) : null;
    return {
      id: `mvz-preview-${i}`, interpolationId: null, parcelId: null,
      source: "kriging", zoneSetId: null, sourceMetadata: null,
      zoneIndex: raw.zone_index ?? i, zoneLabel: raw.zone_label ?? null,
      category: raw.category ?? null, areaHa: numeric(raw.area_ha),
      valueMean: numeric(raw.value_mean), valueStd: numeric(raw.value_std),
      valueMin: numeric(raw.value_min), valueMax: numeric(raw.value_max),
      polygonGeojson: raw.geojson, colorHex: raw.color ?? null,
      aiInterpretation: null, createdAt: new Date(0),
    };
  });
}

export function linearQuantile(sorted: number[], probability: number): number {
  if (!sorted.length) return NaN;
  const position = (sorted.length - 1) * probability;
  const low = Math.floor(position), fraction = position - low;
  return sorted[low] + fraction * ((sorted[low + 1] ?? sorted[low]) - sorted[low]);
}

export function sampleCoordinates(point: { latActual?: unknown; lonActual?: unknown; latPlanned?: unknown; lonPlanned?: unknown }) {
  const preferred = (actual: unknown, planned: unknown) =>
    actual != null && actual !== "" && Number.isFinite(Number(actual)) ? Number(actual) : Number(planned);
  return { lat: preferred(point.latActual, point.latPlanned), lon: preferred(point.lonActual, point.lonPlanned) };
}

export function associateResiduals<T extends { original_index?: number; excluded?: boolean; lat: number; lon: number }>(
  residuals: T[], points: ({ id: string } & Parameters<typeof sampleCoordinates>[0])[],
) {
  return residuals.filter(r => !r.excluded).map(r => {
    const original = Number.isInteger(r.original_index) ? points[r.original_index!] : points.find(p => {
      const c = sampleCoordinates(p);
      return Math.abs(c.lat - r.lat) < 1e-6 && Math.abs(c.lon - r.lon) < 1e-6;
    });
    return { ...r, pointId: original?.id };
  });
}

export interface FittedVariogram {
  model: string; range: number; psill: number; nugget: number; sill: number;
  status?: string; fit_status?: string; fallback_reason?: string;
  empirical?: { distance: number; semivariance: number; n_pairs: number }[];
}

export function variogramCurve(model: FittedVariogram) {
  const max = Math.max(model.range * 1.2, ...(model.empirical ?? []).map(b => b.distance));
  return Array.from({ length: 81 }, (_, i) => {
    const h = max * i / 80, t = h / Math.max(model.range, 1e-12);
    const structure = model.model === "spherical" ? (t < 1 ? 1.5 * t - .5 * t ** 3 : 1) :
      model.model === "exponential" ? 1 - Math.exp(-3 * t) :
      model.model === "gaussian" ? 1 - Math.exp(-((t * 7 / 4) ** 2)) : NaN;
    return { h, gamma: model.nugget + model.psill * structure };
  }).filter(p => Number.isFinite(p.gamma));
}

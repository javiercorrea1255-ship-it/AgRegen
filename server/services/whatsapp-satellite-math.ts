import { area, polygon, intersect, featureCollection, booleanPointInPolygon, point } from "@turf/turf";
import type { IndexRasterResult } from "./earth-engine";

export type SatelliteIndex = "ndvi" | "ndmi";
export type SatelliteRequest = { index: SatelliteIndex; date: string | null; compare: boolean; comparisonDate?: string | null };
export type SatelliteSummary = {
  index: SatelliteIndex; imageDate: string; previousDate: string | null; mean: number;
  level: string; percentages: { low: number; medium: number; high: number; unseen: number };
  lowHa: number; areaHa: number; weakLocations: string[]; unseenLocations: string[];
  change: null | { direction: string; meanDelta: number; locations: string[]; comparedPct: number;
    improvedLocations: string[]; declinedLocations: string[] };
  thresholds: number[]; resolutionM: number;
  reference?: { imageDate: string; mean: number; source: "ledger"; spatialComparison: false };
  coverage?: { edgePct: number; cloudPct: number; noDataPct: number };
  agronomicAlert?: string;
};
const directions = ["esquina noroeste", "orilla norte", "esquina noreste",
  "orilla oeste", "centro", "orilla este", "esquina suroeste", "orilla sur", "esquina sureste"];
const round = (n: number, decimals = 1) => Number(n.toFixed(decimals));
export const thresholdsFor = (index: SatelliteIndex) => index === "ndvi" ? [.3, .6] : [.1, .3];
export function levelFor(value: number, index: SatelliteIndex) {
  const [low, high] = thresholdsFor(index);
  return value < low ? 0 : value < high ? 1 : 2;
}

export function satelliteCropAlert(parcel: { crop?: string | null; plantingDate?: Date | string | null;
  phenologicalStage?: string | null }, summary: SatelliteSummary): string | undefined {
  if (summary.index !== "ndvi" || summary.mean >= .3) return;
  const planted = parcel.plantingDate instanceof Date ? parcel.plantingDate.toISOString().slice(0, 10)
    : String(parcel.plantingDate || "").slice(0, 10);
  const age = (Date.parse(summary.imageDate) - Date.parse(planted)) / 86400000;
  const developing = /desarrollo|vegetativ|floraci|llenado|crecimiento/i.test(parcel.phenologicalStage || "");
  const maizeInSeason = /ma[ií]z/i.test(parcel.crop || "") && age >= 30 && age <= 150;
  if (!developing && !maizeInSeason) return;
  return `Alerta: NDVI ${summary.mean} bajo para un cultivo en desarrollo${maizeInSeason ? ` (${Math.floor(age)} días desde la siembra)` : ""}. Revisa en campo las zonas débiles y confirma la etapa o madurez; el satélite no determina la causa.`;
}
export function parcelPolygon(coordinates: [number, number][]) {
  const ring = coordinates.map(([lat, lon]) => [lon, lat]);
  if (ring[0][0] !== ring.at(-1)![0] || ring[0][1] !== ring.at(-1)![1]) ring.push([...ring[0]]);
  return polygon([ring]);
}
export function analyzeSatelliteRaster(
  raster: IndexRasterResult, coordinates: [number, number][], index: SatelliteIndex,
  previous?: IndexRasterResult | null,
): SatelliteSummary {
  const shape = parcelPolygon(coordinates), total = area(shape);
  if (!(total > 0) || !raster.rows || !raster.cols) throw new Error("Polígono o malla inválidos.");
  if (previous && (previous.rows !== raster.rows || previous.cols !== raster.cols ||
    JSON.stringify(previous.bbox) !== JSON.stringify(raster.bbox))) {
    throw new Error("Las imágenes no tienen la misma malla; no se inventó una comparación.");
  }
  const { minx, miny, maxx, maxy } = raster.bbox;
  const dx = (maxx - minx) / raster.cols, dy = (maxy - miny) / raster.rows;
  const sums = [0, 0, 0, 0], weak = Array(9).fill(0), unseen = Array(9).fill(0);
  const up = Array(9).fill(0), down = Array(9).fill(0);
  let weighted = 0, validArea = 0, deltaSum = 0, commonArea = 0, edgeArea = 0, cloudArea = 0, noDataArea = 0;
  for (let r = 0; r < raster.rows; r++) for (let c = 0; c < raster.cols; c++) {
    const x = minx + c * dx, y = maxy - r * dy;
    const cell = polygon([[[x, y], [x + dx, y], [x + dx, y - dy], [x, y - dy], [x, y]]]);
    const clipped = intersect(featureCollection([shape, cell]));
    const weight = clipped ? area(clipped) : 0;
    if (weight <= 0) continue;
    const section = Math.min(2, Math.floor((r + .5) * 3 / raster.rows)) * 3 +
      Math.min(2, Math.floor((c + .5) * 3 / raster.cols));
    const v = raster.values[r]?.[c];
    if (v == null || !Number.isFinite(v) || v < -1 || v > 1) {
      const partial = weight < area(cell) * .999;
      const centerInside = booleanPointInPolygon(point([x + dx / 2, y - dy / 2]), shape);
      if (partial && (!centerInside || raster.cloudMask?.[r]?.[c] === 0)) {
        edgeArea += weight; continue;
      }
      if (raster.cloudMask?.[r]?.[c] === 1) cloudArea += weight;
      else noDataArea += weight;
      sums[3] += weight; unseen[section] += weight; continue;
    }
    const level = levelFor(v, index);
    sums[level] += weight;
    if (level === 0) weak[section] += weight;
    weighted += v * weight; validArea += weight;
    const before = previous?.values[r]?.[c];
    if (before != null && Number.isFinite(before) && before >= -1 && before <= 1) {
      const delta = v - before;
      deltaSum += delta * weight; commonArea += weight;
      if (delta > .05) up[section] += weight;
      if (delta < -.05) down[section] += weight;
    }
  }
  if (!validArea) throw new Error("No hay píxeles observables en la parcela.");
  const top = (values: number[]) => values.reduce((a, b) => a + b, 0) >= total * .9
    ? ["casi toda la parcela"] : values.map((weight, i) => ({ weight, i }))
    .filter(v => v.weight > total * .005).sort((a, b) => b.weight - a.weight)
    .slice(0, 2).map(v => directions[v.i]);
  const mean = weighted / validArea, delta = commonArea ? deltaSum / commonArea : 0;
  return {
    index, imageDate: raster.imageDate, previousDate: previous?.imageDate || null,
    mean: round(mean, 3), level: ["bajo", "medio", "alto"][levelFor(mean, index)],
    percentages: { low: round(sums[0] / total * 100), medium: round(sums[1] / total * 100),
      high: round(sums[2] / total * 100), unseen: round(sums[3] / total * 100) },
    lowHa: round(sums[0] / 10000, 3), areaHa: round(total / 10000, 3),
    weakLocations: top(weak), unseenLocations: top(unseen),
    change: previous && commonArea > 0 ? {
      direction: delta > .05 ? "mejoró" : delta < -.05 ? "bajó" : "se mantuvo",
      meanDelta: round(delta, 3), comparedPct: round(commonArea / total * 100),
      locations: delta > .05 ? top(up) : delta < -.05 ? top(down) : [],
      improvedLocations: top(up), declinedLocations: top(down),
    } : null,
    thresholds: thresholdsFor(index), resolutionM: raster.scaleM,
    coverage: { edgePct: round(edgeArea / total * 100), cloudPct: round(cloudArea / total * 100),
      noDataPct: round(noDataArea / total * 100) },
  };
}

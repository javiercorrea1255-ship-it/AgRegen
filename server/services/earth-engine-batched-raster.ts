import ee from "@google/earthengine";
import type { IndexRasterResult } from "./earth-engine";

export type NumericRasterOptions = {
  imageId?: string; candidateImageIds?: string[]; previous?: boolean;
  northUpGrid?: boolean; specificDate?: string; dateFrom?: string; dateTo?: string;
  daysBack?: number; maxCloudPct?: number; targetMaxPixels?: number;
};
type IndexExpression = (index: string, image: any) => { image: any; bandName: string };

/**
 * One deferred EE graph and exactly one evaluate. Geometry, cloud selection,
 * grid alignment, samples and scene identity are resolved on the same server.
 */
export async function evaluateAlignedRaster(
  coordinates: [number, number][], index: string, options: NumericRasterOptions,
  expression: IndexExpression,
): Promise<IndexRasterResult> {
  const cap = options.targetMaxPixels ?? 150 * 150;
  if (!Number.isFinite(cap) || cap < 1) throw new Error("El límite de píxeles no es válido.");
  const polygon = ee.Geometry.Polygon([coordinates.map(([lat, lon]) => [lon, lat])]);
  const areaM2 = ee.Number(polygon.area(1));
  const corners = ee.List(polygon.bounds().coordinates().get(0));
  const xs = corners.map((p: any) => ee.List(p).get(0));
  const ys = corners.map((p: any) => ee.List(p).get(1));
  const minx = ee.Number(xs.reduce(ee.Reducer.min()));
  const maxx = ee.Number(xs.reduce(ee.Reducer.max()));
  const miny = ee.Number(ys.reduce(ee.Reducer.min()));
  const maxy = ee.Number(ys.reduce(ee.Reducer.max()));
  const latitude = miny.add(maxy).divide(2).multiply(Math.PI / 180);
  const width = maxx.subtract(minx).multiply(111320).multiply(latitude.cos());
  const height = maxy.subtract(miny).multiply(111320);
  const initialScale = areaM2.divide(cap).sqrt().ceil()
    .max(index === "ndmi" ? 20 : 10)
    .max(width.multiply(height).divide(cap).sqrt().ceil());
  const cells = (scale: any) => width.divide(scale).ceil().max(1)
    .multiply(height.divide(scale).ceil().max(1));
  // Same smallest integer scale as the former JS increment loop, without
  // downloading geometry first. Binary search is bounded even for long parcels.
  const upper = initialScale.max(width.max(height).divide(Math.max(1, Math.floor(Math.sqrt(cap)))).ceil());
  const interval = ee.List(ee.List.sequence(0, 31).iterate((_step: any, state: any) => {
    const pair = ee.List(state), low = ee.Number(pair.get(0)), high = ee.Number(pair.get(1));
    const middle = low.add(high).divide(2).floor();
    return ee.Algorithms.If(cells(middle).lte(cap),
      ee.List([low, middle]), ee.List([middle.add(1), high]));
  }, ee.List([initialScale, upper])));
  const scale = ee.Number(interval.get(0));
  const cols = width.divide(scale).ceil().max(1), rows = height.divide(scale).ceil().max(1);
  const dx = maxx.subtract(minx).divide(cols), dy = maxy.subtract(miny).divide(rows);
  const transform = ee.List([dx, 0, minx, 0, dy.multiply(-1), maxy]);
  const mask = ee.Image.constant(0).paint(ee.FeatureCollection([ee.Feature(polygon)]), 1);
  const aligned = (image: any) => {
    const scl = image.select("SCL");
    const visible = scl.neq(3).and(scl.neq(8)).and(scl.neq(9)).and(scl.neq(10)).and(scl.neq(11));
    const value = expression(index, image.updateMask(visible).resample("bicubic")).image;
    return value.toFloat().updateMask(mask).reproject({ crs: "EPSG:4326", crsTransform: transform });
  };
  let collection = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED").filterBounds(polygon);
  if (options.candidateImageIds) {
    const ids = ee.List(options.candidateImageIds);
    collection = collection.filter(ee.Filter.inList("system:index", ids))
      .map((image: any) => image.set("_priority", ids.indexOf(image.get("system:index"))))
      .sort("_priority");
  } else if (options.imageId) {
    collection = collection.filter(ee.Filter.eq("system:index", options.imageId));
  } else {
    const end = options.dateTo ? new Date(options.dateTo) : new Date();
    const start = options.dateFrom ? new Date(options.dateFrom)
      : new Date(end.getTime() - (options.daysBack ?? 30) * 86400000);
    if (options.specificDate) {
      start.setTime(Date.parse(options.specificDate) - 86400000);
      end.setTime(Date.parse(options.specificDate) + 86400000);
    } else if (options.dateTo) end.setUTCDate(end.getUTCDate() + 1);
    collection = collection.filterDate(start.toISOString(), end.toISOString())
      .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", options.maxCloudPct ?? 20))
      .sort("system:time_start", false);
  }
  const band = index.toUpperCase();
  let usable = collection;
  if (options.candidateImageIds) {
    usable = collection.map((image: any) => image.set("_observable_pixels",
      aligned(image).reduceRegion({
        reducer: ee.Reducer.count(), geometry: polygon.bounds(),
        crs: "EPSG:4326", crsTransform: transform, maxPixels: Math.ceil(cap) * 4,
      }).get(band))).filter(ee.Filter.gte("_observable_pixels", 9));
  }
  if (options.previous) {
    const latestTime = ee.Algorithms.If(usable.size().gt(0),
      ee.Image(usable.first()).get("system:time_start"), 0);
    usable = usable.filterDate("1970-01-01", ee.Date(latestTime).format("YYYY-MM-dd"));
  }
  // If none reaches the nine-pixel operational threshold, inspect one real
  // candidate so the caller can distinguish clouds from a narrow boundary.
  const chosen = ee.Image(ee.Algorithms.If(usable.size().gt(0), usable.first(), collection.first()));
  const region = ee.Geometry.Rectangle(ee.List([
      minx.add(dx.multiply(.01)), miny.add(dy.multiply(.01)),
      maxx.subtract(dx.multiply(.01)), maxy.subtract(dy.multiply(.01)),
    ]), null, false);
  const sampled = aligned(chosen).unmask(-9999, false).sampleRectangle({ region, defaultValue: -9999 });
  const scl = chosen.select("SCL");
  const cloudFlags = scl.eq(3).or(scl.eq(8)).or(scl.eq(9)).or(scl.eq(10)).or(scl.eq(11))
    .reproject({ crs: "EPSG:4326", crsTransform: transform })
    .unmask(-1, false).sampleRectangle({ region, defaultValue: -1 });
  const output = ee.Feature(ee.Algorithms.If(collection.size().gt(0),
    ee.Feature(null, {
      values: sampled.get(band), cloudMask: cloudFlags.get("SCL"), areaM2,
      bbox: ee.Dictionary({ minx, miny, maxx, maxy }), rows, cols, scaleM: scale,
      timestamp: chosen.get("system:time_start"), cloud: chosen.get("CLOUDY_PIXEL_PERCENTAGE"),
      imageId: chosen.get("system:index"),
    }),
    ee.Feature(null, { unavailable: "no-images" }),
  ));
  const feature: any = await new Promise((resolve, reject) =>
    output.evaluate((result: any, error: any) => error ? reject(error) : resolve(result)));
  const data = feature?.properties;
  if (data?.unavailable === "no-images") throw new Error("No hay imágenes Sentinel-2 disponibles para los criterios indicados.");
  if (data?.unavailable) throw new Error("Todos los píxeles del índice son inválidos (nubes/sombras). Prueba con otra fecha.");
  const raw = data?.values;
  if (!Array.isArray(raw) || !raw.length || !Array.isArray(raw[0]))
    throw new Error("Earth Engine devolvió una matriz vacía para el índice.");
  if (raw.length !== data.rows || raw.some((row: unknown[]) => row.length !== data.cols))
    throw new Error("El satélite devolvió una malla desalineada; no se generó un mapa aproximado.");
  let valid = 0, vmin = Infinity, vmax = -Infinity;
  const values = raw.map((row: unknown[]) => row.map(value => {
    if (typeof value !== "number" || !Number.isFinite(value) || value === -9999) return null;
    valid++; vmin = Math.min(vmin, value); vmax = Math.max(vmax, value); return value;
  }));
  if (!valid) {
    const confirmedClouds = Array.isArray(data.cloudMask) && data.cloudMask.some((row: number[]) => row.some(v => v === 1));
    throw new Error(confirmedClouds
      ? "Todos los píxeles del índice son inválidos por nubes/sombras verificadas. Prueba con otra fecha."
      : "No hay cobertura observable suficiente sobre el polígono; no se confirma nubosidad.");
  }
  return {
    values, bbox: data.bbox, vmin, vmax, imageId: data.imageId,
    imageDate: new Date(data.timestamp).toISOString().slice(0, 10), indexType: index.toLowerCase(),
    scaleM: data.scaleM, rows: data.rows, cols: data.cols, validPixels: valid,
    cloudyPixelPercentage: typeof data.cloud === "number" ? data.cloud : null,
    cloudMask: Array.isArray(data.cloudMask) ? data.cloudMask.map((row: number[]) =>
      row.map(v => v === 0 || v === 1 ? v : null)) : undefined,
  };
}

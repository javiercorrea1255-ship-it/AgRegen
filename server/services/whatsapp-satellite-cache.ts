import { createHash } from "node:crypto";
import type { Parcel } from "@shared/schema";
import {
  getAvailableSentinelImages, getIndexRaster,
  type IndexRasterResult, type SentinelImageInfo,
} from "./earth-engine";

const ttl = 30 * 60_000;
type Slot<T> = { until: number; value: Promise<T> };
const catalogues = new Map<string, Slot<SentinelImageInfo[]>>();
const rasters = new Map<string, Slot<IndexRasterResult | null>>();
const activeMaps = new Map<string, number>();
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const parcelKey = (parcel: Parcel) => hash([parcel.userId, parcel.id, parcel.polygonCoordinates]);
export const mapTraceId = (providerMessageId: string) => hash(providerMessageId).slice(0, 16);
export type MapStage = "catalogue" | "raster" | "previous" | "png" | "model" | "send";
type Wait = <T>(work: Promise<T>) => Promise<T>;

export function recordMapStage(requestId: string, stage: MapStage, started: number, success: boolean,
  extra: { cacheHit?: boolean; skipped?: boolean } = {}): void {
  console.info("[whatsapp] map stage", {
    requestId, stage, durationMs: Math.max(0, Date.now() - started), success, ...extra,
  });
}
export async function timeMapStage<T>(requestId: string, stage: MapStage, work: () => Promise<T>,
  extra: { cacheHit?: boolean } = {}): Promise<T> {
  const started = Date.now();
  let success = false;
  try { const result = await work(); success = true; return result; }
  finally { recordMapStage(requestId, stage, started, success, extra); }
}
function remember<T>(cache: Map<string, Slot<T>>, key: string, work: () => Promise<T>): Slot<T> {
  const slot = { until: Date.now() + ttl, value: Promise.resolve().then(work) };
  cache.set(key, slot);
  slot.value.catch(() => { if (cache.get(key) === slot) cache.delete(key); });
  if (cache.size > 200) cache.delete(cache.keys().next().value!);
  return slot;
}
export function clearWhatsappSatelliteCache(): void {
  catalogues.clear(); rasters.clear();
}
export function isSatelliteMapActive(parcel: Parcel): boolean {
  return (activeMaps.get(parcelKey(parcel)) || 0) > 0;
}
export function beginSatelliteMap(parcel: Parcel): () => void {
  const key = parcelKey(parcel);
  activeMaps.set(key, (activeMaps.get(key) || 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = (activeMaps.get(key) || 1) - 1;
    if (remaining) activeMaps.set(key, remaining);
    else activeMaps.delete(key);
  };
}
export async function sharedSatelliteCatalogue(parcel: Parcel, from: Date, to: Date,
  requestId: string, wait: Wait = work => work): Promise<SentinelImageInfo[]> {
  // Date-level keys let a background refresh share the map's 30-minute cache.
  const key = hash([parcelKey(parcel), from.toISOString().slice(0, 10), to.toISOString().slice(0, 10)]);
  let slot = catalogues.get(key);
  const cacheHit = Boolean(slot && slot.until > Date.now());
  if (!cacheHit) slot = remember(catalogues, key, () =>
    getAvailableSentinelImages({ coordinates: parcel.polygonCoordinates as [number, number][] }, 1, {
      allowSynthetic: false, dateFrom: from.toISOString(), dateTo: to.toISOString(),
    }));
  return timeMapStage(requestId, "catalogue", () => wait(slot!.value), { cacheHit });
}
export async function sharedSatelliteRaster(parcel: Parcel, index: string,
  options: NonNullable<Parameters<typeof getIndexRaster>[2]>, requestId: string,
  stage: "raster" | "previous" = "raster", wait: Wait = work => work): Promise<IndexRasterResult | null> {
  const keyFor = (selection: unknown) => hash([parcelKey(parcel), index, selection]);
  const key = keyFor(options);
  let slot = rasters.get(key);
  const cacheHit = Boolean(slot && slot.until > Date.now());
  if (!cacheHit) {
    slot = remember(rasters, key, async () => {
      if (!options.previous && options.candidateImageIds?.length) {
        const first = rasters.get(keyFor({
          imageId: options.candidateImageIds[0], northUpGrid: true, targetMaxPixels: 2500,
        }));
        if (first && first.until > Date.now()) {
          try {
            const known = await first.value;
            if (known && known.validPixels >= 9) return known;
          } catch { /* A failed refresh is not a cached substitute for real data. */ }
        }
      }
      const result = await getIndexRaster(
        { coordinates: parcel.polygonCoordinates as [number, number][] }, index, options);
      if (!result) { if (rasters.get(key) === slot) rasters.delete(key); return null; }
      // A server-selected scene can subsequently be reused by exact image ID.
      if (result.imageId && rasters.get(key) === slot) rasters.set(keyFor({
        imageId: result.imageId, northUpGrid: true, targetMaxPixels: 2500,
      }), { until: Date.now() + ttl, value: Promise.resolve(result) });
      if (rasters.size > 200) rasters.delete(rasters.keys().next().value!);
      return result;
    });
  }
  return timeMapStage(requestId, stage, () => wait(slot!.value), { cacheHit });
}

import type { Parcel, ParcelData } from "@shared/schema";
import type { IStorage } from "../storage";
import { isGEEAvailable } from "./earth-engine";
import { analyzeSatelliteRaster } from "./whatsapp-satellite-math";
import {
  clearWhatsappSatelliteCache, isSatelliteMapActive, mapTraceId,
  sharedSatelliteCatalogue, sharedSatelliteRaster,
} from "./whatsapp-satellite-cache";

const day = 86400000;
const jobs = new Map<string, { until: number; running: Promise<void> }>();
export function clearWhatsappSatelliteRefresh() { jobs.clear(); clearWhatsappSatelliteCache(); }
export async function waitForWhatsappSatelliteRefresh() {
  await Promise.all(Array.from(jobs.values()).map(job => job.running));
}

/** Fire and forget: never place this promise in the current card's critical path. */
export function scheduleWhatsappSatelliteRefresh(storage: IStorage, parcel: Parcel,
  observations: ParcelData[], now = new Date()): void {
  if (isSatelliteMapActive(parcel)) return;
  const latest = observations.filter(p => p.ndvi != null && Number.isFinite(Number(p.ndvi)))
    .map(p => new Date(p.date).getTime()).filter(t => Number.isFinite(t) && t <= now.getTime())
    .sort((a, b) => b - a)[0];
  if (latest != null && now.getTime() - latest <= 10 * day) return;
  const coordinates = parcel.polygonCoordinates as [number, number][];
  if (!Array.isArray(coordinates) || coordinates.length < 3 || !isGEEAvailable()) return;
  const key = JSON.stringify([parcel.userId, parcel.id, coordinates]);
  if ((jobs.get(key)?.until || 0) > Date.now()) return;
  let expired = false;
  const run = async () => {
    const requestId = `refresh-${mapTraceId(`${parcel.id}:${now.toISOString()}`)}`;
    const scenes = (await sharedSatelliteCatalogue(parcel, new Date(now.getTime() - 30 * day), now, requestId))
      .filter(s => !s.id.startsWith("mock_") && Number.isFinite(Date.parse(s.date))
        && Date.parse(s.date) <= now.getTime() && now.getTime() - Date.parse(s.date) <= 30 * day)
      .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
    const fresh: { date: string; ndvi: number; imageId: string }[] = [];
    for (const scene of scenes) {
      if (expired || isSatelliteMapActive(parcel)) return;
      try {
        const raster = await sharedSatelliteRaster(parcel, "ndvi", {
          imageId: scene.id, northUpGrid: true, targetMaxPixels: 2500,
        }, requestId);
        if (!raster || raster.imageDate !== scene.date || raster.indexType !== "ndvi" || raster.validPixels < 9) continue;
        const summary = analyzeSatelliteRaster(raster, coordinates, "ndvi");
        fresh.push({ date: summary.imageDate, ndvi: summary.mean, imageId: scene.id });
      } catch (error) {
        if (!/píxeles|nubes|sombras|fully masked/i.test(String(error))) throw error;
      }
    }
    if (!expired && fresh.length) await storage.saveWhatsappSatelliteSeries(parcel.userId, parcel.id, coordinates, fresh);
  };
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { expired = true; reject(new Error("satellite refresh timeout")); }, 60000);
    timer.unref?.();
  });
  // A timeout disables persistence by expiring this generation; the provider may
  // still finish its HTTP operation, so guard the storage writer below as well.
  const job = { until: Date.now() + 30 * 60 * 1000, running: Promise.resolve() };
  jobs.set(key, job);
  job.running = Promise.race([run(), deadline]).catch(() => {
    console.warn("[whatsapp] satellite context refresh unavailable; retained existing observations");
  }).finally(() => { clearTimeout(timer); });
  if (jobs.size > 1000) for (const [oldKey, old] of Array.from(jobs.entries())) {
    if (old.until < Date.now()) jobs.delete(oldKey);
  }
}

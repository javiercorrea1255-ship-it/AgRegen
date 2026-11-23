import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { join } from "node:path";
import type { Parcel } from "@shared/schema";
import type { IStorage } from "../storage";
import { isGEEAvailable, type IndexRasterResult } from "./earth-engine";
import { ObjectStorageService } from "../replit_integrations/object_storage/objectStorage";
import { analyzeSatelliteRaster, parcelPolygon, satelliteCropAlert, type SatelliteRequest, type SatelliteSummary } from "./whatsapp-satellite-math";
import { area } from "@turf/turf";
import { recordWhatsappMetric } from "./whatsapp-metrics";
import {
  beginSatelliteMap, clearWhatsappSatelliteCache, mapTraceId,
  sharedSatelliteCatalogue, sharedSatelliteRaster, timeMapStage, recordMapStage,
} from "./whatsapp-satellite-cache";

export type SatelliteArtifact = {
  cacheKey: string; objectPath: string; summary: SatelliteSummary; imageId: string;
  previousImageId: string | null; compare: boolean; name: string; byteLength: number;
  candidateSignature: string;
  renderKey: string;
};
export class SatelliteUnavailable extends Error {}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const day = 86400000;
export function clearSatelliteCatalogueCache() { clearWhatsappSatelliteCache(); }
export function renderSatellitePng(data: unknown): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("python", [join(process.cwd(), "geo-service/whatsapp_satellite_map.py")],
      { stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let errorText = "", size = 0;
    const timer = setTimeout(() => { child.kill(); reject(new Error("El PNG tardó demasiado.")); }, 15000);
    child.stdout.on("data", chunk => {
      size += chunk.length;
      if (size > 5_000_000) { child.kill(); reject(new Error("El mapa excedió el tamaño permitido.")); }
      else chunks.push(chunk);
    });
    child.stderr.on("data", chunk => { errorText = (errorText + chunk.toString()).slice(-2000); });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.stdin.on("error", () => { /* process exit is handled below */ });
    child.on("close", code => {
      clearTimeout(timer);
      const png = Buffer.concat(chunks);
      if (code !== 0 || png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a")
        reject(new Error(`No se pudo generar el PNG: ${errorText}`));
      else resolve(png);
    });
    child.stdin.end(JSON.stringify(data));
  });
}
export async function readSatellitePng(artifact: SatelliteArtifact): Promise<Buffer> {
  const file = await new ObjectStorageService().getObjectEntityFile(artifact.objectPath);
  const [buffer] = await file.download();
  return buffer;
}
const obscuredRaster = (error: unknown) =>
  /píxeles|matriz vacía|nubes|sombras|fully masked|outside of the image footprint/i.test(String(error));

function satelliteFailureMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (/cobertura observable/i.test(text))
    return "No hay suficientes lecturas sobre el contorno de la parcela para generar el mapa. No se confirmó que sean nubes; prueba otra fecha o pide una revisión en campo.";
  if (obscuredRaster(error))
    return "Las nubes, sombras o falta de cobertura no dejan ver tu parcela. Intenta con otra fecha o en unos días.";
  if (/no hay im[aá]genes|no images|empty collection/i.test(text))
    return "No hay una imagen satelital reciente disponible para tu parcela. Intenta en unos días.";
  if (/pequeñ|too small/i.test(text))
    return "Tu parcela es demasiado pequeña para distinguir zonas con este satélite. Pide una revisión en campo.";
  if (/tiempo de espera|timeout|timed out|deadline/i.test(text))
    return "El servicio satelital tardó demasiado y no terminó la consulta. Intenta de nuevo más tarde.";
  if (/imagen no verificable|malla desalineada/i.test(text))
    return "El servicio satelital devolvió una imagen que no se pudo verificar. Intenta con otra fecha.";
  return "El servicio satelital no está disponible para completar la consulta. Intenta más tarde.";
}

/** Uses the same raster for the rendered map and the model's interpretation. */
export async function prepareWhatsappSatelliteMap(options: {
  storage: IStorage; parcel: Parcel; request: SatelliteRequest; now?: Date;
  onIntent: (objectId: string) => Promise<void>;
  onSlow?: () => Promise<void>;
  render?: typeof renderSatellitePng;
  requestId?: string;
  referenceSummary?: SatelliteSummary | null;
}): Promise<SatelliteArtifact> {
  const started = Date.now();
  const requestId = options.requestId || mapTraceId(`${options.parcel.id}:${started}`);
  const releaseMap = beginSatelliteMap(options.parcel);
  let success = false, slowPromise: Promise<void> | undefined;
  const timer = setTimeout(() => {
    slowPromise = options.onSlow?.();
    slowPromise?.catch(() => { /* delivery uncertainty is rethrown before returning */ });
  }, 4000);
  const withinDeadline = <T>(work: Promise<T>): Promise<T> => new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error("El servicio satelital agotó el tiempo de espera.")),
      Math.max(1, 45000 - (Date.now() - started)));
    work.then(resolve, reject).finally(() => clearTimeout(deadline));
  });
  try {
    const { parcel, request, storage } = options;
    const withLedgerReference = async (input: SatelliteSummary): Promise<SatelliteSummary> => {
      const summary = { ...input };
      summary.agronomicAlert = satelliteCropAlert(parcel, summary);
      delete summary.reference;
      if (summary.change) return summary;
      const references = options.referenceSummary !== undefined ? [options.referenceSummary]
        : (await storage.getActiveFieldLogs?.(parcel.userId, parcel.id) || []).map(entry => {
          const data = entry.structuredData as any;
          return data?.source === "satellite" ? data.satellite as SatelliteSummary : null;
        });
      const reference = references.filter((s): s is SatelliteSummary => !!s &&
        s.index === request.index && Number.isFinite(s.mean) &&
        Number.isFinite(Date.parse(s.imageDate)) && s.imageDate < summary.imageDate)
        .sort((a, b) => b.imageDate.localeCompare(a.imageDate))[0];
      if (reference) summary.reference = {
        imageDate: reference.imageDate, mean: reference.mean, source: "ledger", spatialComparison: false,
      };
      return summary;
    };
    const coordinates = parcel.polygonCoordinates as [number, number][] | null;
    if (!Array.isArray(coordinates) || coordinates.length < 3 ||
      coordinates.some(c => !Array.isArray(c) || c.length < 2 || !c.every(Number.isFinite))) {
      throw new SatelliteUnavailable("Tu parcela no tiene un contorno válido. Pide al técnico que lo dibuje en AgRegen.");
    }
    if (!isGEEAvailable()) throw new SatelliteUnavailable("El servicio satelital no está disponible. Intenta más tarde; no usaré datos simulados.");
    const native = request.index === "ndmi" ? 20 : 10;
    const ys = coordinates.map(c => c[0]), xs = coordinates.map(c => c[1]);
    const width = (Math.max(...xs) - Math.min(...xs)) * 111320 * Math.cos(parcel.latitude ? Number(parcel.latitude) * Math.PI / 180 : 0);
    const height = (Math.max(...ys) - Math.min(...ys)) * 111320;
    if (area(parcelPolygon(coordinates)) < native * native * 9 || Math.min(width, height) < native * 2)
      throw new SatelliteUnavailable(`La parcela es demasiado pequeña para ubicar zonas con ${request.index.toUpperCase()}. Pide una revisión en campo al técnico.`);
    const now = options.now || new Date();
    const requestedDate = request.date ? new Date(`${request.date}T00:00:00Z`) : null;
    if (requestedDate && (!Number.isFinite(requestedDate.getTime()) ||
      requestedDate.toISOString().slice(0, 10) !== request.date || requestedDate > now))
      throw new SatelliteUnavailable("La fecha pedida no es válida o aún no ocurre. Pide una fecha pasada.");
    const comparisonDate = request.compare && request.comparisonDate
      ? new Date(`${request.comparisonDate}T00:00:00Z`) : null;
    if (comparisonDate && (!Number.isFinite(+comparisonDate) ||
      comparisonDate.toISOString().slice(0, 10) !== request.comparisonDate || comparisonDate > now))
      throw new SatelliteUnavailable("La segunda fecha pedida no es válida o aún no ocurre.");
    const from = new Date(Math.min(+(requestedDate || now), +(comparisonDate || requestedDate || now)) - 30 * day);
    const to = new Date(Math.min(+now, Math.max(+(requestedDate || now), +(comparisonDate || requestedDate || now)) + (requestedDate ? 31 * day : 0)));
    const scenes = (await sharedSatelliteCatalogue(parcel, from, to, requestId, withinDeadline))
      .filter(s => s.id && !s.id.startsWith("mock_") &&
      Number.isFinite(Date.parse(s.date))).sort((a, b) => Date.parse(b.date) - Date.parse(a.date) || a.id.localeCompare(b.id));
    const candidates = scenes.filter(s => requestedDate
      ? Math.abs(Date.parse(s.date) - +requestedDate) <= 30 * day
      : now.getTime() - Date.parse(s.date) <= 30 * day);
    if (requestedDate) candidates.sort((a, b) =>
      Math.abs(Date.parse(a.date) - requestedDate.getTime()) - Math.abs(Date.parse(b.date) - requestedDate.getTime()));
    if (!candidates.length) throw new SatelliteUnavailable(requestedDate
      ? "No hay imagen disponible cerca de esa fecha (±30 días). Pide otra fecha."
      : "No hay imagen utilizable en los últimos 30 días. Intenta en unos días o pide una revisión en campo.");
    const ids = candidates.map(s => s.id);
    const comparisonIds = comparisonDate ? scenes.filter(s => Math.abs(Date.parse(s.date) - +comparisonDate) <= 30 * day)
      .sort((a, b) => Math.abs(Date.parse(a.date) - +comparisonDate) - Math.abs(Date.parse(b.date) - +comparisonDate))
      .map(s => s.id) : [];
    const cacheKey = hash(["satellite-v5", parcel.userId, parcel.id, coordinates, parcel.name,
      request.index, request.compare, request.date, request.comparisonDate, ids, comparisonIds]);
    const signature = hash([ids, comparisonIds]);
    const renderKeyFor = (imageId: string, previousId: string | null) => hash([
      "satellite-png-v3", parcel.userId, parcel.id, coordinates, parcel.name, request.index,
      request.compare, imageId, request.compare ? previousId : null,
    ]);
    const artifact = await storage.getWhatsappMapArtifact(parcel.userId, parcel.id, cacheKey) as SatelliteArtifact | undefined;
    if (artifact && artifact.candidateSignature === signature && (!request.compare || artifact.compare)) {
      recordMapStage(requestId, "raster", Date.now(), true, { cacheHit: true });
      recordMapStage(requestId, "previous", Date.now(), true, { skipped: !artifact.compare, cacheHit: true });
      recordMapStage(requestId, "png", Date.now(), true, { cacheHit: true });
      await readSatellitePng(artifact); success = true;
      return { ...artifact, cacheKey, summary: await withLedgerReference(artifact.summary) };
    }
    const load = async (previous: boolean) => {
      const limit = previous ? <T>(work: Promise<T>) => new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("La comparación agotó el tiempo de espera.")), 15_000);
        withinDeadline(work).then(resolve, reject).finally(() => clearTimeout(timer));
      }) : withinDeadline;
      const raster = await sharedSatelliteRaster(parcel, request.index, {
        candidateImageIds: previous && comparisonDate ? comparisonIds : ids,
        previous: previous && !comparisonDate, northUpGrid: true, targetMaxPixels: 2500,
      }, requestId, previous ? "previous" : "raster", limit);
      const scene = scenes.find(s => s.id === raster?.imageId);
      if (!raster || !scene || raster.imageDate !== scene.date || raster.indexType !== request.index)
        throw new Error("Imagen no verificable.");
      if (raster.validPixels < 9) {
        if (raster.cloudMask?.some(row => row.some(v => v === 1)))
          throw new Error("No hay suficientes píxeles observables por nubes o sombras verificadas.");
        throw new SatelliteUnavailable("Hay menos de 9 píxeles útiles sobre el contorno: el borde o la resolución no permiten ubicar zonas. Prueba otra fecha o pide una revisión en campo.");
      }
      return raster;
    };
    // Both requests start together. Optional history never invalidates a good current image.
    const currentWork = load(false);
    const canCompare = request.compare && (comparisonDate ? comparisonIds.length > 0
      : new Set(candidates.map(s => s.date)).size > 1);
    if (!canCompare) recordMapStage(requestId, "previous", Date.now(), true, { skipped: true });
    const previousWork = canCompare ? load(true).catch(error => {
      console.info("[whatsapp] map comparison unavailable", { requestId,
        reason: /tiempo|timeout/i.test(String(error)) ? "timeout" : "not-observable" });
      return null;
    }) : Promise.resolve(null);
    let raster = await currentWork;
    let previous = await previousWork;
    if (previous && previous.imageDate === raster.imageDate) previous = null;
    if (previous && previous.imageDate > raster.imageDate) [raster, previous] = [previous, raster];
    let summary = analyzeSatelliteRaster(raster, coordinates, request.index, previous);
    if (previous && (!summary.change || summary.change.comparedPct < 10)) {
      previous = null;
      summary = analyzeSatelliteRaster(raster, coordinates, request.index);
    }
    if (!previous) {
      summary = await withLedgerReference(summary);
    }
    summary.agronomicAlert = satelliteCropAlert(parcel, summary);
    const objectId = hash([cacheKey, raster.imageId, previous?.imageId]);
    const renderKey = renderKeyFor(raster.imageId!, previous?.imageId || null);
    const sameImage = await storage.getWhatsappMapArtifact(parcel.userId, parcel.id, renderKey) as SatelliteArtifact | undefined;
    if (sameImage) {
      recordMapStage(requestId, "png", Date.now(), true, { cacheHit: true });
      await readSatellitePng(sameImage); success = true;
      return { ...sameImage, cacheKey, summary, previousImageId: previous?.imageId || null,
        candidateSignature: signature };
    }
    // Persist intent in the assistant message BEFORE writing a private blob.
    await options.onIntent(objectId);
    const buffer = await timeMapStage(requestId, "png", () =>
      (options.render || renderSatellitePng)({ raster, summary, previous,
        compare: request.compare && !!previous, coordinates, name: parcel.name }));
    const objectPath = await new ObjectStorageService().savePrivateBuffer({
      ownerId: parcel.userId, buffer, contentType: "image/png",
      namespace: "whatsapp-satellite", extension: "png", objectId,
    });
    success = true;
    return { cacheKey, objectPath, summary, imageId: raster.imageId!,
      previousImageId: previous?.imageId || null, compare: request.compare && !!previous, name: parcel.name,
      byteLength: buffer.length, candidateSignature: signature, renderKey };
  } catch (error) {
    if (error instanceof SatelliteUnavailable) throw error;
    console.error("[whatsapp] satellite map unavailable", error instanceof Error ? error.message : "unknown");
    throw new SatelliteUnavailable(satelliteFailureMessage(error));
  } finally {
    clearTimeout(timer);
    recordWhatsappMetric({ stage: "map", durationMs: Date.now() - started, success });
    try { if (slowPromise) await slowPromise; }
    finally { releaseMap(); }
  }
}

export function satelliteCaption(artifact: SatelliteArtifact, interpretation: string,
  detailed: boolean, now = new Date()): string {
  const s = artifact.summary, places = (v: string[]) => (detailed ? v : v.slice(0, 1)).join(" y ");
  const changes = s.change ? [
    `Desde ${s.previousDate}: en conjunto ${s.change.direction}`,
    s.change.improvedLocations?.length ? `mejoró en ${places(s.change.improvedLocations)}` : "",
    s.change.declinedLocations?.length ? `bajó en ${places(s.change.declinedLocations)}` : "",
  ].filter(Boolean).join("; ") + "." : s.reference
    ? `Antecedente de bitácora del ${s.reference.imageDate}: promedio ${s.reference.mean}. Sin comparación por zonas.`
    : "Sin imagen anterior comparable.";
  const lines = [
    `${s.imageDate} · ${s.index.toUpperCase()}: ${s.index === "ndvi" ? `vigor ${s.level}` : `humedad foliar ${s.level.replace(/o$/, "a")}`}, promedio ${s.mean}.`,
    `Bajo ${s.percentages.low}% (${s.lowHa} ha); medio ${s.percentages.medium}%; alto ${s.percentages.high}%.`,
    `Débil: ${places(s.weakLocations) || "sin zonas bajas detectadas"}.`,
    changes,
  ];
  if ((now.getTime() - Date.parse(s.imageDate)) / day > 10) lines.push("Aviso: imagen de más de 10 días.");
  if (s.coverage?.edgePct) lines.push(`Borde sin lectura por cobertura parcial del píxel: ${s.coverage.edgePct}% (no son nubes).`);
  if (s.coverage?.cloudPct) lines.push(`Nubes/sombras verificadas: ${s.coverage.cloudPct}%.`);
  if (s.percentages.unseen > 0) lines.push(`Sin ver ${s.percentages.unseen}%: ${places(s.unseenLocations)}${s.coverage ? "; incluye solo zonas no observadas, no el borde" : "; causa no determinada"}.`);
  if (s.agronomicAlert) lines.push(s.agronomicAlert);
  if (s.change && s.change.comparedPct < 99) lines.push(`Cambio calculado solo en ${s.change.comparedPct}% visible en ambas fechas.`);
  if (interpretation) {
    if (s.imageDate < now.toISOString().slice(0, 10))
      lines.push("Hipótesis con contexto actual: los hechos posteriores no explican el estado de esa imagen.");
    lines.push(interpretation);
  }
  return lines.join("\n");
}

/** Only call AFTER Meta has confirmed image delivery (including durable sent replays). */
export async function recordSentSatelliteMap(storage: IStorage, userId: string, parcelId: string,
  inboundId: string, artifact: SatelliteArtifact): Promise<void> {
  await storage.saveAutomaticFieldLog({
    userId, parcelId, sourceProviderMessageId: `${inboundId}:satellite`,
    originalText: `Mapa ${artifact.summary.index.toUpperCase()} enviado por WhatsApp`,
    activityType: "observación satelital", occurredAt: new Date(`${artifact.summary.imageDate}T12:00:00Z`),
    structuredData: { registration: "automatic", source: "satellite", satellite: artifact.summary,
      mapMode: artifact.compare ? "change" : "index",
      observations: satelliteCaption(artifact, "", false),
      items: [{ category: "observation", name: `Mapa ${artifact.summary.index.toUpperCase()}`,
        quantity: null, unit: null, cost: null, currency: "MXN" }] },
    confidence: 1, missingFields: [],
    evidence: [{ kind: "image", path: artifact.objectPath, mimeType: "image/png", size: artifact.byteLength }],
  });
}

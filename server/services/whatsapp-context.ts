import type { IStorage } from "../storage";
import type { Parcel, FieldLogEntry } from "@shared/schema";
import { getFullWeatherData, getRecentObservedWeather } from "./weather";
import { getSniimPrice } from "./market-prices";
import { projectParcelCosts, summarizeParcelEconomy, producerPriceHistory, previousHarvests } from "./parcel-economy";
import { getParcelClimatology } from "./parcel-climatology";
import { scheduleWhatsappSatelliteRefresh } from "./whatsapp-satellite-refresh";
import { distinctSoilAnalyses, soilEvidence, microbiologyEvidence, validAgronomicAlerts, latestLabMicrobiology } from "@shared/agronomic-evidence";
import { fieldLogOccurredOn } from "@shared/field-log-policy";
import { costAreaEvidence } from "./cost-area-evidence";
import { fertilizationFingerprint, type SavedFertilizationPlan } from "./fertilization-plan-memory";

const WEATHER_TTL = 30 * 60 * 1000;
const weatherCache = new Map<string, { expires: number; value: Promise<unknown> }>();
const marketCache = new Map<string, { expires: number; value: Promise<any> }>();
const blockCache = new Map<string, string>();

export function clearWhatsappWeatherCache() { weatherCache.clear(); marketCache.clear(); blockCache.clear(); }

function limited<T>(work: Promise<T>, ms: number): Promise<T | null> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), ms);
    work.then(resolve, () => resolve(null)).finally(() => clearTimeout(timer));
  });
}
function cachedMarket(parcel: Parcel) {
  const key = `${parcel.crop}:${parcel.location}`;
  const prior = marketCache.get(key);
  if (prior && prior.expires > Date.now()) return prior.value;
  const value = limited(getSniimPrice(parcel.crop, parcel.location || ""), 3000);
  marketCache.set(key, { expires: Date.now() + WEATHER_TTL, value });
  if (marketCache.size > 500) marketCache.delete(marketCache.keys().next().value!);
  return value;
}

function cachedWeather(parcel: Parcel): Promise<any> {
  const key = `${parcel.id}:${parcel.latitude}:${parcel.longitude}`;
  const cached = weatherCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  const lat = Number(parcel.latitude), lon = Number(parcel.longitude);
  if (parcel.latitude == null || parcel.longitude == null ||
      !Number.isFinite(lat) || !Number.isFinite(lon)) return Promise.resolve(null);
  const value = Promise.all([
    getFullWeatherData(lat, lon, parcel.plantingDate, parcel.crop,
      { includeThermal: false, signal: AbortSignal.timeout(5500) }).catch(() => null),
    getRecentObservedWeather(lat, lon).catch(() => null),
  ]).then(([weather, recent]) => ({ ...weather, recent }));
  weatherCache.set(key, { expires: Date.now() + WEATHER_TTL, value });
  // Bound cache growth without losing the current parcel.
  if (weatherCache.size > 1000) weatherCache.delete(weatherCache.keys().next().value!);
  return value;
}

function compactEntry(entry: FieldLogEntry) {
  const data = entry.structuredData as any;
  return {
    id: entry.id, date: fieldLogOccurredOn(entry) || null,
    activity: entry.activityType, origin: data?.registration || "explicit",
    items: (data?.items || []).slice(0, 6).map((item: any) => ({
      name: String(item.name || item.category || "").slice(0, 60),
      quantity: item.quantity ?? null, unit: item.unit || null,
      cost: item.cost ?? null, currency: item.currency || "MXN",
    })),
    observations: String(data?.observations || "").slice(0, 300),
  };
}

function ledgerBlock(recent: FieldLogEntry[], relevant: FieldLogEntry[]): string {
  const fit = (entries: FieldLogEntry[]) => entries.map(entry => {
    const compact = compactEntry(entry);
    return { ...compact, observations: compact.observations.slice(0, 100),
      items: compact.items.slice(0, 3) };
  });
  // Per-entry detail shrinks before dropping any of the fifteen recent records.
  let value = { recent: fit(recent), relevant: fit(relevant) };
  if (JSON.stringify(value).length > 6450) {
    value = { recent: value.recent.map(e => ({ ...e, observations: e.observations.slice(0, 30), items: e.items.slice(0, 1) })),
      relevant: value.relevant.map(e => ({ ...e, observations: e.observations.slice(0, 30), items: e.items.slice(0, 1) })) };
  }
  return boundedContextBlock("(e) Bitácora vigente: recientes y relevantes", value, 6500);
}

/** Budget each block independently: no global slice can erase the last blocks. */
export function boundedContextBlock(label: string, value: unknown, budget: number): string {
  const text = JSON.stringify(value ?? { unavailable: true });
  const key = fertilizationFingerprint([label, budget, text]);
  const cached = blockCache.get(key);
  if (cached) return cached;
  const result = `${label}\n${text.length <= budget ? text : `${text.slice(0, budget - 30)}… [detalle limitado]`}`;
  blockCache.set(key, result);
  if (blockCache.size > 500) blockCache.delete(blockCache.keys().next().value!);
  return result;
}
function compactNotes<T extends { notes: unknown }>(value: T | null, budget: number): T | null {
  if (!value || typeof value.notes !== "string" || value.notes.length <= budget) return value;
  return { ...value, notes: `${value.notes.slice(0, budget)} [observaciones limitadas]`, notesLimited: true };
}

export async function buildWhatsappParcelCard(
  storage: IStorage, parcel: Parcel, userId: string, query: string,
  history: { role: string; content: string }[],
  options: { deferSatelliteRefresh?: boolean } = {},
) {
  const [cycle, weather, alerts, soilRows, water, tissue, satellite, logs, costs, market, biology, climatology, memory] = await Promise.all([
    storage.getLatestCropCycleDetail(parcel.id),
    cachedWeather(parcel),
    storage.getAlertsByParcel(parcel.id),
    storage.getSoilAnalysisByParcel ? storage.getSoilAnalysisByParcel(parcel.id)
      : storage.getLatestSoilAnalysis(parcel.id).then(row => row ? [row] : []),
    storage.getWaterAnalysisByParcel(parcel.id),
    storage.getPlantTissueAnalysisByParcel(parcel.id),
    storage.getParcelData(parcel.id, 6),
    storage.getActiveFieldLogs(userId, parcel.id),
    storage.getProductionCostsByParcel(parcel.id),
    cachedMarket(parcel),
    storage.getSoilBiologyByParcel ? storage.getSoilBiologyByParcel(parcel.id) : Promise.resolve([]),
    parcel.latitude != null && parcel.longitude != null
      ? getParcelClimatology(Number(parcel.latitude), Number(parcel.longitude)) : Promise.resolve(null),
    storage.getParcelMemory ? storage.getParcelMemory(parcel.id, userId) : Promise.resolve(null),
  ]);
  const soils = distinctSoilAnalyses(soilRows);
  const soil = soils[0];
  const latestBiology = [...biology].sort((a, b) => +new Date(b.sampleDate) - +new Date(a.sampleDate))[0];
  const labMicrobiology = latestLabMicrobiology(biology);
  const recent = logs.slice(0, 15);
  if (!options.deferSatelliteRefresh) scheduleWhatsappSatelliteRefresh(storage, parcel, satellite);
  const tokens = query.toLocaleLowerCase("es-MX").split(/[^a-z0-9áéíóúüñ]+/i).filter(t => t.length >= 4).slice(0, 20);
  const relevant = logs.slice(15).map(entry => ({
    entry, score: tokens.reduce((n, token) =>
      n + (JSON.stringify(entry.structuredData).toLocaleLowerCase("es-MX").includes(token) ? 1 : 0), 0),
  })).filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 5).map(item => item.entry);
  const observations = satellite.slice(0, 6).map(point => ({
    date: point.date, ndvi: point.ndvi, evi: point.evi, soilMoisture: point.soilMoisture,
  }));
  const trend = (key: "ndvi" | "evi") => {
    const valid = observations.map(p => p[key]).filter(v => v != null && Number.isFinite(Number(v))).map(Number);
    return valid.length < 2 ? "sin datos suficientes"
      : valid[0] > valid[valid.length - 1] ? "sube" : valid[0] < valid[valid.length - 1] ? "baja" : "estable";
  };
  const economy = summarizeParcelEconomy(projectParcelCosts(costs, logs, cycle), cycle?.totalPlannedCost);
  const areaEvidence = costAreaEvidence(parcel.area, costs, logs);
  const planFingerprint = fertilizationFingerprint({
    parcel: [parcel.crop, parcel.area, parcel.plantingDate, parcel.phenologicalStage, parcel.irrigationSystem],
    cycle, soils: soils.map(soilEvidence), microbiology: microbiologyEvidence(labMicrobiology),
    applications: logs.filter(log => /fertiliz|abon|aplica/i.test(log.activityType || "")).map(log => log.structuredData),
  });
  const savedPlans = (memory?.fertilizationPlans || {}) as Record<string, SavedFertilizationPlan>;
  const basePlans = Object.values(savedPlans).filter(plan => plan.fingerprint === planFingerprint);
  // Image chronology, not message order, occurredAt, or a recently requested old map.
  const latestSatelliteSummary = logs.map(entry => entry.structuredData as any)
    .filter(data => data?.source === "satellite" && Number.isFinite(Date.parse(data.satellite?.imageDate)))
    .sort((a, b) => Date.parse(b.satellite.imageDate) - Date.parse(a.satellite.imageDate))[0];
  const blocks = [
    boundedContextBlock("(a) Parcela y ciclo", {
      id: parcel.id, name: parcel.name, crop: parcel.crop, location: parcel.location,
      areaHa: parcel.area, irrigation: parcel.irrigationSystem, plantingDate: parcel.plantingDate,
      stage: parcel.phenologicalStage,
      cycle: cycle ? { id: cycle.id, year: cycle.cycleYear, season: cycle.cycleSeason,
        plannedCostMXN: cycle.totalPlannedCost, expectedYieldTonHa: cycle.expectedYieldTon,
        targetPricePerTonMXN: cycle.targetPricePerTon, saleChannel: cycle.saleChannel,
        estimatedHarvestDate: cycle.estimatedHarvestDate, cycleDurationDays: cycle.cycleDurationDays } : null,
    }, 1500),
    boundedContextBlock("(b) Clima, pronóstico y alertas", {
      current: weather?.current ?? null, recent: weather?.recent ?? null,
      climatology: climatology || { unavailable: true, reason: "Archivo histórico no disponible; no inventar datos" },
      forecast: weather?.forecast?.slice(0, 5).map((d: any) => ({
        date: d.date, tempMax: d.tempMax, tempMin: d.tempMin,
        precipitation: d.precipitation, windSpeed: d.windSpeed,
      })) ?? [],
      alerts: validAgronomicAlerts(alerts, soil).filter(a => !a.actionStatus).sort((a, b) =>
        Number(/sequ[ií]a|drought/i.test(b.title + b.description)) - Number(/sequ[ií]a|drought/i.test(a.title + a.description))).slice(0, 6).map(a => ({
        severity: a.severity, title: a.title.slice(0, 60), description: a.description.slice(0, 80),
      })),
    }, 4500),
    boundedContextBlock("(c) Análisis recientes", {
      soil: compactNotes(soilEvidence(soil), 3000), previousSoil: compactNotes(soilEvidence(soils[1]), 3000),
      microbiology: compactNotes(microbiologyEvidence(labMicrobiology), 1000),
      biology: latestBiology ? { date: latestBiology.sampleDate, source: latestBiology.dataSource,
        mbc: latestBiology.mbc, mr: latestBiology.mr, bg: latestBiology.bg, nag: latestBiology.nag, dnaYield: latestBiology.dnaYield } : null,
      water: water[0] ? { date: water[0].analysisDate, ph: water[0].ph,
        ce: water[0].electricConductivity, sar: water[0].sar } : null,
      tissue: tissue[0] ? { date: tissue[0].analysisDate, nitrogen: tissue[0].nitrogen,
        phosphorus: tissue[0].phosphorus, potassium: tissue[0].potassium } : null,
    }, 12500),
    boundedContextBlock("(d) Satélite: últimas seis observaciones", {
      observations, trendNDVI: trend("ndvi"), trendEVI: trend("evi"),
      latestSentMap: latestSatelliteSummary?.satellite
        ? { ...latestSatelliteSummary.satellite, mapMode: latestSatelliteSummary.mapMode } : null,
    }, 1500),
    ledgerBlock(recent, relevant),
    boundedContextBlock("(f) Economía del ciclo y mercado", {
      ...economy, areaEvidence, paidPrices: producerPriceHistory(costs, logs),
      previousHarvests: previousHarvests(logs), market: market ? { ...market, currency: "MXN" } : null,
      baseFertilizationPlans: basePlans,
    }, 6500),
    boundedContextBlock("(g) Últimos seis mensajes", history.slice(-6).map(m => ({
      role: m.role, content: m.content.slice(0, 1800),
    })), 11500),
  ];
  return { text: blocks.join("\n\n"), cycle, logs, economy, soil, water, tissue, areaEvidence,
    planFingerprint, savedPlans,
    satelliteObservations: satellite, latestSentMap: latestSatelliteSummary?.satellite as import("./whatsapp-satellite-math").SatelliteSummary | undefined };
}

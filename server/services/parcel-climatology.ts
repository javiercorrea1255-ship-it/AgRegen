type RainDay = { date: string; rain: number };
export function summarizeClimatology(days: RainDay[]) {
  const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, totals: new Map<string, number>() }));
  const years = new Set<string>();
  for (const day of days) {
    if (!Number.isFinite(day.rain) || day.rain < 0) continue;
    const year = day.date.slice(0, 4), month = Number(day.date.slice(5, 7)) - 1;
    if (!months[month]) continue;
    years.add(year);
    months[month].totals.set(year, (months[month].totals.get(year) || 0) + day.rain);
  }
  // Explicit agronomic indicator, not a guarantee of safe sowing.
  const starts: string[] = [];
  for (const year of Array.from(years)) {
    const row = days.filter(d => d.date.startsWith(year) && d.date.slice(5) >= "04-01" && d.date.slice(5) <= "09-30");
    for (let i = 0; i < row.length - 26; i++) {
      const first = row.slice(i, i + 7), next = row.slice(i + 7, i + 27);
      if ([...first, ...next].some(d => !Number.isFinite(d.rain))) continue;
      const dry = next.map(d => d.rain < 1 ? "0" : "1").join("");
      if (first.reduce((s, d) => s + d.rain, 0) >= 25 && first.filter(d => d.rain >= 1).length >= 3 &&
          !/0{10}/.test(dry)) { starts.push(row[i].date.slice(5)); break; }
    }
  }
  const ordered = [...starts].sort();
  return { source: "Open-Meteo Historical Weather Archive", years: Array.from(years).sort(),
    monthlyRainMM: months.map(m => ({ month: m.month,
      mean: m.totals.size ? Math.round(Array.from(m.totals.values()).reduce((a, b) => a + b, 0) / m.totals.size) : null })),
    typicalRainOnset: ordered.length ? ordered[Math.floor(ordered.length / 2)] : null,
    onsetYears: starts.length,
    method: "Mediana del primer período abr-sep con ≥25 mm en 7 días y ≥3 días lluviosos, sin racha seca ≥10 días en los 20 siguientes. Indicador, no fecha garantizada de siembra." };
}
const cache = new Map<string, { expires: number; promise: Promise<ReturnType<typeof summarizeClimatology> | null> }>();
export function clearClimatologyCache() { cache.clear(); }
export function getParcelClimatology(latitude: number, longitude: number, now = new Date()) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return Promise.resolve(null);
  const year = now.getUTCFullYear(), key = `${latitude.toFixed(3)}:${longitude.toFixed(3)}:${year}`;
  const prior = cache.get(key); if (prior && prior.expires > Date.now()) return prior.promise;
  const promise = (async () => {
    for (let attempt = 0; attempt < 2; attempt++) try {
      const url = new URL("https://archive-api.open-meteo.com/v1/archive");
      url.search = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude),
        start_date: `${year - 6}-01-01`, end_date: `${year - 1}-12-31`,
        daily: "precipitation_sum", timezone: "America/Mexico_City" }).toString();
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (!response.ok) throw new Error(`Climatología HTTP ${response.status}`);
      const data = await response.json();
      if (!data.daily?.time?.length) return null;
      return summarizeClimatology(data.daily.time.map((date: string, i: number) =>
        ({ date, rain: data.daily.precipitation_sum[i] == null ? NaN : Number(data.daily.precipitation_sum[i]) })));
    } catch (error) {
      if (attempt === 1) {
        console.warn("[climatology] Historical archive unavailable", error instanceof Error ? error.message : "unknown");
        return null;
      }
    }
    return null;
  })();
  cache.set(key, { expires: Date.now() + 24 * 3600000, promise });
  void promise.then(value => { if (!value && cache.get(key)?.promise === promise)
    cache.set(key, { expires: Date.now() + 60000, promise }); });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return promise;
}
export const NEXT_CYCLE_RULES = `PLANEACIÓN: si pregunta por próximo ciclo o cultivo supuesto, separa explícitamente ese escenario de la etapa ACTUAL de la ficha; cosecha actual no es etapa del cultivo futuro.
Usa el sistema de riego ya registrado (por ejemplo temporal); no preguntes si es temporal o riego cuando la ficha lo dice, salvo que el productor anuncie un cambio para ese escenario.
Usa climatología histórica del predio (lluvia mensual, período de años e inicio típico del temporal) junto al pronóstico para ventana de siembra y manejo de humedad.
No pidas al productor cuándo suelen empezar las lluvias si hay climatología disponible. Distingue tendencia histórica, pronóstico e incertidumbre; verifica humedad del perfil antes de sembrar. Si el archivo histórico no responde dilo, no inventes lluvia ni fechas.`;

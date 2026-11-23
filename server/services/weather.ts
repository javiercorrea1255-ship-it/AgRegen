export interface ForecastDay {
  date: string;
  dayName: string;
  tempMax: number;
  tempMin: number;
  precipitation: number;
  humidity: number;
  windSpeed: number;
  weatherCode: number;
  icon: "sun" | "cloud" | "rain" | "storm" | "snow";
}

interface CurrentConditions {
  temperature: number;
  humidity: number;
  windSpeed: number;
  precipitation: number;
  weatherCode: number;
  radiation: number;
}

interface HistoricalDay {
  date: string;
  tempMax: number;
  tempMin: number;
  tempMean: number;
  precipitation: number;
}

interface GDAResult {
  accumulated: number;
  weeklyData: { week: string; gdd: number; accumulated: number }[];
  currentStage: string;
}

interface ChillingHoursResult {
  simple: number;           // horas con T ≤ 7.2°C
  utah: number;             // unidades de frío modelo Utah
  weeklyData: { week: string; simple: number; utah: number; accSimple: number; accUtah: number }[];
  seasonStart: string;      // fecha de inicio de la temporada
}

interface WeatherData {
  forecast: ForecastDay[];
  current: CurrentConditions;
  gda: GDAResult | null;
  chilling: ChillingHoursResult | null;
}

const CROP_BASE_TEMPS: Record<string, number> = {
  "Maíz": 10,
  "Soja": 10,
  "Trigo": 0,
  "Girasol": 8,
  "default": 10,
};

const CROP_GDA_STAGES: Record<string, { name: string; gda: number }[]> = {
  "Maíz": [
    { name: "Emergencia", gda: 125 },
    { name: "V6", gda: 350 },
    { name: "V12", gda: 610 },
    { name: "Floración", gda: 740 },
    { name: "Llenado", gda: 1100 },
    { name: "Madurez", gda: 1400 },
  ],
  "Soja": [
    { name: "Emergencia", gda: 90 },
    { name: "V3", gda: 200 },
    { name: "V6", gda: 350 },
    { name: "Floración", gda: 500 },
    { name: "Llenado", gda: 900 },
    { name: "Madurez", gda: 1200 },
  ],
  "Trigo": [
    { name: "Emergencia", gda: 100 },
    { name: "Macollaje", gda: 400 },
    { name: "Encañado", gda: 700 },
    { name: "Espigado", gda: 1050 },
    { name: "Llenado", gda: 1400 },
    { name: "Madurez", gda: 1700 },
  ],
  "Girasol": [
    { name: "Emergencia", gda: 100 },
    { name: "V6", gda: 300 },
    { name: "Floración", gda: 700 },
    { name: "Llenado", gda: 1100 },
    { name: "Madurez", gda: 1500 },
  ],
};

function getWeatherIcon(code: number): "sun" | "cloud" | "rain" | "storm" | "snow" {
  if (code === 0 || code === 1) return "sun";
  if (code >= 2 && code <= 3) return "cloud";
  if (code >= 45 && code <= 48) return "cloud";
  if (code >= 51 && code <= 67) return "rain";
  if (code >= 71 && code <= 77) return "snow";
  if (code >= 80 && code <= 82) return "rain";
  if (code >= 85 && code <= 86) return "snow";
  if (code >= 95 && code <= 99) return "storm";
  return "cloud";
}

function getDayName(date: Date, index: number): string {
  if (index === 0) return "Hoy";
  const days = ["Dom", "Lun", "Mar", "Mie", "Jue", "Vie", "Sab"];
  return days[date.getDay()];
}

function getCurrentStage(gda: number, crop: string): string {
  const stages = CROP_GDA_STAGES[crop] || CROP_GDA_STAGES["Maíz"];
  let currentStage = "Pre-siembra";
  
  for (const stage of stages) {
    if (gda >= stage.gda) {
      currentStage = stage.name;
    } else {
      break;
    }
  }
  
  return currentStage;
}

export async function getWeatherForecast(latitude: number, longitude: number, signal?: AbortSignal): Promise<ForecastDay[]> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,relative_humidity_2m_mean,wind_speed_10m_max&timezone=auto`;
    
    const response = signal ? await fetch(url, { signal }) : await fetch(url);
    if (!response.ok) {
      throw new Error(`Open-Meteo API error: ${response.status}`);
    }
    
    const body = await response.text();
    let data: any;
    try {
      data = JSON.parse(body);
    } catch {
      throw new Error(`Open-Meteo returned invalid JSON: ${body.slice(0, 120)}`);
    }
    
    const forecast: ForecastDay[] = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(data.daily.time[i]);
      forecast.push({
        date: data.daily.time[i],
        dayName: getDayName(date, i),
        tempMax: Math.round(data.daily.temperature_2m_max[i]),
        tempMin: Math.round(data.daily.temperature_2m_min[i]),
        precipitation: Math.round(data.daily.precipitation_sum[i] || 0),
        humidity: Math.round(data.daily.relative_humidity_2m_mean?.[i] || 50),
        windSpeed: Math.round(data.daily.wind_speed_10m_max[i] || 0),
        weatherCode: data.daily.weather_code[i],
        icon: getWeatherIcon(data.daily.weather_code[i]),
      });
    }
    
    return forecast;
  } catch (error) {
    console.error("Error fetching weather forecast:", error);
    throw error;
  }
}

export async function getCurrentWeather(latitude: number, longitude: number, signal?: AbortSignal): Promise<CurrentConditions> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,shortwave_radiation&timezone=auto`;
    
    const response = signal ? await fetch(url, { signal }) : await fetch(url);
    if (!response.ok) {
      throw new Error(`Open-Meteo API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    return {
      temperature: Math.round(data.current.temperature_2m),
      humidity: Math.round(data.current.relative_humidity_2m),
      windSpeed: Math.round(data.current.wind_speed_10m),
      precipitation: data.current.precipitation || 0,
      weatherCode: data.current.weather_code,
      radiation: Math.round(data.current.shortwave_radiation || 0),
    };
  } catch (error) {
    console.error("Error fetching current weather:", error);
    throw error;
  }
}

export async function getHistoricalWeather(
  latitude: number, 
  longitude: number, 
  startDate: string, 
  endDate: string
): Promise<HistoricalDay[]> {
  try {
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${latitude}&longitude=${longitude}&start_date=${startDate}&end_date=${endDate}&daily=temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum&timezone=auto`;
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Open-Meteo Archive API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    const historical: HistoricalDay[] = [];
    if (data.daily && data.daily.time) {
      for (let i = 0; i < data.daily.time.length; i++) {
        historical.push({
          date: data.daily.time[i],
          tempMax: data.daily.temperature_2m_max[i],
          tempMin: data.daily.temperature_2m_min[i],
          tempMean: data.daily.temperature_2m_mean[i],
          precipitation: data.daily.precipitation_sum[i] || 0,
        });
      }
    }
    
    return historical;
  } catch (error) {
    console.error("Error fetching historical weather:", error);
    return [];
  }
}

// ─── Chilling Hours helpers ────────────────────────────────────────────────

/**
 * Estimates hours below `threshold` in a day using a sinusoidal temperature
 * model built from daily min/max.
 */
function estimateHoursBelow(tempMin: number, tempMax: number, threshold: number): number {
  const mean = (tempMin + tempMax) / 2;
  const amplitude = (tempMax - tempMin) / 2;
  if (amplitude === 0) return tempMin <= threshold ? 24 : 0;
  const theta = (mean - threshold) / amplitude;
  if (theta >= 1) return 0;
  if (theta <= -1) return 24;
  return (24 * Math.acos(theta)) / Math.PI;
}

/**
 * Daily Utah Chill Units from daily min/max via sinusoidal approximation.
 * Weights: <1.4°C → 0 | 1.4-2.4 → 0.5 | 2.4-9.1 → 1.0 | 9.1-12.4 → 0.5
 *          12.4-15.9 → 0 | 15.9-18.0 → -0.5 | >18.0 → -1.0
 */
function dailyUtahCU(tempMin: number, tempMax: number): number {
  const hb = (t: number) => estimateHoursBelow(tempMin, tempMax, t);
  const h14  = hb(1.4);
  const h24  = hb(2.4);
  const h91  = hb(9.1);
  const h124 = hb(12.4);
  const h159 = hb(15.9);
  const h180 = hb(18.0);
  return (
    0.5 * (h24 - h14) +
    1.0 * (h91 - h24) +
    0.5 * (h124 - h91) +
   -0.5 * (h180 - h159) +
   -1.0 * (24 - h180)
  );
}

export async function calculateChillingHours(
  latitude: number,
  longitude: number,
): Promise<ChillingHoursResult | null> {
  try {
    // Season: Oct-1 of the relevant year → today
    const today = new Date();
    const seasonYear = today.getMonth() >= 9 ? today.getFullYear() : today.getFullYear() - 1;
    const seasonStart = new Date(seasonYear, 9, 1); // Oct 1
    const startDate = seasonStart.toISOString().split('T')[0];
    const endDate = today.toISOString().split('T')[0];

    const historical = await getHistoricalWeather(latitude, longitude, startDate, endDate);

    let totalSimple = 0;
    let totalUtah = 0;
    const weeklyData: ChillingHoursResult['weeklyData'] = [];
    let weekSimple = 0;
    let weekUtah = 0;
    let weekCount = 1;

    for (let i = 0; i < historical.length; i++) {
      const { tempMin, tempMax } = historical[i];
      const hSimple = estimateHoursBelow(tempMin, tempMax, 7.2);
      const hUtah   = dailyUtahCU(tempMin, tempMax);
      weekSimple  += hSimple;
      weekUtah    += hUtah;
      totalSimple += hSimple;
      totalUtah   += hUtah;

      if ((i + 1) % 7 === 0 || i === historical.length - 1) {
        weeklyData.push({
          week: `S${weekCount}`,
          simple: Math.round(weekSimple),
          utah:   Math.round(weekUtah * 10) / 10,
          accSimple: Math.round(totalSimple),
          accUtah:   Math.round(totalUtah),
        });
        weekSimple = 0;
        weekUtah   = 0;
        weekCount++;
      }
    }

    return {
      simple: Math.round(totalSimple),
      utah:   Math.round(totalUtah),
      weeklyData,
      seasonStart: startDate,
    };
  } catch (error) {
    console.error("Error calculating chilling hours:", error);
    return null;
  }
}

export async function calculateGDA(
  latitude: number,
  longitude: number,
  plantingDate: Date,
  crop: string
): Promise<GDAResult | null> {
  try {
    const today = new Date();
    const daysSincePlanting = Math.floor((today.getTime() - plantingDate.getTime()) / (1000 * 60 * 60 * 24));
    
    if (daysSincePlanting < 0) {
      return {
        accumulated: 0,
        weeklyData: [],
        currentStage: "Pre-siembra",
      };
    }

    const startDate = plantingDate.toISOString().split('T')[0];
    const endDate = today.toISOString().split('T')[0];
    
    const baseTemp = CROP_BASE_TEMPS[crop] || CROP_BASE_TEMPS["default"];
    
    let historical = await getHistoricalWeather(latitude, longitude, startDate, endDate);
    
    if (historical.length === 0) {
      const forecast = await getWeatherForecast(latitude, longitude);
      const estimatedDailyGDD = 15;
      const weeks = Math.ceil(daysSincePlanting / 7);
      const weeklyData = [];
      let accumulated = 0;
      
      for (let i = 0; i < Math.min(weeks, 12); i++) {
        const weekGDD = estimatedDailyGDD * 7;
        accumulated += weekGDD;
        weeklyData.push({
          week: `S${i + 1}`,
          gdd: weekGDD,
          accumulated,
        });
      }
      
      return {
        accumulated,
        weeklyData,
        currentStage: getCurrentStage(accumulated, crop),
      };
    }
    
    let totalGDA = 0;
    const weeklyData: { week: string; gdd: number; accumulated: number }[] = [];
    let weekGDD = 0;
    let weekCount = 1;
    
    for (let i = 0; i < historical.length; i++) {
      const day = historical[i];
      const avgTemp = (day.tempMax + day.tempMin) / 2;
      const dailyGDD = Math.max(0, avgTemp - baseTemp);
      totalGDA += dailyGDD;
      weekGDD += dailyGDD;
      
      if ((i + 1) % 7 === 0 || i === historical.length - 1) {
        weeklyData.push({
          week: `S${weekCount}`,
          gdd: Math.round(weekGDD),
          accumulated: Math.round(totalGDA),
        });
        weekGDD = 0;
        weekCount++;
      }
    }
    
    return {
      accumulated: Math.round(totalGDA),
      weeklyData,
      currentStage: getCurrentStage(totalGDA, crop),
    };
  } catch (error) {
    console.error("Error calculating GDA:", error);
    return null;
  }
}

export async function getFullWeatherData(
  latitude: number,
  longitude: number,
  plantingDate: Date | null,
  crop: string,
  options: { includeThermal?: boolean; signal?: AbortSignal } = {},
): Promise<WeatherData> {
  const [forecast, current, gda, chilling] = await Promise.all([
    getWeatherForecast(latitude, longitude, options.signal),
    getCurrentWeather(latitude, longitude, options.signal),
    options.includeThermal !== false && plantingDate ? calculateGDA(latitude, longitude, plantingDate, crop) : Promise.resolve(null),
    options.includeThermal !== false ? calculateChillingHours(latitude, longitude) : Promise.resolve(null),
  ]);
  
  return { forecast, current, gda, chilling };
}

/** Observed-period weather model, never a synthetic fallback or missing-rain=0. */
export async function getRecentObservedWeather(latitude: number, longitude: number) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&past_days=7&forecast_days=1&timezone=auto`;
    const response = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!response.ok) return null;
    const { daily } = await response.json();
    if (!Array.isArray(daily?.time) || daily.time.length < 2) return null;
    // Last date is the current forecast day, not a complete historical day.
    const dates = daily.time.slice(0, -1).slice(-7);
    const start = daily.time.length - 1 - dates.length;
    const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
    const rain = dates.map((_: string, i: number) => daily.precipitation_sum?.[start + i]);
    const min = dates.map((_: string, i: number) => daily.temperature_2m_min?.[start + i]);
    const max = dates.map((_: string, i: number) => daily.temperature_2m_max?.[start + i]);
    return { from: dates[0], to: dates.at(-1), days: dates.length,
      rainMm: rain.every(finite) ? Number(rain.reduce((a: number, b: number) => a + b, 0).toFixed(1)) : null,
      tempMean: min.every(finite) && max.every(finite)
        ? Number((min.reduce((a: number, b: number, i: number) => a + (b + max[i]) / 2, 0) / dates.length).toFixed(1)) : null,
      source: "Open-Meteo, estimación meteorológica del periodo; no estación en la parcela" };
  } catch { return null; }
}

import type { Parcel, ParcelData, SoilAnalysis } from "@shared/schema";

export interface GeneratedAlert {
  severity: "high" | "medium" | "low";
  title: string;
  description: string;
  source: string;
  dataValue?: number;
  threshold?: number;
}

interface CropOptimalRanges {
  nitrogen: { min: number; optimal: number };
  phosphorus: { min: number; optimal: number };
  potassium: { min: number; optimal: number };
  ph: { min: number; max: number; optimal: number };
  organicMatter: { min: number; optimal: number };
  soilMoisture: { stress: number; warning: number };
  temperature: { min: number; max: number; critical: number };
}

const CROP_OPTIMAL_RANGES: Record<string, CropOptimalRanges> = {
  "Soja": {
    nitrogen: { min: 30, optimal: 60 },
    phosphorus: { min: 15, optimal: 30 },
    potassium: { min: 120, optimal: 200 },
    ph: { min: 5.8, max: 7.0, optimal: 6.5 },
    organicMatter: { min: 2.5, optimal: 4.0 },
    soilMoisture: { stress: 25, warning: 35 },
    temperature: { min: 10, max: 35, critical: 38 },
  },
  "Maíz": {
    nitrogen: { min: 40, optimal: 80 },
    phosphorus: { min: 20, optimal: 35 },
    potassium: { min: 150, optimal: 250 },
    ph: { min: 5.5, max: 7.5, optimal: 6.5 },
    organicMatter: { min: 2.0, optimal: 3.5 },
    soilMoisture: { stress: 20, warning: 30 },
    temperature: { min: 10, max: 35, critical: 40 },
  },
  "Trigo": {
    nitrogen: { min: 35, optimal: 70 },
    phosphorus: { min: 15, optimal: 25 },
    potassium: { min: 100, optimal: 180 },
    ph: { min: 5.5, max: 7.8, optimal: 6.5 },
    organicMatter: { min: 2.0, optimal: 3.0 },
    soilMoisture: { stress: 25, warning: 35 },
    temperature: { min: 5, max: 30, critical: 35 },
  },
  "Girasol": {
    nitrogen: { min: 25, optimal: 50 },
    phosphorus: { min: 15, optimal: 30 },
    potassium: { min: 120, optimal: 200 },
    ph: { min: 5.5, max: 8.0, optimal: 6.5 },
    organicMatter: { min: 2.0, optimal: 3.5 },
    soilMoisture: { stress: 20, warning: 30 },
    temperature: { min: 8, max: 35, critical: 40 },
  },
};

const DEFAULT_RANGES: CropOptimalRanges = {
  nitrogen: { min: 30, optimal: 60 },
  phosphorus: { min: 15, optimal: 30 },
  potassium: { min: 120, optimal: 200 },
  ph: { min: 5.5, max: 7.5, optimal: 6.5 },
  organicMatter: { min: 2.0, optimal: 3.5 },
  soilMoisture: { stress: 25, warning: 35 },
  temperature: { min: 10, max: 35, critical: 38 },
};

interface PhenologicalStage {
  name: string;
  startDay: number;
  endDay: number;
  ndviStart: number;
  ndviEnd: number;
}

interface CropCurve {
  name: string;
  cycleDays: number;
  stages: PhenologicalStage[];
}

const CROP_CURVES: Record<string, CropCurve> = {
  "Soja": {
    name: "Soja",
    cycleDays: 120,
    stages: [
      { name: "Germinación", startDay: 0, endDay: 15, ndviStart: 0.1, ndviEnd: 0.2 },
      { name: "Crecimiento Vegetativo", startDay: 15, endDay: 45, ndviStart: 0.2, ndviEnd: 0.6 },
      { name: "Floración", startDay: 45, endDay: 70, ndviStart: 0.6, ndviEnd: 0.85 },
      { name: "Llenado de Grano", startDay: 70, endDay: 100, ndviStart: 0.85, ndviEnd: 0.7 },
      { name: "Madurez", startDay: 100, endDay: 120, ndviStart: 0.7, ndviEnd: 0.3 },
    ],
  },
  "Maíz": {
    name: "Maíz",
    cycleDays: 140,
    stages: [
      { name: "Germinación", startDay: 0, endDay: 12, ndviStart: 0.1, ndviEnd: 0.2 },
      { name: "Crecimiento Vegetativo", startDay: 12, endDay: 50, ndviStart: 0.2, ndviEnd: 0.7 },
      { name: "Floración", startDay: 50, endDay: 75, ndviStart: 0.7, ndviEnd: 0.9 },
      { name: "Llenado de Grano", startDay: 75, endDay: 115, ndviStart: 0.9, ndviEnd: 0.65 },
      { name: "Madurez", startDay: 115, endDay: 140, ndviStart: 0.65, ndviEnd: 0.25 },
    ],
  },
  "Trigo": {
    name: "Trigo",
    cycleDays: 150,
    stages: [
      { name: "Germinación", startDay: 0, endDay: 20, ndviStart: 0.1, ndviEnd: 0.25 },
      { name: "Macollaje", startDay: 20, endDay: 60, ndviStart: 0.25, ndviEnd: 0.55 },
      { name: "Encañado", startDay: 60, endDay: 90, ndviStart: 0.55, ndviEnd: 0.8 },
      { name: "Espigado", startDay: 90, endDay: 110, ndviStart: 0.8, ndviEnd: 0.85 },
      { name: "Llenado de Grano", startDay: 110, endDay: 135, ndviStart: 0.85, ndviEnd: 0.5 },
      { name: "Madurez", startDay: 135, endDay: 150, ndviStart: 0.5, ndviEnd: 0.2 },
    ],
  },
  "Girasol": {
    name: "Girasol",
    cycleDays: 130,
    stages: [
      { name: "Germinación", startDay: 0, endDay: 15, ndviStart: 0.1, ndviEnd: 0.2 },
      { name: "Crecimiento Vegetativo", startDay: 15, endDay: 55, ndviStart: 0.2, ndviEnd: 0.7 },
      { name: "Floración", startDay: 55, endDay: 80, ndviStart: 0.7, ndviEnd: 0.85 },
      { name: "Llenado de Grano", startDay: 80, endDay: 110, ndviStart: 0.85, ndviEnd: 0.55 },
      { name: "Madurez", startDay: 110, endDay: 130, ndviStart: 0.55, ndviEnd: 0.2 },
    ],
  },
};

const DEFAULT_CURVE: CropCurve = {
  name: "Genérico",
  cycleDays: 120,
  stages: [
    { name: "Germinación", startDay: 0, endDay: 15, ndviStart: 0.1, ndviEnd: 0.2 },
    { name: "Crecimiento", startDay: 15, endDay: 50, ndviStart: 0.2, ndviEnd: 0.7 },
    { name: "Máximo Desarrollo", startDay: 50, endDay: 80, ndviStart: 0.7, ndviEnd: 0.85 },
    { name: "Senescencia", startDay: 80, endDay: 120, ndviStart: 0.85, ndviEnd: 0.3 },
  ],
};

function getCropRanges(cropName: string): CropOptimalRanges {
  const normalized = cropName?.toLowerCase().trim() || "";
  for (const [key, ranges] of Object.entries(CROP_OPTIMAL_RANGES)) {
    if (key.toLowerCase() === normalized) {
      return ranges;
    }
  }
  return DEFAULT_RANGES;
}

function getCropCurve(cropName: string): CropCurve {
  const normalized = cropName?.toLowerCase().trim() || "";
  for (const [key, curve] of Object.entries(CROP_CURVES)) {
    if (key.toLowerCase() === normalized) {
      return curve;
    }
  }
  return DEFAULT_CURVE;
}

function calculateIdealNDVI(daysSincePlanting: number, cropCurve: CropCurve): number {
  if (daysSincePlanting < 0) return 0.1;
  if (daysSincePlanting > cropCurve.cycleDays) {
    return cropCurve.stages[cropCurve.stages.length - 1].ndviEnd;
  }
  
  for (const stage of cropCurve.stages) {
    if (daysSincePlanting >= stage.startDay && daysSincePlanting <= stage.endDay) {
      const progress = (daysSincePlanting - stage.startDay) / (stage.endDay - stage.startDay);
      return stage.ndviStart + progress * (stage.ndviEnd - stage.ndviStart);
    }
  }
  
  return 0.5;
}

function getCurrentStage(daysSincePlanting: number, cropCurve: CropCurve): string {
  if (daysSincePlanting < 0) return "Pre-siembra";
  if (daysSincePlanting > cropCurve.cycleDays) return "Post-cosecha";
  
  for (const stage of cropCurve.stages) {
    if (daysSincePlanting >= stage.startDay && daysSincePlanting <= stage.endDay) {
      return stage.name;
    }
  }
  return "Desconocido";
}

export interface ProfitabilityAlertInput {
  grossMargin?: number | null;
  roi?: number | null;
  totalCost?: number | null;
  projectedRevenue?: number | null;
  hasCycleDetail: boolean;
}

export interface SetupProgressAlertInput {
  stepCycle: boolean;
  stepSoil: boolean;
  stepEconomy: boolean;
  stepPractices: boolean;
}

export interface OverduePhenologyPrompt {
  id: string;
  stage: string;
  promptText: string;
  daysOverdue: number;
}

export interface AlertsEngineInput {
  parcel: Parcel;
  latestParcelData: ParcelData | null;
  recentParcelData: ParcelData[];
  soilAnalysis: SoilAnalysis | null;
  weatherData?: {
    temperature?: number;
    precipitation?: number;
    humidity?: number;
  };
  profitability?: ProfitabilityAlertInput;
  setupProgress?: SetupProgressAlertInput | null;
  cycleDurationDays?: number | null;
  overduePrompts?: OverduePhenologyPrompt[];
}

export function generateAlerts(input: AlertsEngineInput): GeneratedAlert[] {
  const alerts: GeneratedAlert[] = [];
  const { parcel, latestParcelData, recentParcelData, soilAnalysis, weatherData } = input;
  
  const cropRanges = getCropRanges(parcel.crop || "");
  const cropCurve = getCropCurve(parcel.crop || "");
  
  let daysSincePlanting: number | null = null;
  let currentStage: string | null = null;
  
  if (parcel.plantingDate) {
    const plantingDate = new Date(parcel.plantingDate);
    const now = new Date();
    daysSincePlanting = Math.floor((now.getTime() - plantingDate.getTime()) / (1000 * 60 * 60 * 24));
    currentStage = getCurrentStage(daysSincePlanting, cropCurve);
  }

  if (latestParcelData) {
    const soilMoisture = latestParcelData.soilMoisture !== null 
      ? Number(latestParcelData.soilMoisture)
      : null;
    
    if (soilMoisture !== null) {
      const stressThreshold = cropRanges.soilMoisture.stress;
      const warningThreshold = cropRanges.soilMoisture.warning;
      
      if (soilMoisture < stressThreshold) {
        alerts.push({
          severity: "high",
          title: "Estrés Hídrico Detectado",
          description: `La humedad del suelo ha descendido a ${soilMoisture.toFixed(0)}% (umbral crítico: ${stressThreshold}% para ${parcel.crop || "el cultivo"}). Se recomienda verificar el sistema de riego.`,
          source: "satellite_soil_moisture",
          dataValue: soilMoisture,
          threshold: stressThreshold,
        });
      } else if (soilMoisture < warningThreshold) {
        alerts.push({
          severity: "medium",
          title: "Contenido Hídrico Bajo",
          description: `La humedad del suelo (${soilMoisture.toFixed(0)}%) está por debajo del óptimo (${warningThreshold}%) para ${parcel.crop || "el cultivo"}. Monitorear precipitaciones.`,
          source: "satellite_soil_moisture",
          dataValue: soilMoisture,
          threshold: warningThreshold,
        });
      }
    }

    if (latestParcelData.ndvi !== null && daysSincePlanting !== null && daysSincePlanting > 15) {
      const actualNdvi = Number(latestParcelData.ndvi);
      const idealNdvi = calculateIdealNDVI(daysSincePlanting, cropCurve);
      
      if (idealNdvi >= 0.15) {
        const deviation = ((actualNdvi - idealNdvi) / idealNdvi) * 100;
        
        if (deviation < -20) {
          alerts.push({
            severity: "high",
            title: "Desarrollo Vegetativo Retrasado",
            description: `El NDVI actual (${actualNdvi.toFixed(2)}) está ${Math.abs(deviation).toFixed(0)}% por debajo del ideal (${idealNdvi.toFixed(2)}) para la etapa de ${currentStage}. Revisar posibles causas.`,
            source: "satellite_ndvi_deviation",
            dataValue: actualNdvi,
            threshold: idealNdvi,
          });
        } else if (deviation < -10) {
          alerts.push({
            severity: "medium",
            title: "Desarrollo Vegetativo Ligeramente Atrasado",
            description: `El desarrollo vegetativo está ${Math.abs(deviation).toFixed(0)}% por debajo del esperado para ${currentStage}. NDVI actual: ${actualNdvi.toFixed(2)}, ideal: ${idealNdvi.toFixed(2)}.`,
            source: "satellite_ndvi_deviation",
            dataValue: actualNdvi,
            threshold: idealNdvi,
          });
        }
      }
    }

    if (recentParcelData.length >= 2) {
      const sortedData = [...recentParcelData].sort((a, b) => 
        new Date(b.date).getTime() - new Date(a.date).getTime()
      );
      
      const latest = sortedData[0];
      const previous = sortedData[sortedData.length > 3 ? 3 : sortedData.length - 1];
      
      if (latest.ndvi !== null && previous.ndvi !== null) {
        const ndviChange = Number(latest.ndvi) - Number(previous.ndvi);
        if (ndviChange < -0.15 && daysSincePlanting !== null && daysSincePlanting < cropCurve.cycleDays * 0.7) {
          alerts.push({
            severity: "high",
            title: "Caída Abrupta de NDVI",
            description: `El NDVI ha descendido ${Math.abs(ndviChange).toFixed(2)} puntos recientemente. Posible daño por plagas, enfermedad o estrés severo.`,
            source: "satellite_ndvi_trend",
            dataValue: ndviChange,
          });
        }
      }
    }
  }

  if (soilAnalysis) {
    if (soilAnalysis.nitrogenTotal !== null) {
      const nitrogen = Number(soilAnalysis.nitrogenTotal);
      if (nitrogen < cropRanges.nitrogen.min) {
        const deficit = ((cropRanges.nitrogen.optimal - nitrogen) / cropRanges.nitrogen.optimal * 100).toFixed(0);
        alerts.push({
          severity: "medium",
          title: "Niveles de Nitrógeno Bajos",
          description: `El nitrógeno disponible (${nitrogen.toFixed(0)} ppm) está ${deficit}% por debajo del óptimo para ${parcel.crop || "el cultivo"}. Considerar aplicación de fertilizante.`,
          source: "soil_nitrogen",
          dataValue: nitrogen,
          threshold: cropRanges.nitrogen.optimal,
        });
      }
    }

    if (soilAnalysis.phosphorus !== null) {
      const phosphorus = Number(soilAnalysis.phosphorus);
      if (phosphorus < cropRanges.phosphorus.min) {
        alerts.push({
          severity: "medium",
          title: "Fósforo Deficiente",
          description: `El nivel de fósforo (${phosphorus.toFixed(0)} ppm) está por debajo del mínimo recomendado (${cropRanges.phosphorus.min} ppm) para ${parcel.crop || "el cultivo"}.`,
          source: "soil_phosphorus",
          dataValue: phosphorus,
          threshold: cropRanges.phosphorus.min,
        });
      }
    }

    if (soilAnalysis.potassium !== null) {
      const potassium = Number(soilAnalysis.potassium);
      if (potassium < cropRanges.potassium.min) {
        alerts.push({
          severity: "medium",
          title: "Potasio Bajo",
          description: `El potasio disponible (${potassium.toFixed(0)} ppm) está por debajo del óptimo. Puede afectar la resistencia a enfermedades y calidad del grano.`,
          source: "soil_potassium",
          dataValue: potassium,
          threshold: cropRanges.potassium.min,
        });
      }
    }

    if (soilAnalysis.ph !== null) {
      const ph = Number(soilAnalysis.ph);
      if (ph < cropRanges.ph.min) {
        alerts.push({
          severity: "high",
          title: "Suelo Muy Ácido",
          description: `El pH del suelo (${ph.toFixed(1)}) está por debajo del rango óptimo (${cropRanges.ph.min}-${cropRanges.ph.max}). Considerar encalado.`,
          source: "soil_ph",
          dataValue: ph,
          threshold: cropRanges.ph.min,
        });
      } else if (ph > cropRanges.ph.max) {
        alerts.push({
          severity: "medium",
          title: "Suelo Alcalino",
          description: `El pH del suelo (${ph.toFixed(1)}) está por encima del rango óptimo. Puede afectar la disponibilidad de micronutrientes.`,
          source: "soil_ph",
          dataValue: ph,
          threshold: cropRanges.ph.max,
        });
      }
    }

    if (soilAnalysis.organicMatter !== null) {
      const om = Number(soilAnalysis.organicMatter);
      if (om < cropRanges.organicMatter.min) {
        alerts.push({
          severity: "low",
          title: "Materia Orgánica Baja",
          description: `La materia orgánica (${om.toFixed(1)}%) está por debajo del óptimo. Considerar incorporación de abonos orgánicos o cobertura vegetal.`,
          source: "soil_organic_matter",
          dataValue: om,
          threshold: cropRanges.organicMatter.min,
        });
      }
    }
  }

  if (weatherData && currentStage) {
    if (weatherData.temperature !== undefined) {
      const temp = weatherData.temperature;
      
      if (temp > cropRanges.temperature.critical) {
        alerts.push({
          severity: "high",
          title: "Temperatura Crítica Detectada",
          description: `La temperatura actual (${temp.toFixed(1)}°C) supera el umbral crítico para ${parcel.crop || "el cultivo"}. Puede causar daño severo en etapa de ${currentStage}.`,
          source: "weather_temperature",
          dataValue: temp,
          threshold: cropRanges.temperature.critical,
        });
      } else if (temp > cropRanges.temperature.max) {
        alerts.push({
          severity: "medium",
          title: "Temperatura Elevada",
          description: `Las temperaturas actuales (${temp.toFixed(1)}°C) superan el rango óptimo. Monitorear estrés térmico.`,
          source: "weather_temperature",
          dataValue: temp,
          threshold: cropRanges.temperature.max,
        });
      } else if (temp < cropRanges.temperature.min) {
        alerts.push({
          severity: "medium",
          title: "Riesgo de Helada",
          description: `La temperatura (${temp.toFixed(1)}°C) está por debajo del mínimo para ${parcel.crop || "el cultivo"}. Puede afectar el desarrollo en etapa de ${currentStage}.`,
          source: "weather_temperature",
          dataValue: temp,
          threshold: cropRanges.temperature.min,
        });
      }
    }

    if (weatherData.humidity !== undefined && weatherData.temperature !== undefined) {
      const humidity = weatherData.humidity;
      const temp = weatherData.temperature;
      
      if (humidity > 80 && temp > 20 && temp < 30) {
        const susceptibleStages = ["Floración", "Espigado", "Llenado de Grano"];
        if (susceptibleStages.some(s => currentStage?.includes(s))) {
          alerts.push({
            severity: "low",
            title: "Monitoreo de Plagas Sugerido",
            description: `Las condiciones climáticas (${humidity.toFixed(0)}% humedad, ${temp.toFixed(1)}°C) favorecen la aparición de hongos y pulgón. Se recomienda inspección visual.`,
            source: "weather_pest_conditions",
          });
        }
      }
    }

    if (weatherData.temperature !== undefined) {
      const temp = weatherData.temperature;
      const optimalStages = ["Floración", "Llenado de Grano"];
      
      if (optimalStages.some(s => currentStage?.includes(s))) {
        if (temp >= cropRanges.temperature.min + 5 && temp <= cropRanges.temperature.max - 5) {
          alerts.push({
            severity: "low",
            title: "Temperatura Óptima Alcanzada",
            description: `Las temperaturas de los últimos 7 días han sido ideales para la etapa de ${currentStage}.`,
            source: "weather_optimal",
          });
        }
      }
    }
  }

  // ── T176: Economic alerts ────────────────────────────────────────────────
  if (input.profitability) {
    const { grossMargin, roi, totalCost, hasCycleDetail } = input.profitability;

    if (!hasCycleDetail && totalCost && totalCost > 0) {
      alerts.push({
        severity: "low",
        title: "Ciclo económico sin configurar",
        description: `Tienes $${totalCost.toLocaleString("es-AR", { maximumFractionDigits: 0 })} en costos registrados pero sin precio/rendimiento objetivo. Configura el ciclo para ver tu margen bruto.`,
        source: "economic_no_cycle",
      });
    }

    if (grossMargin != null && grossMargin < 0) {
      alerts.push({
        severity: "high",
        title: "Margen Bruto Negativo Proyectado",
        description: `Con los costos e ingresos actuales, el margen bruto proyectado es $${Math.abs(grossMargin).toLocaleString("es-AR", { maximumFractionDigits: 0 })} negativo. Revisa costos o ajusta el precio objetivo.`,
        source: "economic_negative_margin",
        dataValue: grossMargin,
      });
    } else if (grossMargin != null && roi != null && roi < 10) {
      alerts.push({
        severity: "medium",
        title: "Rentabilidad Proyectada Baja",
        description: `El ROI proyectado (${roi.toFixed(1)}%) está por debajo del 10%. Considera reducir costos variables o mejorar el precio de comercialización.`,
        source: "economic_low_roi",
        dataValue: roi,
        threshold: 10,
      });
    }
  }

  // ── T176: Incomplete profile alerts (medium when <50% complete at 30% of cycle) ──
  if (input.setupProgress !== undefined) {
    // Determine threshold: 30% of cycle duration from planting date, or 14 days fallback
    const cycleDays = input.cycleDurationDays ?? 120;   // default 120-day cycle
    const thresholdDays = Math.round(cycleDays * 0.30); // 30% of cycle duration
    const refDate = parcel.plantingDate
      ? new Date(parcel.plantingDate)
      : parcel.createdAt ? new Date(parcel.createdAt) : null;
    const daysSinceRef = refDate
      ? Math.floor((Date.now() - refDate.getTime()) / 86400_000)
      : 0;
    const isEstablished = daysSinceRef >= thresholdDays;

    const completedCount = input.setupProgress === null ? 0
      : [input.setupProgress.stepCycle, input.setupProgress.stepSoil,
         input.setupProgress.stepEconomy, input.setupProgress.stepPractices].filter(Boolean).length;
    const completionPct = (completedCount / 4) * 100;

    // Only alert when <50% complete after reaching 30% of cycle duration
    if (isEstablished && completionPct < 50) {
      if (input.setupProgress === null) {
        alerts.push({
          severity: "medium",
          title: "Perfil de Parcela Sin Iniciar",
          description: `Este lote no ha completado ningún paso de configuración. Completa el wizard para activar alertas personalizadas y KPIs de rentabilidad.`,
          source: "setup_not_started",
        });
      } else {
        const { stepCycle, stepSoil, stepEconomy, stepPractices } = input.setupProgress!;
        const missing: string[] = [];
        if (!stepCycle) missing.push("Ciclo");
        if (!stepSoil) missing.push("Suelo");
        if (!stepEconomy) missing.push("Economía");
        if (!stepPractices) missing.push("Prácticas");
        alerts.push({
          severity: "medium",
          title: "Perfil de Parcela Incompleto (<50%)",
          description: `Solo ${completedCount} de 4 pasos completados. Faltan: ${missing.join(", ")}. Completa el perfil para activar KPIs de rentabilidad.`,
          source: "setup_incomplete",
        });
      }
    }
  }

  // ── T176: Overdue phenology prompts alert (>15 days → medium) ────────────
  if (input.overduePrompts && input.overduePrompts.length > 0) {
    const mostOverdue = input.overduePrompts.reduce((a, b) => a.daysOverdue > b.daysOverdue ? a : b);
    alerts.push({
      severity: "medium",
      title: `Tarea Fenológica Vencida: ${mostOverdue.stage}`,
      description: `${input.overduePrompts.length > 1 ? `${input.overduePrompts.length} tareas fenológicas vencidas (más antigua: ${mostOverdue.daysOverdue} días)` : `Tarea vencida hace ${mostOverdue.daysOverdue} días`}: ${mostOverdue.promptText}`,
      source: "phenology_overdue_prompt",
      dataValue: mostOverdue.daysOverdue,
      threshold: 15,
    });
  }

  return alerts.sort((a, b) => {
    const severityOrder = { high: 0, medium: 1, low: 2 };
    return severityOrder[a.severity] - severityOrder[b.severity];
  });
}

export function generateRecommendedActions(alerts: GeneratedAlert[], parcel: Parcel): string[] {
  const actions: string[] = [];
  
  for (const alert of alerts) {
    switch (alert.source) {
      case "satellite_soil_moisture":
        if (alert.severity === "high") {
          actions.push(`Aplicar riego suplementario de 25mm en las próximas 48 horas. Humedad del suelo baja y sin precipitación pronosticada.`);
        }
        break;
      case "soil_nitrogen":
        actions.push(`Realizar análisis de suelo para confirmar niveles de N. Valores estimados sugieren deficiencia de nitrógeno.`);
        break;
      case "weather_pest_conditions":
        actions.push(`Inspección visual en busca de pulgón. Condiciones climáticas favorables para la plaga.`);
        break;
      case "satellite_ndvi_deviation":
        if (alert.severity === "high") {
          actions.push(`Verificar posibles causas de bajo desarrollo: plagas, enfermedades, deficiencias nutricionales o estrés hídrico.`);
        }
        break;
      case "soil_ph":
        if (alert.dataValue && alert.dataValue < 5.5) {
          actions.push(`Considerar aplicación de cal agrícola para corregir acidez del suelo.`);
        }
        break;
    }
  }
  
  return Array.from(new Set(actions));
}

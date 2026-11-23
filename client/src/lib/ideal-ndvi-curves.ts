export interface PhenologicalStage {
  name: string;
  startDay: number;
  endDay: number;
  ndviStart: number;
  ndviEnd: number;
}

export interface CropCurve {
  name: string;
  cycleDays: number;
  stages: PhenologicalStage[];
}

export const CROP_CURVES: Record<string, CropCurve> = {
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

  // ── 12 new crops ────────────────────────────────────────────────────────────
  "Tomate": {
    name: "Tomate",
    cycleDays: 110,
    stages: [
      { name: "Trasplante", startDay: 0, endDay: 15, ndviStart: 0.05, ndviEnd: 0.15 },
      { name: "Crecimiento Vegetativo", startDay: 15, endDay: 45, ndviStart: 0.15, ndviEnd: 0.55 },
      { name: "Floración", startDay: 45, endDay: 65, ndviStart: 0.55, ndviEnd: 0.70 },
      { name: "Fructificación", startDay: 65, endDay: 90, ndviStart: 0.70, ndviEnd: 0.65 },
      { name: "Madurez", startDay: 90, endDay: 110, ndviStart: 0.65, ndviEnd: 0.35 },
    ],
  },

  "Papa": {
    name: "Papa",
    cycleDays: 120,
    stages: [
      { name: "Germinación", startDay: 0, endDay: 20, ndviStart: 0.05, ndviEnd: 0.18 },
      { name: "Crecimiento Vegetativo", startDay: 20, endDay: 55, ndviStart: 0.18, ndviEnd: 0.62 },
      { name: "Tuberización", startDay: 55, endDay: 85, ndviStart: 0.62, ndviEnd: 0.78 },
      { name: "Llenado de Tubérculo", startDay: 85, endDay: 105, ndviStart: 0.78, ndviEnd: 0.55 },
      { name: "Madurez", startDay: 105, endDay: 120, ndviStart: 0.55, ndviEnd: 0.25 },
    ],
  },

  "Cebolla": {
    name: "Cebolla",
    cycleDays: 120,
    stages: [
      { name: "Siembra / Establecimiento", startDay: 0, endDay: 20, ndviStart: 0.05, ndviEnd: 0.20 },
      { name: "Crecimiento Vegetativo", startDay: 20, endDay: 65, ndviStart: 0.20, ndviEnd: 0.52 },
      { name: "Bulbificación", startDay: 65, endDay: 100, ndviStart: 0.52, ndviEnd: 0.45 },
      { name: "Madurez", startDay: 100, endDay: 120, ndviStart: 0.45, ndviEnd: 0.15 },
    ],
  },

  "Lechuga": {
    name: "Lechuga",
    cycleDays: 65,
    stages: [
      { name: "Trasplante / Emergencia", startDay: 0, endDay: 10, ndviStart: 0.05, ndviEnd: 0.18 },
      { name: "Crecimiento", startDay: 10, endDay: 35, ndviStart: 0.18, ndviEnd: 0.52 },
      { name: "Engrosamiento", startDay: 35, endDay: 55, ndviStart: 0.52, ndviEnd: 0.60 },
      { name: "Cosecha", startDay: 55, endDay: 65, ndviStart: 0.60, ndviEnd: 0.55 },
    ],
  },

  "Ajo": {
    name: "Ajo",
    cycleDays: 150,
    stages: [
      { name: "Siembra / Brotación", startDay: 0, endDay: 25, ndviStart: 0.05, ndviEnd: 0.20 },
      { name: "Crecimiento Vegetativo", startDay: 25, endDay: 80, ndviStart: 0.20, ndviEnd: 0.55 },
      { name: "Bulbificación", startDay: 80, endDay: 130, ndviStart: 0.55, ndviEnd: 0.45 },
      { name: "Madurez", startDay: 130, endDay: 150, ndviStart: 0.45, ndviEnd: 0.15 },
    ],
  },

  "Vid": {
    name: "Vid",
    cycleDays: 180,
    stages: [
      { name: "Brotación", startDay: 0, endDay: 25, ndviStart: 0.10, ndviEnd: 0.30 },
      { name: "Crecimiento Vegetativo", startDay: 25, endDay: 75, ndviStart: 0.30, ndviEnd: 0.68 },
      { name: "Floración", startDay: 75, endDay: 95, ndviStart: 0.68, ndviEnd: 0.72 },
      { name: "Cuajado / Envero", startDay: 95, endDay: 145, ndviStart: 0.72, ndviEnd: 0.60 },
      { name: "Madurez", startDay: 145, endDay: 180, ndviStart: 0.60, ndviEnd: 0.35 },
    ],
  },

  "Manzano": {
    name: "Manzano",
    cycleDays: 200,
    stages: [
      { name: "Brotación", startDay: 0, endDay: 20, ndviStart: 0.12, ndviEnd: 0.30 },
      { name: "Crecimiento Vegetativo", startDay: 20, endDay: 70, ndviStart: 0.30, ndviEnd: 0.70 },
      { name: "Floración", startDay: 70, endDay: 85, ndviStart: 0.70, ndviEnd: 0.72 },
      { name: "Fructificación", startDay: 85, endDay: 150, ndviStart: 0.72, ndviEnd: 0.68 },
      { name: "Madurez / Cosecha", startDay: 150, endDay: 200, ndviStart: 0.68, ndviEnd: 0.42 },
    ],
  },

  "Cítricos": {
    name: "Cítricos",
    cycleDays: 365,
    stages: [
      { name: "Crecimiento Vegetativo", startDay: 0, endDay: 90, ndviStart: 0.55, ndviEnd: 0.70 },
      { name: "Floración", startDay: 90, endDay: 120, ndviStart: 0.70, ndviEnd: 0.72 },
      { name: "Cuajado", startDay: 120, endDay: 200, ndviStart: 0.72, ndviEnd: 0.68 },
      { name: "Engrosamiento", startDay: 200, endDay: 300, ndviStart: 0.68, ndviEnd: 0.65 },
      { name: "Madurez", startDay: 300, endDay: 365, ndviStart: 0.65, ndviEnd: 0.62 },
    ],
  },

  "Limón": {
    name: "Limón",
    cycleDays: 365,
    stages: [
      { name: "Crecimiento Vegetativo", startDay: 0, endDay: 90, ndviStart: 0.50, ndviEnd: 0.68 },
      { name: "Floración", startDay: 90, endDay: 115, ndviStart: 0.68, ndviEnd: 0.70 },
      { name: "Cuajado", startDay: 115, endDay: 190, ndviStart: 0.70, ndviEnd: 0.66 },
      { name: "Engrosamiento", startDay: 190, endDay: 290, ndviStart: 0.66, ndviEnd: 0.62 },
      { name: "Madurez", startDay: 290, endDay: 365, ndviStart: 0.62, ndviEnd: 0.58 },
    ],
  },

  "Caña de Azúcar": {
    name: "Caña de Azúcar",
    cycleDays: 360,
    stages: [
      { name: "Germinación", startDay: 0, endDay: 30, ndviStart: 0.10, ndviEnd: 0.28 },
      { name: "Macollamiento", startDay: 30, endDay: 90, ndviStart: 0.28, ndviEnd: 0.58 },
      { name: "Elongación", startDay: 90, endDay: 270, ndviStart: 0.58, ndviEnd: 0.82 },
      { name: "Madurez", startDay: 270, endDay: 360, ndviStart: 0.82, ndviEnd: 0.52 },
    ],
  },

  "Alfalfa": {
    name: "Alfalfa",
    cycleDays: 60,
    stages: [
      { name: "Rebrote / Postcorte", startDay: 0, endDay: 12, ndviStart: 0.10, ndviEnd: 0.35 },
      { name: "Crecimiento Vegetativo", startDay: 12, endDay: 35, ndviStart: 0.35, ndviEnd: 0.75 },
      { name: "Pre-floración", startDay: 35, endDay: 50, ndviStart: 0.75, ndviEnd: 0.80 },
      { name: "Cosecha / Corte", startDay: 50, endDay: 60, ndviStart: 0.80, ndviEnd: 0.12 },
    ],
  },

  "Sorgo": {
    name: "Sorgo",
    cycleDays: 125,
    stages: [
      { name: "Germinación", startDay: 0, endDay: 12, ndviStart: 0.05, ndviEnd: 0.20 },
      { name: "Crecimiento Vegetativo", startDay: 12, endDay: 55, ndviStart: 0.20, ndviEnd: 0.65 },
      { name: "Espigado", startDay: 55, endDay: 80, ndviStart: 0.65, ndviEnd: 0.78 },
      { name: "Llenado de Grano", startDay: 80, endDay: 110, ndviStart: 0.78, ndviEnd: 0.55 },
      { name: "Madurez", startDay: 110, endDay: 125, ndviStart: 0.55, ndviEnd: 0.22 },
    ],
  },

  "Algodón": {
    name: "Algodón",
    cycleDays: 160,
    stages: [
      { name: "Germinación", startDay: 0, endDay: 15, ndviStart: 0.05, ndviEnd: 0.20 },
      { name: "Crecimiento Vegetativo", startDay: 15, endDay: 55, ndviStart: 0.20, ndviEnd: 0.58 },
      { name: "Floración", startDay: 55, endDay: 90, ndviStart: 0.58, ndviEnd: 0.72 },
      { name: "Formación de Cápsulas", startDay: 90, endDay: 130, ndviStart: 0.72, ndviEnd: 0.55 },
      { name: "Madurez / Apertura", startDay: 130, endDay: 160, ndviStart: 0.55, ndviEnd: 0.25 },
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

export function getCropCurve(cropName: string): CropCurve {
  const normalizedCrop = cropName.toLowerCase().trim();
  for (const [key, curve] of Object.entries(CROP_CURVES)) {
    if (key.toLowerCase() === normalizedCrop) {
      return curve;
    }
  }
  return DEFAULT_CURVE;
}

export function calculateIdealNDVI(daysSincePlanting: number, cropCurve: CropCurve): number {
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

export function getCurrentStage(daysSincePlanting: number, cropCurve: CropCurve): string {
  if (daysSincePlanting < 0) return "Pre-siembra";
  if (daysSincePlanting > cropCurve.cycleDays) return "Ciclo completado";
  
  for (const stage of cropCurve.stages) {
    if (daysSincePlanting >= stage.startDay && daysSincePlanting <= stage.endDay) {
      return stage.name;
    }
  }
  
  return "Desconocido";
}

export interface IdealCurvePoint {
  date: string;
  daysSincePlanting: number;
  idealNdvi: number;
  stage: string;
}

export function generateIdealCurveForDates(
  plantingDate: Date,
  dates: string[],
  cropName: string
): IdealCurvePoint[] {
  const curve = getCropCurve(cropName);
  
  return dates.map((dateStr) => {
    const date = new Date(dateStr);
    const daysSincePlanting = Math.floor(
      (date.getTime() - plantingDate.getTime()) / (1000 * 60 * 60 * 24)
    );
    
    return {
      date: dateStr,
      daysSincePlanting,
      idealNdvi: calculateIdealNDVI(daysSincePlanting, curve),
      stage: getCurrentStage(daysSincePlanting, curve),
    };
  });
}

export type DeviationStatus = "adelantado" | "normal" | "atrasado" | "sin_datos";

export interface DeviationResult {
  status: DeviationStatus;
  percentage: number;
  label: string;
  color: string;
}

export function calculateDeviation(actualNdvi: number, idealNdvi: number): DeviationResult {
  if (idealNdvi === 0) {
    return { status: "sin_datos", percentage: 0, label: "Sin referencia", color: "gray" };
  }
  
  const deviation = ((actualNdvi - idealNdvi) / idealNdvi) * 100;
  
  if (deviation > 15) {
    return { 
      status: "adelantado", 
      percentage: Math.round(deviation), 
      label: `+${Math.round(deviation)}% adelantado`,
      color: "emerald"
    };
  } else if (deviation < -15) {
    return { 
      status: "atrasado", 
      percentage: Math.round(Math.abs(deviation)), 
      label: `${Math.round(Math.abs(deviation))}% atrasado`,
      color: "amber"
    };
  } else {
    return { 
      status: "normal", 
      percentage: Math.round(Math.abs(deviation)), 
      label: "Desarrollo normal",
      color: "primary"
    };
  }
}

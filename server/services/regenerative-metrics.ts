import type { TillagePractices, CropRotation, AnimalIntegration, Livelihood, SoilAnalysis } from "@shared/schema";

// Note: calculateLivelihoodScore is exported for standalone use but is not
// included in the 5-pillar weighted score (Suelo 25% + Prácticas 25% +
// Labranza 20% + Rotación 20% + Animales 10% = 100%).  Livelihood data is
// collected for future reporting but does not alter the displayed grade.

interface RegenerativeMetrics {
  score: string;
  scoreNumeric: number;
  carbonSequestered: number;
  breakdown: {
    soil: number;
    practices: number;
    tillage: number;
    rotation: number;
    animals: number;
    livelihood: number;
  };
  dataCompleteness: number;
}

// ── Pillar 1: Suelo (25%) — from soil_analysis records ────────────────────────
export function calculateSoilScore(soilAnalyses: SoilAnalysis[]): number {
  if (soilAnalyses.length === 0) return 50;

  // Use the most recent analysis (copy to avoid mutating the caller's array)
  const latest = [...soilAnalyses].sort(
    (a, b) => new Date(b.analysisDate).getTime() - new Date(a.analysisDate).getTime()
  )[0];

  let score = 50;

  // Organic Matter (MO%) — most important indicator of soil health
  const mo = latest.organicMatter ? parseFloat(String(latest.organicMatter)) : null;
  if (mo !== null) {
    if (mo >= 4.0) score += 25;
    else if (mo >= 2.5) score += 15;
    else if (mo >= 1.5) score += 5;
    else score -= 10; // degraded soil
  }

  // pH — optimal range 6.0–7.0 for most crops
  const ph = latest.ph ? parseFloat(String(latest.ph)) : null;
  if (ph !== null) {
    if (ph >= 6.0 && ph <= 7.0) score += 15;
    else if (ph >= 5.5 && ph <= 7.5) score += 8;
    else score -= 5;
  }

  // Nitrogen — indicator of soil biological activity
  const n = latest.nitrogenTotal ? parseFloat(String(latest.nitrogenTotal)) : null;
  if (n !== null) {
    if (n >= 0.2) score += 6;
    else if (n >= 0.1) score += 3;
  }

  // Phosphorus — availability (ppm)
  const p = latest.phosphorus ? parseFloat(String(latest.phosphorus)) : null;
  if (p !== null) {
    if (p >= 20) score += 4;
    else if (p >= 10) score += 2;
  }

  return Math.min(100, Math.max(0, score));
}

// ── Pillar 2: Prácticas Regenerativas (25%) — from practicesJson in cycle detail ─
export function calculatePracticesScore(practicesJson: string | null | undefined): number {
  if (!practicesJson) return 40;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(practicesJson);
  } catch {
    return 40;
  }

  let score = 30;

  // Tillage type from wizard (complements the detailed tillage table)
  const labranza = (parsed.labranzaType as string | null)?.toLowerCase() ?? "";
  if (labranza === "cero" || labranza === "directa") score += 30;
  else if (labranza === "minima") score += 20;
  else if (labranza === "convencional") score += 5;

  // Fertilizer type — organic/biological better than synthetic
  const fertSynthetic = parsed.fertilizerSynthetic;
  if (fertSynthetic === false) score += 15;    // organic or bio
  else if (fertSynthetic === null || fertSynthetic === undefined) score += 10; // none
  else score += 0;                              // synthetic — no bonus

  // Pest management
  const pest = (parsed.pestManagement as string | null)?.toLowerCase() ?? "";
  if (pest === "organico") score += 15;
  else if (pest === "mip") score += 12;
  else if (pest === "ninguno") score += 8;
  else if (pest === "convencional") score += 2;

  // Regenerative practices checklist — each item adds points (max 20)
  const regen = Array.isArray(parsed.regenerativePractices)
    ? (parsed.regenerativePractices as string[])
    : [];
  score += Math.min(20, regen.length * 4);

  return Math.min(100, Math.max(0, score));
}

// ── Pillar 3: Labranza (20%) ───────────────────────────────────────────────────
export function calculateTillageScore(practices: TillagePractices[]): number {
  if (practices.length === 0) return 70;

  let totalScore = 0;

  for (const practice of practices) {
    let practiceScore = 100;

    const totalPasses = (practice.desvaradora ?? 0) + (practice.barbecho ?? 0) +
                        (practice.aradoSubsolado ?? 0) + (practice.rastra ?? 0) +
                        (practice.nivelacion ?? 0) + (practice.escarda ?? 0);

    if (totalPasses === 0) practiceScore = 100;
    else if (totalPasses <= 2) practiceScore = 90;
    else if (totalPasses <= 4) practiceScore = 75;
    else if (totalPasses <= 6) practiceScore = 60;
    else practiceScore = 40;

    if (practice.burnsResidues) practiceScore -= 30;

    const residueLeft = practice.residuePercentLeft ?? 0;
    if (residueLeft >= 100) practiceScore += 15;
    else if (residueLeft >= 50) practiceScore += 10;
    else if (residueLeft >= 33) practiceScore += 5;

    const residueUses = practice.residueUse ?? [];
    if (residueUses.includes("composta")) practiceScore += 5;
    if (residueUses.includes("pastoreo")) practiceScore += 3;

    const yearsReduced = practice.yearsReducingTillage ?? 0;
    if (yearsReduced >= 5) practiceScore += 10;
    else if (yearsReduced >= 3) practiceScore += 5;

    totalScore += Math.min(100, Math.max(0, practiceScore));
  }

  return totalScore / practices.length;
}

// ── Pillar 4: Rotación (20%) ───────────────────────────────────────────────────
export function calculateRotationScore(rotations: CropRotation[]): number {
  if (rotations.length === 0) return 50;

  const crops = new Set<string>();
  let hasLegumes = false;
  let hasCoverCrops = false;

  for (const rotation of rotations) {
    if (rotation.springCrops) {
      rotation.springCrops.split(",").forEach(c => crops.add(c.trim().toLowerCase()));
    }
    if (rotation.fallCrops) {
      rotation.fallCrops.split(",").forEach(c => crops.add(c.trim().toLowerCase()));
    }

    const allCrops = `${rotation.springCrops ?? ""} ${rotation.fallCrops ?? ""}`.toLowerCase();
    if (allCrops.includes("frijol") || allCrops.includes("soya") || allCrops.includes("lenteja") ||
        allCrops.includes("garbanzo") || allCrops.includes("haba") || allCrops.includes("legum") ||
        allCrops.includes("alfalfa") || allCrops.includes("trébol")) {
      hasLegumes = true;
    }
    if (allCrops.includes("cobertura") || allCrops.includes("abono verde") || allCrops.includes("cover")) {
      hasCoverCrops = true;
    }
  }

  let score = 40;

  const diversity = crops.size;
  if (diversity >= 5) score += 30;
  else if (diversity >= 3) score += 20;
  else if (diversity >= 2) score += 10;

  if (hasLegumes) score += 15;
  if (hasCoverCrops) score += 15;

  const rotationType = rotations[0]?.rotationSystem?.toLowerCase() ?? "";
  if (rotationType.includes("agroforestal")) score += 15;
  else if (rotationType.includes("rotacion")) score += 10;

  return Math.min(100, score);
}

// ── Pillar 5: Animales (10%) ───────────────────────────────────────────────────
export function calculateAnimalScore(animal: AnimalIntegration | null): number {
  if (!animal) return 50;

  let score = 60;

  const grazingSystem = animal.grazingSystem?.toLowerCase() ?? "";
  if (grazingSystem.includes("rotacional") || grazingSystem.includes("regenerativo") || grazingSystem.includes("holístico")) {
    score += 20;
  } else if (grazingSystem.includes("continuo")) {
    score -= 10;
  }

  const compostTypes = animal.compostType ?? [];
  if (compostTypes.length > 0) {
    score += 10;
    if (compostTypes.includes("lombricomposta")) score += 5;
    if (compostTypes.includes("termico")) score += 5;
  }

  const manureUses = animal.manureUse ?? [];
  if (manureUses.includes("composta")) score += 10;
  else if (manureUses.includes("crudo")) score += 5;

  const totalAnimals = (animal.bovinosCount ?? 0) + (animal.ovinosCount ?? 0) +
                       (animal.caprinosCount ?? 0) + (animal.porcinosCount ?? 0) +
                       (animal.avesCount ?? 0);
  if (totalAnimals > 0) score += 5;

  return Math.min(100, Math.max(0, score));
}

export function calculateLivelihoodScore(livelihood: Livelihood | null): number {
  if (!livelihood) return 50;

  let score = 50;

  const benefits = livelihood.sustainableBenefits ?? [];
  if (Array.isArray(benefits)) score += Math.min(25, benefits.length * 5);

  let directSalesCount = 0;
  if (livelihood.sellsToConsumers) directSalesCount++;
  if (livelihood.sellsToCooperatives) directSalesCount++;
  score += directSalesCount * 5;

  if (livelihood.receivesSustainablePremium) score += 15;

  const incomePerception = livelihood.incomePerception?.toLowerCase() ?? "";
  if (incomePerception.includes("creciendo") || incomePerception.includes("consolidando")) score += 10;
  else if (incomePerception.includes("estable")) score += 5;

  return Math.min(100, score);
}

export function numericToGrade(score: number): string {
  if (score >= 90) return "A+";
  if (score >= 80) return "A";
  if (score >= 65) return "B";
  if (score >= 50) return "C";
  if (score >= 30) return "D";
  return "F";
}

export function estimateCarbonSequestration(
  areaHectares: number,
  ndviAverage: number | null,
  tillageScore: number,
  rotationScore: number,
  animalScore: number,
  soilScore: number
): number {
  const baseCarbonPerHa = 2.5;

  let ndviFactor = 1.0;
  if (ndviAverage !== null) {
    if (ndviAverage >= 0.7) ndviFactor = 1.5;
    else if (ndviAverage >= 0.5) ndviFactor = 1.3;
    else if (ndviAverage >= 0.3) ndviFactor = 1.1;
    else if (ndviAverage >= 0.1) ndviFactor = 0.9;
    else ndviFactor = 0.7;
  }

  // Soil organic matter is the primary driver of carbon sequestration
  const practiceScore = (tillageScore + rotationScore + animalScore + soilScore) / 4;
  const practiceFactor = 0.5 + (practiceScore / 100) * 1.0;

  const carbonPerHa = baseCarbonPerHa * ndviFactor * practiceFactor;
  const totalCarbon = carbonPerHa * areaHectares;

  return Math.round(totalCarbon * 10) / 10;
}

// ── Data completeness: how much the user has filled in (0–100) ─────────────────
function calculateDataCompleteness(
  hasSoil: boolean,
  hasPractices: boolean,
  hasTillage: boolean,
  hasRotation: boolean,
  hasAnimal: boolean
): number {
  const filled = [hasSoil, hasPractices, hasTillage, hasRotation, hasAnimal].filter(Boolean).length;
  return Math.round((filled / 5) * 100);
}

// ── Main export ────────────────────────────────────────────────────────────────
export function calculateRegenerativeMetrics(
  areaHectares: number,
  ndviAverage: number | null,
  tillage: TillagePractices[],
  rotations: CropRotation[],
  animal: AnimalIntegration | null,
  livelihood: Livelihood | null,
  soilAnalyses?: SoilAnalysis[],
  practicesJson?: string | null
): RegenerativeMetrics {
  const soilScore     = calculateSoilScore(soilAnalyses ?? []);
  const practicesScore = calculatePracticesScore(practicesJson);
  const tillageScore  = calculateTillageScore(tillage);
  const rotationScore = calculateRotationScore(rotations);
  const animalScore   = calculateAnimalScore(animal);

  // 5-pillar weighted score — reflects all reported indicators
  const overallScore = (
    soilScore      * 0.25 +
    practicesScore * 0.25 +
    tillageScore   * 0.20 +
    rotationScore  * 0.20 +
    animalScore    * 0.10
  );

  const carbonSequestered = estimateCarbonSequestration(
    areaHectares,
    ndviAverage,
    tillageScore,
    rotationScore,
    animalScore,
    soilScore
  );

  const dataCompleteness = calculateDataCompleteness(
    (soilAnalyses ?? []).length > 0,
    !!practicesJson,
    tillage.length > 0,
    rotations.length > 0,
    !!animal
  );

  return {
    score: numericToGrade(overallScore),
    scoreNumeric: Math.round(overallScore),
    carbonSequestered,
    breakdown: {
      soil:      Math.round(soilScore),
      practices: Math.round(practicesScore),
      tillage:   Math.round(tillageScore),
      rotation:  Math.round(rotationScore),
      animals:   Math.round(animalScore),
      livelihood: 0,
    },
    dataCompleteness,
  };
}

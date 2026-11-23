import { describe, it, expect } from "vitest";
import {
  calculateTillageScore,
  calculateRotationScore,
  calculateAnimalScore,
  calculateLivelihoodScore,
  numericToGrade,
  estimateCarbonSequestration,
  calculateRegenerativeMetrics,
} from "../server/services/regenerative-metrics";
import type { TillagePractices, CropRotation, AnimalIntegration, Livelihood } from "../shared/schema";

const BASE_TILLAGE: TillagePractices = {
  id: "t1",
  parcelId: "p1",
  cycleYear: 2024,
  cycleSeason: "primavera-verano",
  desvaradora: 0,
  barbecho: 0,
  aradoSubsolado: 0,
  rastra: 0,
  nivelacion: 0,
  aplicacionAbonos: 0,
  siembra: 0,
  fertilizantesQuimicos: 0,
  escarda: 0,
  aplicacionAgroquimicos: 0,
  cosechadora: 0,
  recoleccion: 0,
  recoleccionRastrojo: 0,
  costoDesvaradora: null,
  costoBarbecho: null,
  costoAradoSubsolado: null,
  costoRastra: null,
  costoNivelacion: null,
  costoAplicacionAbonos: null,
  costoSiembra: null,
  costoFertilizantesQuimicos: null,
  costoEscarda: null,
  costoAplicacionAgroquimicos: null,
  costoCosechadora: null,
  costoRecoleccion: null,
  costoRecoleccionRastrojo: null,
  yearsReducingTillage: null,
  burnsResidues: false,
  residuePercentLeft: null,
  residueUse: [],
  createdAt: new Date(),
};

const BASE_ROTATION: CropRotation = {
  id: "r1",
  parcelId: "p1",
  year: 2024,
  campaignYear: null,
  springCrops: null,
  fallCrops: null,
  rotationSystem: null,
  rotationSystemDetails: null,
  cropSequence: null,
  createdAt: new Date(),
};

const BASE_ANIMAL: AnimalIntegration = {
  id: "a1",
  parcelId: "p1",
  hasBovinos: false,
  bovinosCount: null,
  hasOvinos: false,
  ovinosCount: null,
  hasCaprinos: false,
  caprinosCount: null,
  hasAves: false,
  avesCount: null,
  hasPorcinos: false,
  porcinosCount: null,
  hasEquinos: false,
  equinosCount: null,
  otherAnimals: null,
  otherAnimalsCount: null,
  grazingSystem: null,
  grazingSystemDetails: null,
  allowsPostHarvestGrazing: null,
  postHarvestGrazingConditions: [],
  manureUse: [],
  manureApplicationFrequency: null,
  manureQuantityTons: null,
  compostType: [],
  compostMaterials: [],
  lotRotationFrequency: null,
  numberOfLots: null,
  averageLotSize: null,
  rotatedSpecies: null,
  restDays: null,
  animalLoadPerHa: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const BASE_LIVELIHOOD: Livelihood = {
  id: "l1",
  parcelId: "p1",
  incomeAgricultural: null,
  incomeAnimal: null,
  incomeNonAgricultural: null,
  incomeRemittances: null,
  incomeOther: null,
  incomeOtherDetails: null,
  incomePerception: null,
  sellsToConsumers: false,
  sellsToIntermediaries: false,
  sellsToCompanies: false,
  sellsToCooperatives: false,
  sellsToGovernment: false,
  sellsOther: null,
  salesProcess: [],
  receivesSustainablePremium: false,
  sustainableBenefits: [],
  perceivedBenefits: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ─── calculateTillageScore ────────────────────────────────────────────────────

describe("calculateTillageScore", () => {
  it("returns 70 for empty array (optimistic baseline — no history means benefit of doubt)", () => {
    expect(calculateTillageScore([])).toBe(70);
  });

  it("returns 100 when zero tillage passes", () => {
    expect(calculateTillageScore([BASE_TILLAGE])).toBe(100);
  });

  it("returns 40 when total passes > 6", () => {
    const practice: TillagePractices = { ...BASE_TILLAGE, desvaradora: 3, barbecho: 2, rastra: 2 };
    const score = calculateTillageScore([practice]);
    expect(score).toBe(40);
  });

  it("applies -30 penalty for burning residues", () => {
    const practice: TillagePractices = { ...BASE_TILLAGE, burnsResidues: true };
    expect(calculateTillageScore([practice])).toBe(70);
  });

  it("applies +5 bonus for 3 years reducing tillage", () => {
    const practice: TillagePractices = { ...BASE_TILLAGE, yearsReducingTillage: 3 };
    expect(calculateTillageScore([practice])).toBe(100);
  });

  it("applies +10 bonus for 5+ years reducing tillage", () => {
    const practice: TillagePractices = { ...BASE_TILLAGE, yearsReducingTillage: 5 };
    expect(calculateTillageScore([practice])).toBe(100);
  });

  it("applies residue left >= 50 bonus +10", () => {
    const practice: TillagePractices = { ...BASE_TILLAGE, residuePercentLeft: 50 };
    expect(calculateTillageScore([practice])).toBe(100);
  });

  it("clamps to 0 minimum (burn + many passes)", () => {
    const p: TillagePractices = { ...BASE_TILLAGE, desvaradora: 5, barbecho: 5, burnsResidues: true };
    expect(calculateTillageScore([p])).toBeGreaterThanOrEqual(0);
  });

  it("averages multiple practices", () => {
    const p1: TillagePractices = { ...BASE_TILLAGE };
    const p2: TillagePractices = { ...BASE_TILLAGE, burnsResidues: true };
    const score = calculateTillageScore([p1, p2]);
    expect(score).toBe((100 + 70) / 2);
  });

  it("adds compost bonus +5", () => {
    const p: TillagePractices = { ...BASE_TILLAGE, residueUse: ["composta"] };
    expect(calculateTillageScore([p])).toBe(100);
  });
});

// ─── calculateRotationScore ───────────────────────────────────────────────────

describe("calculateRotationScore", () => {
  it("returns 50 for empty array", () => {
    expect(calculateRotationScore([])).toBe(50);
  });

  it("score >= 80 for 5 distinct crops including a legume", () => {
    const rotation: CropRotation = {
      ...BASE_ROTATION,
      springCrops: "maiz, trigo, frijol",
      fallCrops: "cebada, avena",
    };
    const score = calculateRotationScore([rotation]);
    expect(score).toBeGreaterThanOrEqual(80);
  });

  it("adds legume bonus for frijol", () => {
    const rotation: CropRotation = { ...BASE_ROTATION, springCrops: "frijol" };
    const score = calculateRotationScore([rotation]);
    expect(score).toBeGreaterThan(40 + 10);
  });

  it("adds cover crop bonus", () => {
    const rotation: CropRotation = { ...BASE_ROTATION, fallCrops: "cobertura" };
    const score = calculateRotationScore([rotation]);
    expect(score).toBeGreaterThan(40 + 10);
  });

  it("adds agroforestal bonus", () => {
    const rotation: CropRotation = { ...BASE_ROTATION, rotationSystem: "agroforestal" };
    const score = calculateRotationScore([rotation]);
    expect(score).toBeGreaterThan(40 + 10);
  });

  it("does not exceed 100", () => {
    const rotation: CropRotation = {
      ...BASE_ROTATION,
      springCrops: "maiz, trigo, sorgo, soya, cebada",
      fallCrops: "cobertura, frijol",
      rotationSystem: "agroforestal",
    };
    expect(calculateRotationScore([rotation])).toBeLessThanOrEqual(100);
  });

  it("2 distinct crops add partial bonus", () => {
    const rotation: CropRotation = { ...BASE_ROTATION, springCrops: "maiz, trigo" };
    const score = calculateRotationScore([rotation]);
    expect(score).toBe(50);
  });
});

// ─── calculateAnimalScore ─────────────────────────────────────────────────────

describe("calculateAnimalScore", () => {
  it("returns 50 for null", () => {
    expect(calculateAnimalScore(null)).toBe(50);
  });

  it("rotational grazing gives score >= 70", () => {
    const animal: AnimalIntegration = { ...BASE_ANIMAL, grazingSystem: "rotacional" };
    const score = calculateAnimalScore(animal);
    expect(score).toBeGreaterThanOrEqual(70);
  });

  it("continuo grazing applies penalty < base 60", () => {
    const animal: AnimalIntegration = { ...BASE_ANIMAL, grazingSystem: "continuo" };
    const score = calculateAnimalScore(animal);
    expect(score).toBeLessThan(60);
  });

  it("vermicomposta bonus applied", () => {
    const animal: AnimalIntegration = { ...BASE_ANIMAL, compostType: ["lombricomposta"] };
    const score = calculateAnimalScore(animal);
    expect(score).toBeGreaterThan(60);
  });

  it("animal counts > 0 adds bonus", () => {
    const animal: AnimalIntegration = { ...BASE_ANIMAL, bovinosCount: 10 };
    expect(calculateAnimalScore(animal)).toBeGreaterThan(60);
  });

  it("does not exceed 100", () => {
    const animal: AnimalIntegration = {
      ...BASE_ANIMAL,
      grazingSystem: "rotacional holístico",
      compostType: ["lombricomposta", "termico"],
      manureUse: ["composta"],
      bovinosCount: 20,
    };
    expect(calculateAnimalScore(animal)).toBeLessThanOrEqual(100);
  });
});

// ─── calculateLivelihoodScore ─────────────────────────────────────────────────

describe("calculateLivelihoodScore", () => {
  it("returns 50 for null", () => {
    expect(calculateLivelihoodScore(null)).toBe(50);
  });

  it("sustainable benefits add +5 each up to max 25", () => {
    const l: Livelihood = { ...BASE_LIVELIHOOD, sustainableBenefits: ["a", "b", "c"] };
    expect(calculateLivelihoodScore(l)).toBe(65);
  });

  it("sustainable premium adds +15", () => {
    const l: Livelihood = { ...BASE_LIVELIHOOD, receivesSustainablePremium: true };
    expect(calculateLivelihoodScore(l)).toBe(65);
  });

  it("sells to consumers adds +5", () => {
    const l: Livelihood = { ...BASE_LIVELIHOOD, sellsToConsumers: true };
    expect(calculateLivelihoodScore(l)).toBe(55);
  });

  it("growing income adds +10", () => {
    const l: Livelihood = { ...BASE_LIVELIHOOD, incomePerception: "creciendo" };
    expect(calculateLivelihoodScore(l)).toBe(60);
  });

  it("does not exceed 100", () => {
    const l: Livelihood = {
      ...BASE_LIVELIHOOD,
      sustainableBenefits: ["a", "b", "c", "d", "e", "f"],
      sellsToConsumers: true,
      sellsToCooperatives: true,
      receivesSustainablePremium: true,
      incomePerception: "creciendo",
    };
    expect(calculateLivelihoodScore(l)).toBeLessThanOrEqual(100);
  });
});

// ─── numericToGrade ───────────────────────────────────────────────────────────

describe("numericToGrade", () => {
  it("95 -> A+", () => expect(numericToGrade(95)).toBe("A+"));
  it("90 -> A+", () => expect(numericToGrade(90)).toBe("A+"));
  it("80 -> A",  () => expect(numericToGrade(80)).toBe("A"));
  it("82 -> A",  () => expect(numericToGrade(82)).toBe("A"));
  it("65 -> B",  () => expect(numericToGrade(65)).toBe("B"));
  it("70 -> B",  () => expect(numericToGrade(70)).toBe("B"));
  it("50 -> C",  () => expect(numericToGrade(50)).toBe("C"));
  it("60 -> C",  () => expect(numericToGrade(60)).toBe("C"));
  it("30 -> D",  () => expect(numericToGrade(30)).toBe("D"));
  it("45 -> D",  () => expect(numericToGrade(45)).toBe("D"));
  it("10 -> F",  () => expect(numericToGrade(10)).toBe("F"));
  it("29 -> F",  () => expect(numericToGrade(29)).toBe("F"));
});

// ─── estimateCarbonSequestration ──────────────────────────────────────────────

describe("estimateCarbonSequestration", () => {
  it("area 0 returns 0", () => {
    expect(estimateCarbonSequestration(0, 0.5, 80, 80, 80, 80)).toBe(0);
  });

  it("high NDVI + optimal practices > base rate × area", () => {
    const baseRate = 2.5;
    const area = 10;
    const carbon = estimateCarbonSequestration(area, 0.8, 90, 90, 90, 90);
    expect(carbon).toBeGreaterThan(baseRate * area);
  });

  it("low NDVI (0.1) < base rate × area", () => {
    const baseRate = 2.5;
    const area = 10;
    const carbon = estimateCarbonSequestration(area, 0.1, 50, 50, 50, 50);
    expect(carbon).toBeLessThan(baseRate * area);
  });

  it("null NDVI uses default factor 1.0", () => {
    const carbon = estimateCarbonSequestration(5, null, 50, 50, 50, 50);
    expect(carbon).toBeGreaterThan(0);
  });

  it("NDVI >= 0.7 applies 1.5 factor", () => {
    const c07 = estimateCarbonSequestration(10, 0.7, 80, 80, 80, 80);
    const c05 = estimateCarbonSequestration(10, 0.5, 80, 80, 80, 80);
    expect(c07).toBeGreaterThan(c05);
  });
});

// ─── calculateRegenerativeMetrics (integration) ───────────────────────────────

describe("calculateRegenerativeMetrics", () => {
  it("returns correct shape", () => {
    const m = calculateRegenerativeMetrics(10, 0.5, [], [], null, null);
    expect(m).toHaveProperty("score");
    expect(m).toHaveProperty("scoreNumeric");
    expect(m).toHaveProperty("carbonSequestered");
    expect(m).toHaveProperty("breakdown");
  });

  it("scoreNumeric is in [0, 100]", () => {
    const m = calculateRegenerativeMetrics(10, 0.5, [BASE_TILLAGE], [BASE_ROTATION], BASE_ANIMAL, null);
    expect(m.scoreNumeric).toBeGreaterThanOrEqual(0);
    expect(m.scoreNumeric).toBeLessThanOrEqual(100);
  });

  it("carbon > 0 for positive area", () => {
    const m = calculateRegenerativeMetrics(5, 0.6, [], [], null, null);
    expect(m.carbonSequestered).toBeGreaterThan(0);
  });
});

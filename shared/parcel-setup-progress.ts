export const PARCEL_SETUP_STEPS = [
  { key: "stepCycle", id: "cycle", label: "Ciclo", required: true },
  { key: "stepSoil", id: "soil", label: "Suelo", required: true },
  { key: "stepEconomy", id: "economy", label: "Economía", required: true },
  { key: "stepPractices", id: "practices", label: "Prácticas", required: true },
  { key: "stepSoilBio", id: "microbio", label: "Microbiología", required: false },
  { key: "stepTissue", id: "tejidos", label: "Tejidos", required: false },
  { key: "stepWater", id: "agua", label: "Agua", required: false },
] as const;

export type ParcelSetupProgress = {
  steps: typeof PARCEL_SETUP_STEPS;
  flags: Record<(typeof PARCEL_SETUP_STEPS)[number]["key"], boolean>;
  completedCount: number;
  totalCount: number;
  percentage: number;
  isComplete: boolean;
};

/** Accepts both the legacy root flags and the nested `progress` shape. */
export function getParcelSetupCompletion(data: unknown): ParcelSetupProgress {
  const response = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const nested = response.progress && typeof response.progress === "object"
    ? response.progress as Record<string, unknown>
    : {};
  const flags = Object.fromEntries(PARCEL_SETUP_STEPS.map(({ key }) => {
    const value = typeof response[key] === "boolean" ? response[key] : nested[key];
    return [key, value === true];
  })) as ParcelSetupProgress["flags"];
  const totalCount = PARCEL_SETUP_STEPS.length;
  const completedCount = PARCEL_SETUP_STEPS.filter(({ key }) => flags[key]).length;
  return {
    steps: PARCEL_SETUP_STEPS,
    flags,
    completedCount,
    totalCount,
    percentage: Math.round((completedCount / totalCount) * 100),
    isComplete: completedCount === totalCount,
  };
}

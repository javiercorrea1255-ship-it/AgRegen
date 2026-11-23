export type ToolModule = "base" | "drones" | "iot" | "riego-inteligente" | "precision";

// Feature flags — set to false to re-enable the module
export const HIDE_DRONES = true;
export const HIDE_IOT = true;

export interface ModuleDefinition {
  id: ToolModule;
  icon: string;
  requiredField?: string;
  tools: string[];
}

export const moduleDefinitions: ModuleDefinition[] = [
  {
    id: "base",
    icon: "Satellite",
    tools: ["satellite-monitoring", "weather", "soil-analysis", "regenerative-score", "ai-assistant", "community"],
  },
  {
    id: "drones",
    icon: "Plane",
    requiredField: "hasDrones",
    tools: ["drone-upload", "drone-viewer", "drone-vs-satellite", "flight-planning"],
  },
  {
    id: "iot",
    icon: "Cpu",
    requiredField: "hasIoT",
    tools: ["sensor-dashboard", "device-management", "sensor-alerts", "sensor-history"],
  },
  {
    id: "riego-inteligente",
    icon: "Droplets",
    tools: ["water-balance", "irrigation-schedule", "water-usage", "irrigation-efficiency"],
  },
  {
    id: "precision",
    icon: "Target",
    tools: ["variable-rate-maps", "zone-management", "multi-parcel-comparison", "yield-estimation"],
  },
];

export interface UserTechProfile {
  producerType?: string | null;
  hasDrones?: boolean | null;
  hasIoT?: boolean | null;
  techLevel?: string | null;
}

export function getActiveModules(profile: UserTechProfile, irrigationSystem?: string | null): ToolModule[] {
  const modules: ToolModule[] = ["base"];

  if (!HIDE_DRONES && profile.hasDrones) {
    modules.push("drones");
  }

  if (!HIDE_IOT && profile.hasIoT) {
    modules.push("iot");
  }

  if (irrigationSystem && irrigationSystem !== "temporal" && irrigationSystem !== "ninguno") {
    modules.push("riego-inteligente");
  }

  if (profile.producerType === "grande" || profile.techLevel === "avanzado") {
    modules.push("precision");
  }

  return modules;
}

export function isModuleActive(module: ToolModule, activeModules: ToolModule[]): boolean {
  return activeModules.includes(module);
}

export function getModuleDefinition(moduleId: ToolModule): ModuleDefinition | undefined {
  return moduleDefinitions.find(m => m.id === moduleId);
}

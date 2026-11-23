import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { blankSample, buildDemoSamples } from "./constants";
import { computeSample } from "./engine";
import type { ComputedSample, SoilSample } from "./types";

const STORAGE_KEY_BASE = "agregen-amendments-v1";
const MAX_SAMPLES = 10;

interface PersistedState {
  projectName: string;
  samples: SoilSample[];
}

function storageKeyFor(scopeId?: string): string {
  if (scopeId) return `${STORAGE_KEY_BASE}:parcel:${scopeId}`;
  return `${STORAGE_KEY_BASE}:standalone`;
}

function loadState(key: string): PersistedState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedState;
    if (!parsed || !Array.isArray(parsed.samples)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveState(key: string, state: PersistedState) {
  try {
    window.localStorage.setItem(key, JSON.stringify(state));
  } catch {}
}

export interface UseAmendmentsCalculatorOptions {
  scopeId?: string;
}

export function useAmendmentsCalculator(options: UseAmendmentsCalculatorOptions = {}) {
  const { scopeId } = options;
  const [projectName, setProjectName] = useState<string>("Calculadora de enmiendas");
  const [samples, setSamples] = useState<SoilSample[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const currentKeyRef = useRef<string | null>(null);
  // Tracks the scope whose data is currently hydrated in state.
  // Persistence is gated on this matching the active scope to avoid writing
  // the previous scope's state into the new scope's key during transitions.
  const [hydratedScope, setHydratedScope] = useState<string | null>(null);

  // (Re)hydrate when scope changes
  useEffect(() => {
    const key = storageKeyFor(scopeId);
    currentKeyRef.current = key;
    setHydrated(false);
    const persisted = loadState(key);
    if (persisted && persisted.samples.length > 0) {
      setProjectName(persisted.projectName || "Calculadora de enmiendas");
      setSamples(persisted.samples);
      setActiveId(persisted.samples[0].id);
    } else {
      const first = blankSample("Muestra 1");
      setSamples([first]);
      setActiveId(first.id);
      setProjectName("Calculadora de enmiendas");
    }
    setHydratedScope(key);
    setHydrated(true);
  }, [scopeId]);

  // Persist to the current scope's key (only when hydrated state belongs to the active scope).
  useEffect(() => {
    if (!hydrated) return;
    const key = currentKeyRef.current;
    if (!key || hydratedScope !== key) return;
    saveState(key, { projectName, samples });
  }, [projectName, samples, hydrated, hydratedScope]);

  const addSample = useCallback(() => {
    setSamples((prev) => {
      if (prev.length >= MAX_SAMPLES) return prev;
      const s = blankSample(`Muestra ${prev.length + 1}`);
      setActiveId(s.id);
      return [...prev, s];
    });
  }, []);

  const duplicateSample = useCallback((id: string) => {
    setSamples((prev) => {
      if (prev.length >= MAX_SAMPLES) return prev;
      const src = prev.find((s) => s.id === id);
      if (!src) return prev;
      const copy: SoilSample = { ...src, id: crypto.randomUUID(), name: src.name + " (copia)" };
      setActiveId(copy.id);
      return [...prev, copy];
    });
  }, []);

  const deleteSample = useCallback((id: string) => {
    setSamples((prev) => {
      const next = prev.filter((s) => s.id !== id);
      if (next.length === 0) {
        const fresh = blankSample("Muestra 1");
        setActiveId(fresh.id);
        return [fresh];
      }
      setActiveId((cur) => (cur === id ? next[0].id : cur));
      return next;
    });
  }, []);

  const updateSample = useCallback((id: string, updates: Partial<SoilSample>) => {
    setSamples((prev) => prev.map((s) => (s.id === id ? { ...s, ...updates } : s)));
  }, []);

  const updateAllSamples = useCallback((updates: Partial<SoilSample>) => {
    setSamples((prev) => prev.map((s) => ({ ...s, ...updates })));
  }, []);

  const loadDemo = useCallback(() => {
    const demo = buildDemoSamples();
    setSamples(demo);
    setActiveId(demo[0].id);
    setProjectName("Casos de demostración");
  }, []);

  const clearAll = useCallback(() => {
    const fresh = blankSample("Muestra 1");
    setSamples([fresh]);
    setActiveId(fresh.id);
    setProjectName("Calculadora de enmiendas");
  }, []);

  const computed: ComputedSample[] = useMemo(
    () => samples.map((s) => computeSample(s)),
    [samples],
  );

  return {
    hydrated,
    projectName,
    setProjectName,
    samples,
    activeId,
    setActiveId,
    addSample,
    duplicateSample,
    deleteSample,
    updateSample,
    updateAllSamples,
    loadDemo,
    clearAll,
    computed,
    canAdd: samples.length < MAX_SAMPLES,
  };
}

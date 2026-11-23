import { useState, useEffect } from "react";
import type { SamplingPoint } from "@shared/schema";

export interface InterpolationReadiness {
  ready: boolean;
  reasons: string[];
  geoHealthy: boolean | null;
  geoChecking: boolean;
}

let healthCache: { ts: number; healthy: boolean } | null = null;
const CACHE_TTL_MS = 60_000;

export function useInterpolationReadiness(measuredPoints: SamplingPoint[]): InterpolationReadiness {
  const [geoHealthy, setGeoHealthy] = useState<boolean | null>(null);
  const [geoChecking, setGeoChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const now = Date.now();
    if (healthCache && now - healthCache.ts < CACHE_TTL_MS) {
      setGeoHealthy(healthCache.healthy);
      setGeoChecking(false);
      return;
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    (async () => {
      try {
        const r = await fetch("/api/geo-service/health", {
          credentials: "include",
          signal: controller.signal,
        });
        if (!cancelled) {
          const healthy = r.ok;
          healthCache = { ts: Date.now(), healthy };
          setGeoHealthy(healthy);
        }
      } catch {
        if (!cancelled) {
          healthCache = { ts: Date.now(), healthy: false };
          setGeoHealthy(false);
        }
      } finally {
        clearTimeout(timeoutId);
        if (!cancelled) setGeoChecking(false);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeoutId);
    };
  }, []);

  const reasons: string[] = [];
  const n = measuredPoints.length;

  if (n < 3) {
    reasons.push(`Se necesitan al menos 3 puntos con valor medido (tienes ${n})`);
  } else {
    const vals = measuredPoints.map((p) => Number(p.value));
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    if (max - min < 1e-9) {
      reasons.push("Todos los valores medidos son iguales — sin variabilidad para interpolar");
    }
  }

  if (geoHealthy === false) {
    reasons.push("El servicio de mapas no está disponible actualmente");
  }

  return {
    ready: reasons.length === 0,
    reasons,
    geoHealthy,
    geoChecking,
  };
}

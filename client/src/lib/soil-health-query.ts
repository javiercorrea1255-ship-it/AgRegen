import type { SoilHealthList } from "@shared/soil-health";

export const soilHealthQueryKey = (userId: string, parcelId: string) => ["soil-health", userId, parcelId] as const;
export function soilHealthQueryOptions(userId: string, parcelId: string) {
  return {
    queryKey: soilHealthQueryKey(userId, parcelId),
    enabled: !!userId && !!parcelId,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always" as const,
    queryFn: async ({ signal }: { signal: AbortSignal }): Promise<SoilHealthList> => {
      const res = await fetch(`/api/parcels/${parcelId}/soil-health`, { credentials: "include", cache: "no-store", signal });
      if (!res.ok) throw new Error("No se pudieron consultar las evaluaciones de este predio");
      return res.json();
    },
  };
}
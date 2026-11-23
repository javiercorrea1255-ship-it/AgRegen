/** A parcel link is not evidence that a notebook's totals cover that same area. */
export function costAreaEvidence(parcelArea: unknown,
  costs: { id: string; notes?: string | null; quantity?: unknown; unit?: string | null; areaHa?: unknown; areaConfirmed?: boolean }[],
  logs: { id: string; structuredData: unknown }[]) {
  const target = Number(parcelArea);
  const sources = [
    ...costs.map(c => ({ id: `costos:${c.id}`, areaHa: c.areaHa ??
      (/^(ha|hect[aá]reas?)$/i.test(c.unit || "") ? c.quantity : null),
      confirmed: c.areaConfirmed, text: c.notes || "" })),
    ...logs.flatMap(log => {
      const data = log.structuredData as any;
      if (!(data?.items || []).some((i: any) => i.cost != null)) return [];
      return [{ id: `bitácora:${log.id}`, areaHa: data.areaHa ?? data.sourceAreaHa,
        confirmed: data.areaConfirmed, text: String(data.observations || "") }];
    }),
  ].map(source => {
    const explicit = source.text.match(/\b(\d+(?:[.,]\d+)?)\s*(?:ha\b|hect[aá]reas?\b)/i);
    const raw = source.areaHa ?? explicit?.[1]?.replace(",", ".");
    const area = raw == null || raw === "" ? null : Number(raw);
    const valid = area != null && Number.isFinite(area) && area > 0;
    return { source: source.id, areaHa: valid ? area : null,
      status: !valid || source.confirmed === false ? "unconfirmed"
        : Math.abs(area - target) > .005 ? "mismatch" : "matches" };
  });
  const unsafe = sources.filter(s => s.status !== "matches");
  return { parcelAreaHa: Number.isFinite(target) ? target : null, sources,
    comparable: sources.length > 0 && unsafe.length === 0,
    warning: unsafe.length ? "Superficie de costos distinta o sin confirmar: no atribuir sus totales, costo/ha ni rentabilidad a esta parcela. Confirmar primero; los precios unitarios pueden usarse indicando fuente." : null };
}

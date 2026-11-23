/** Decimal degrees only: never silently accept part of a coordinate. */
function parseDecimalDegrees(value: string): number {
  const trimmed = value.trim();
  if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(trimmed)) {
    return NaN;
  }
  return Number(trimmed.replace(",", "."));
}

export function parseManualCoordinates(latitude: string, longitude: string): [number, number] | null {
  const lat = parseDecimalDegrees(latitude);
  const lng = parseDecimalDegrees(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return null;
  }
  return [lat, lng];
}

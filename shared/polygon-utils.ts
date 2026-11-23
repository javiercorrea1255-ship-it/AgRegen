// Polygon helpers shared by client and server. Coordinate convention follows
// what's stored in `parcels.polygonCoordinates`: array of [lat, lng] pairs
// (NOT GeoJSON [lon, lat]).

export type LatLng = [number, number];

/** Returns true if a polygon is valid: ≥3 distinct vertices and non-zero area. */
export function isValidPolygon(polygon: unknown): polygon is LatLng[] {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  for (const p of polygon) {
    if (!Array.isArray(p) || p.length !== 2) return false;
    const [lat, lng] = p as [unknown, unknown];
    if (typeof lat !== "number" || typeof lng !== "number") return false;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  }
  return Math.abs(signedArea(polygon as LatLng[])) > 1e-12;
}

/** Signed planar area of a polygon (degrees²). Positive = CCW (in lat/lng). */
export function signedArea(polygon: LatLng[]): number {
  let s = 0;
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const [y1, x1] = polygon[i];
    const [y2, x2] = polygon[(i + 1) % n];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

/** Closes a ring (appends first vertex if not already closed). */
export function closeRing(polygon: LatLng[]): LatLng[] {
  if (polygon.length === 0) return polygon;
  const first = polygon[0];
  const last = polygon[polygon.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return polygon;
  return [...polygon, first];
}

/**
 * Detects whether a polygon looks like it was stored as [lng, lat] when our
 * code expects [lat, lng]. We flag it when any "lat" component is outside the
 * valid latitude range [-90, 90] but does fall in the longitude range.
 * Returns a human-readable warning, or null if everything looks fine.
 */
export function detectInvertedOrientation(polygon: unknown): string | null {
  if (!Array.isArray(polygon) || polygon.length === 0) return null;
  let suspicious = 0;
  for (const p of polygon) {
    if (!Array.isArray(p) || p.length !== 2) continue;
    const [a, b] = p as [number, number];
    if (typeof a !== "number" || typeof b !== "number") continue;
    // a should be lat ∈ [-90,90]. If a is out of lat range but in lng range,
    // and b is in lat range, the pair is most likely swapped.
    if ((a < -90 || a > 90) && a >= -180 && a <= 180 && b >= -90 && b <= 90) {
      suspicious++;
    }
  }
  if (suspicious >= Math.max(1, Math.floor(polygon.length / 2))) {
    return "El polígono parece estar en orden [lng, lat]; se esperaba [lat, lng]. Verifica la fuente de las coordenadas.";
  }
  return null;
}

/**
 * O(n²) self-intersection test for a polygon ring (lat/lng pairs).
 * Returns true when no two non-adjacent edges intersect.
 * Treats the polygon as a closed ring (last vertex implicitly connects to the first).
 */
export function isSimplePolygon(polygon: LatLng[]): boolean {
  const n = polygon.length;
  if (n < 4) return n >= 3; // triangles are always simple
  const segs: [number, number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const [y1, x1] = polygon[i];
    const [y2, x2] = polygon[(i + 1) % n];
    segs.push([x1, y1, x2, y2]);
  }
  const ccw = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
    (cy - ay) * (bx - ax) - (by - ay) * (cx - ax);
  const segmentsIntersect = (s1: number[], s2: number[]) => {
    const [a1x, a1y, a2x, a2y] = s1;
    const [b1x, b1y, b2x, b2y] = s2;
    const d1 = ccw(b1x, b1y, b2x, b2y, a1x, a1y);
    const d2 = ccw(b1x, b1y, b2x, b2y, a2x, a2y);
    const d3 = ccw(a1x, a1y, a2x, a2y, b1x, b1y);
    const d4 = ccw(a1x, a1y, a2x, a2y, b2x, b2y);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
           ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // Skip adjacent edges and the wrap-around adjacency
      if (j === i + 1) continue;
      if (i === 0 && j === n - 1) continue;
      if (segmentsIntersect(segs[i], segs[j])) return false;
    }
  }
  return true;
}

/** Point-in-polygon test (ray casting). Polygon as [lat, lng] pairs. */
export function pointInPolygon(lat: number, lng: number, polygon: LatLng[]): boolean {
  let inside = false;
  const n = polygon.length;
  let j = n - 1;
  for (let i = 0; i < n; i++) {
    const [yi, xi] = polygon[i];
    const [yj, xj] = polygon[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
    j = i;
  }
  return inside;
}

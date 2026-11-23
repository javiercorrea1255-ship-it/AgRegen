type Point = [number, number];
type Polygon = Point[];

interface GridPoint { lon: number; lat: number; }

interface GeoJSONFeatureCollection {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: { index: number };
    geometry: { type: "Point"; coordinates: [number, number] };
  }>;
  meta: {
    requested: number;
    generated: number;
    grid_count: number;
    padded_count: number;
    used_padding: boolean;
    grid_type: string;
  };
}

function bboxFromPolygon(polygon: Polygon): [number, number, number, number] {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const [lon, lat] of polygon) {
    if (lon < minx) minx = lon;
    if (lon > maxx) maxx = lon;
    if (lat < miny) miny = lat;
    if (lat > maxy) maxy = lat;
  }
  return [minx, miny, maxx, maxy];
}

function pointInPolygon(lon: number, lat: number, polygon: Polygon): boolean {
  const n = polygon.length;
  let inside = false;
  let j = n - 1;
  for (let i = 0; i < n; i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
    j = i;
  }
  return inside;
}

function uniformSubsample(points: GridPoint[], n: number): GridPoint[] {
  if (points.length <= n) return points;
  const step = points.length / n;
  return Array.from({ length: n }, (_, i) => points[Math.floor(i * step)]);
}

/**
 * Pad *points* up to *n* using uniform-random sampling inside the polygon.
 * Budget: max(missing × 1000, 10000) attempts so thin polygons (fill ratio < 1%)
 * are reliably covered for any practical N ≤ 200.
 */
function padToN(points: GridPoint[], polygon: Polygon, n: number, seed = 42): GridPoint[] {
  if (points.length >= n) return points;
  const [minx, miny, maxx, maxy] = bboxFromPolygon(polygon);
  const width = maxx - minx;
  const height = maxy - miny;
  const rng = seededRng(seed);
  const existing = new Set(points.map(p => `${Math.round(p.lon * 1e7)},${Math.round(p.lat * 1e7)}`));
  const result = [...points];
  const missing = n - result.length;
  const maxTries = Math.max(missing * 1000, 10000);
  for (let t = 0; t < maxTries && result.length < n; t++) {
    const lon = minx + rng() * width;
    const lat = miny + rng() * height;
    const key = `${Math.round(lon * 1e7)},${Math.round(lat * 1e7)}`;
    if (!existing.has(key) && pointInPolygon(lon, lat, polygon)) {
      result.push({ lon: Math.round(lon * 1e7) / 1e7, lat: Math.round(lat * 1e7) / 1e7 });
      existing.add(key);
    }
  }
  return result;
}

function generateRegularGrid(polygon: Polygon, nPoints: number): GridPoint[] {
  const [minx, miny, maxx, maxy] = bboxFromPolygon(polygon);
  const width = maxx - minx;
  const height = maxy - miny;
  const area = width * height;
  if (area < 1e-12) return [];

  let factor = 1.0;
  let best: GridPoint[] = [];

  for (let iter = 0; iter < 8; iter++) {
    const nTarget = Math.ceil(nPoints * factor);
    const cellSize = Math.sqrt(area / nTarget);
    const cols = Math.max(1, Math.ceil(width / cellSize));
    const rows = Math.max(1, Math.ceil(height / cellSize));

    const pts: GridPoint[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const lon = minx + (c + 0.5) * (width / cols);
        const lat = miny + (r + 0.5) * (height / rows);
        if (pointInPolygon(lon, lat, polygon)) {
          pts.push({ lon: Math.round(lon * 1e7) / 1e7, lat: Math.round(lat * 1e7) / 1e7 });
        }
      }
    }

    if (pts.length >= nPoints) {
      best = pts;
      break;
    }
    if (pts.length > best.length) best = pts;
    factor *= 2.0;
  }

  // Subsample only — padding is handled by generateGrid with tracking.
  return uniformSubsample(best, nPoints);
}

function generateHexagonalGrid(polygon: Polygon, nPoints: number): GridPoint[] {
  const [minx, miny, maxx, maxy] = bboxFromPolygon(polygon);
  const width = maxx - minx;
  const height = maxy - miny;
  const area = width * height;
  if (area < 1e-12) return [];

  let factor = 1.0;
  let best: GridPoint[] = [];

  for (let iter = 0; iter < 8; iter++) {
    const nTarget = Math.ceil(nPoints * factor);
    const cellSize = Math.sqrt(area / (nTarget * 0.866));
    const hexW = cellSize;
    const hexH = cellSize * Math.sqrt(3);

    const pts: GridPoint[] = [];
    let row = 0;
    let y = miny;
    while (y <= maxy + hexH) {
      const offset = row % 2 ? hexW / 2 : 0;
      let x = minx + offset;
      while (x <= maxx + hexW) {
        if (pointInPolygon(x, y, polygon)) {
          pts.push({ lon: Math.round(x * 1e7) / 1e7, lat: Math.round(y * 1e7) / 1e7 });
        }
        x += hexW;
      }
      y += hexH / 2;
      row++;
    }

    if (pts.length >= nPoints) {
      best = pts;
      break;
    }
    if (pts.length > best.length) best = pts;
    factor *= 2.0;
  }

  // Subsample only — padding is handled by generateGrid with tracking.
  return uniformSubsample(best, nPoints);
}

function generateStratifiedLhs(polygon: Polygon, nPoints: number, seed = 42): GridPoint[] {
  const [minx, miny, maxx, maxy] = bboxFromPolygon(polygon);
  const width = maxx - minx;
  const height = maxy - miny;
  const n = nPoints;

  const rng = seededRng(seed);
  const perm_x = shuffleWithRng(Array.from({ length: n }, (_, i) => i), rng);
  const perm_y = shuffleWithRng(Array.from({ length: n }, (_, i) => i), rng);

  const candidates: GridPoint[] = [];
  const existing = new Set<string>();

  for (let i = 0; i < n; i++) {
    const ux = (perm_x[i] + rng()) / n;
    const uy = (perm_y[i] + rng()) / n;
    const lon = minx + ux * width;
    const lat = miny + uy * height;
    if (pointInPolygon(lon, lat, polygon)) {
      const key = `${Math.round(lon * 1e7)},${Math.round(lat * 1e7)}`;
      if (!existing.has(key)) {
        candidates.push({ lon: Math.round(lon * 1e7) / 1e7, lat: Math.round(lat * 1e7) / 1e7 });
        existing.add(key);
      }
    }
  }

  if (candidates.length < nPoints) {
    const extraTries = nPoints * 20;
    for (let t = 0; t < extraTries && candidates.length < nPoints; t++) {
      const lon = minx + rng() * width;
      const lat = miny + rng() * height;
      const key = `${Math.round(lon * 1e7)},${Math.round(lat * 1e7)}`;
      if (!existing.has(key) && pointInPolygon(lon, lat, polygon)) {
        candidates.push({ lon: Math.round(lon * 1e7) / 1e7, lat: Math.round(lat * 1e7) / 1e7 });
        existing.add(key);
      }
    }
  }

  if (candidates.length < nPoints) {
    const reg = generateRegularGrid(polygon, nPoints);
    for (const p of reg) {
      if (candidates.length >= nPoints) break;
      const key = `${Math.round(p.lon * 1e7)},${Math.round(p.lat * 1e7)}`;
      if (!existing.has(key)) {
        candidates.push(p);
        existing.add(key);
      }
    }
  }

  return candidates.slice(0, nPoints);
}

function seededRng(seed: number): () => number {
  let s = seed;
  return function () {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return ((s >>> 0) / 0x100000000);
  };
}

function shuffleWithRng<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function generateGrid(
  polygon: Polygon,
  nPoints: number,
  gridType: string = "regular",
): GeoJSONFeatureCollection {
  let pts: GridPoint[];
  if (gridType === "hexagonal") {
    pts = generateHexagonalGrid(polygon, nPoints);
  } else if (gridType === "stratified" || gridType === "lhs" || gridType === "random") {
    pts = generateStratifiedLhs(polygon, nPoints);
  } else {
    pts = generateRegularGrid(polygon, nPoints);
  }

  const gridCount = pts.length;
  // Pad with random interior points when the structured grid falls short.
  // paddedCount is reported so the frontend can show an explanatory notice.
  if (gridCount < nPoints) {
    pts = padToN(pts, polygon, nPoints);
  }
  const paddedCount = Math.max(0, pts.length - gridCount);

  return {
    type: "FeatureCollection",
    features: pts.map((p, i) => ({
      type: "Feature",
      properties: { index: i },
      geometry: { type: "Point", coordinates: [p.lon, p.lat] },
    })),
    meta: {
      requested: nPoints,
      generated: pts.length,
      grid_count: gridCount,
      padded_count: paddedCount,
      used_padding: paddedCount > 0,
      grid_type: gridType,
    },
  };
}

import numpy as np
from typing import List, Dict, Any, Tuple, Optional

from services.polygon_buffer import _bowring_deg_to_m, apply_interior_buffer, apply_interior_buffer_with_meta


# ─── Variable priors (F1-03) ──────────────────────────────────────────────────
# Agronomic priors for 14 standard soil/crop variables.
# Values from Webster & Oliver 2007, Cambardella et al. 1994, Mallarino et al. 2011.

VARIABLE_PRIORS: Dict[str, Dict[str, Any]] = {
    "p":   {"cv_pct": 85, "precision_pct": 15, "range_m": 150, "min_n": 20},
    "k":   {"cv_pct": 30, "precision_pct": 10, "range_m": 300, "min_n": 12},
    "ca":  {"cv_pct": 25, "precision_pct": 10, "range_m": 400, "min_n": 10},
    "mg":  {"cv_pct": 30, "precision_pct": 10, "range_m": 350, "min_n": 10},
    "ph":  {"cv_pct":  7, "precision_pct":  5, "range_m": 500, "min_n":  8},
    "mos": {"cv_pct": 40, "precision_pct": 12, "range_m": 250, "min_n": 15},
    "n":   {"cv_pct": 40, "precision_pct": 12, "range_m": 200, "min_n": 15},
    "cec": {"cv_pct": 25, "precision_pct": 10, "range_m": 400, "min_n": 10},
    "zn":  {"cv_pct": 90, "precision_pct": 15, "range_m": 120, "min_n": 20},
    "cu":  {"cv_pct": 80, "precision_pct": 15, "range_m": 130, "min_n": 20},
    "b":   {"cv_pct": 75, "precision_pct": 15, "range_m": 140, "min_n": 18},
    "mn":  {"cv_pct": 70, "precision_pct": 15, "range_m": 150, "min_n": 18},
    "s":   {"cv_pct": 50, "precision_pct": 12, "range_m": 200, "min_n": 15},
    "ce":  {"cv_pct": 60, "precision_pct": 12, "range_m": 180, "min_n": 15},
}

# Z-scores for common confidence levels
Z_SCORES: Dict[int, float] = {90: 1.645, 95: 1.96, 99: 2.576}


def bbox_from_polygon(polygon: List[List[float]]) -> Tuple[float, float, float, float]:
    """Bounding box de un polígono [[lon, lat], ...]."""
    lons = [p[0] for p in polygon]
    lats = [p[1] for p in polygon]
    return min(lons), min(lats), max(lons), max(lats)


def point_in_polygon(point: List[float], polygon: List[List[float]]) -> bool:
    """Ray casting algorithm para determinar si un punto está dentro del polígono."""
    x, y = point
    n = len(polygon)
    inside = False
    j = n - 1
    for i in range(n):
        xi, yi = polygon[i]
        xj, yj = polygon[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside


def polygon_area_ha(polygon: List[List[float]]) -> float:
    """Calcula el área del polígono en hectáreas usando la fórmula de Gauss (Shoelace)
    con conversión de grados a metros mediante fórmulas WGS84 de Bowring (F1-06).
    Más preciso que el factor fijo 111320 m/° para latitudes no ecuatoriales."""
    lats = [p[1] for p in polygon]
    lons = [p[0] for p in polygon]
    cx = float(np.mean(lons))
    cy = float(np.mean(lats))
    lat_m, lon_m = _bowring_deg_to_m(cy)
    xs = np.array([(p[0] - cx) * lon_m for p in polygon])
    ys = np.array([(p[1] - cy) * lat_m for p in polygon])
    n = len(xs)
    area_m2 = 0.5 * abs(
        sum(xs[i] * ys[(i + 1) % n] - xs[(i + 1) % n] * ys[i] for i in range(n))
    )
    return area_m2 / 10_000.0


def adaptive_grid_resolution(
    polygon: List[List[float]],
    range_m: float = 200.0,
    cells_per_range: int = 5,
) -> Tuple[int, float]:
    """F2-03: Adaptive grid resolution based on polygon area and variogram range.

    Returns (N_resolution, cell_size_m) clamped to [40, 200].
    Rule (Webster & Oliver 2007 §5.4): ~5 cells per autocorrelation range.

    Parameters
    ----------
    polygon : [[lon, lat], ...] polygon boundary.
    range_m : variogram range in metres (use variable prior or 200 default).
    cells_per_range : target cells per range (default 5).
    """
    area_ha = polygon_area_ha(polygon)
    side_m = np.sqrt(area_ha * 10_000.0)
    target_cell_m = range_m / cells_per_range
    if target_cell_m < 1e-6:
        target_cell_m = 40.0
    resolution = int(np.ceil(side_m / target_cell_m))
    resolution = max(40, min(200, resolution))
    actual_cell_m = side_m / resolution if resolution > 0 else target_cell_m
    return resolution, actual_cell_m


# ─── Sample size calculators (FAO/USDA, Cochran, Cressie-Wikle) ─────────────

def n_cochran(cv_pct: float = 30.0, precision_pct: float = 20.0, z: float = 1.645) -> int:
    """Cochran (1977): n = (z·CV/e)²
    cv_pct: coeficiente de variación esperado (%), precision_pct: error relativo aceptable (%)."""
    return max(3, int(np.ceil((z * cv_pct / precision_pct) ** 2)))


def n_fao(area_ha: float) -> int:
    """FAO/USDA guideline: ~1 muestra por cada 3–5 ha con mínimo 5 y máximo 60."""
    raw = max(5, min(60, int(np.ceil(area_ha / 4.0))))
    return raw


def n_cressie_wikle(area_ha: float, range_m: float = 300.0) -> int:
    """Cressie-Wikle: basado en la relación entre el rango de autocorrelación espacial
    y el área de interés. n ≈ 4·A/r² donde A es el área en m² y r es el rango en m.
    Clampado entre 5 y 100."""
    area_m2 = area_ha * 10_000.0
    raw = int(np.ceil(4.0 * area_m2 / (range_m ** 2)))
    return max(5, min(100, raw))


def optimal_sample_size(
    polygon: List[List[float]],
    cv_pct: float = 30.0,
    precision_pct: float = 20.0,
    range_m: float = 300.0,
    confidence_level: int = 90,
    variable_code: Optional[str] = None,
    purpose: str = "mapping",
) -> Dict[str, Any]:
    """Calcula n óptimo usando los tres métodos y toma el máximo.

    Cuando se proporciona *variable_code*, se usan los priors agronómicos
    para ese tipo de variable (CV, error permitido, rango espacial, n mínimo).
    Los valores explícitos de cv_pct / precision_pct siempre tienen prioridad
    sobre los priors cuando se proporcionan diferentes a los defaults.

    Parameters
    ----------
    polygon          : [[lon, lat], ...] — parcel boundary.
    cv_pct           : expected coefficient of variation (%).
    precision_pct    : allowable relative error (%).
    range_m          : spatial autocorrelation range (metres).
    confidence_level : 90, 95 or 99.
    variable_code    : optional variable code (e.g. "P", "pH", "MOS") — uses VARIABLE_PRIORS.
    """
    area = polygon_area_ha(polygon)

    prior_used = None
    if variable_code:
        prior = VARIABLE_PRIORS.get(variable_code.lower())
        if prior:
            prior_used = {"code": variable_code.lower(), **prior}
            cv_pct = prior["cv_pct"]
            precision_pct = prior["precision_pct"]
            range_m = prior["range_m"]

    z = Z_SCORES.get(confidence_level, 1.645)

    n_c = n_cochran(cv_pct, precision_pct, z)
    n_f = n_fao(area)
    n_cw = n_cressie_wikle(area, range_m)
    n_opt = max(n_c, n_f, n_cw)

    if prior_used and n_opt < prior_used["min_n"]:
        n_opt = prior_used["min_n"]
    # Upper bound for grid spacing, not a capped estimate of the parcel mean.
    from pyproj import Transformer
    from shapely.geometry import Polygon
    from shapely.ops import transform as project_geometry
    from services.raster import utm_epsg_from_latlon
    geom = Polygon(polygon)
    projection = Transformer.from_crs(4326, utm_epsg_from_latlon(geom.centroid.y, geom.centroid.x), always_xy=True)
    x0, y0, x1, y1 = project_geometry(projection.transform, geom).bounds
    spacing = range_m / 2
    spatial_mapping = max(1, int(np.ceil((x1 - x0) / spacing)) * int(np.ceil((y1 - y0) / spacing)))
    n_mapping = max(30, n_c, spatial_mapping)
    n_mean = n_opt
    if purpose == "mapping":
        n_opt = max(n_opt, n_mapping)

    prior_source = "agronomic_prior" if prior_used else "user_input"
    result: Dict[str, Any] = {
        "area_ha": round(area, 2),
        "n_cochran": n_c,
        "n_fao": n_f,
        "n_cressie_wikle": n_cw,
        "n_optimal": n_opt,
        "n_recommended": n_opt,
        "n_mapping": n_mapping,
        "n_spatial_mapping": spatial_mapping,
        "mapping_spacing_m": spacing,
        "n_mean": n_mean,
        "purpose": purpose,
        "params": {
            "cv_pct": cv_pct,
            "precision_pct": precision_pct,
            "range_m": range_m,
            "purpose": purpose,
            "confidence_level": confidence_level,
            "z_score": z,
        },
        "params_used": {
            "cv_pct": cv_pct,
            "precision_pct": precision_pct,
            "range_m": range_m,
            "confidence_level": confidence_level,
            "z_score": z,
            "prior_source": prior_source,
        },
    }
    if prior_used:
        result["prior_used"] = prior_used

    return result


# ─── Grid generators ──────────────────────────────────────────────────────────

def _pad_to_n(
    points: List[Dict[str, Any]],
    polygon: List[List[float]],
    n_points: int,
    rng: "np.random.Generator | None" = None,
) -> List[Dict[str, Any]]:
    """Pad *points* up to *n_points* using uniform-random sampling inside the polygon.

    Budget is 1 000 × missing with a floor of 10 000 attempts so even thin
    polygons (fill ratio < 1 %) are covered for any practical N ≤ 200.
    Returns a list of exactly n_points items *if the polygon is non-degenerate*;
    may return fewer only when the polygon area is truly negligible.
    """
    if len(points) >= n_points:
        return points
    if rng is None:
        rng = np.random.default_rng(42)
    minx, miny, maxx, maxy = bbox_from_polygon(polygon)
    width = maxx - minx
    height = maxy - miny
    existing = {(p["lon"], p["lat"]) for p in points}
    result = list(points)
    missing = n_points - len(result)
    max_tries = max(missing * 1000, 10000)
    for _ in range(max_tries):
        if len(result) >= n_points:
            break
        lon = float(minx + rng.uniform() * width)
        lat = float(miny + rng.uniform() * height)
        key = (round(lon, 7), round(lat, 7))
        if key not in existing and point_in_polygon([lon, lat], polygon):
            result.append({"lon": key[0], "lat": key[1]})
            existing.add(key)
    return result


def _stride_subsample(
    points: List[Dict[str, Any]],
    n: int,
) -> List[Dict[str, Any]]:
    """Preserves spatial order (row-major) when reducing a structured grid.

    Takes *n* evenly-spaced items from *points* using a uniform stride so
    the visual grid / hexagonal pattern is retained.  FPS would maximise
    minimum distances but destroy the row-and-column alignment.
    """
    if len(points) <= n:
        return points
    step = len(points) / n
    return [points[int(i * step)] for i in range(n)]


def _farthest_point_subsample(
    points: List[Dict[str, Any]],
    n: int,
    seed: int = 42,
) -> List[Dict[str, Any]]:
    """Selecciona *n* puntos de *points* mediante Farthest Point Sampling (FPS).

    FPS maximises the minimum distance between selected points, yielding a
    much more uniform spatial coverage than uniform-index subsampling.

    Algorithm:
      1. Seed: pick the point closest to the centroid.
      2. Iteratively add the point that maximises distance to the nearest
         already-selected point.

    Falls back to returning all *points* when len(points) <= n.
    Seed is used only to break ties deterministically; the algorithm itself
    is deterministic given the input order.
    """
    if len(points) <= n:
        return points

    coords = np.array([[p["lon"], p["lat"]] for p in points], dtype=float)
    m = len(coords)

    centroid = coords.mean(axis=0)
    first_idx = int(np.argmin(np.sum((coords - centroid) ** 2, axis=1)))

    selected = [first_idx]
    min_dists = np.full(m, np.inf)

    dx = coords[:, 0] - coords[first_idx, 0]
    dy = coords[:, 1] - coords[first_idx, 1]
    min_dists = dx ** 2 + dy ** 2

    for _ in range(n - 1):
        next_idx = int(np.argmax(min_dists))
        selected.append(next_idx)
        dx = coords[:, 0] - coords[next_idx, 0]
        dy = coords[:, 1] - coords[next_idx, 1]
        new_dists = dx ** 2 + dy ** 2
        min_dists = np.minimum(min_dists, new_dists)
        min_dists[next_idx] = -1.0

    return [points[i] for i in selected]


def generate_regular_grid(
    polygon: List[List[float]],
    n_points: int,
    max_iter: int = 8,
) -> List[Dict[str, Any]]:
    """Cuadrícula regular NS con filtro point-in-polygon.

    La estimación del tamaño de celda usa el área real del polígono (no la
    bbox) para compensar polígonos no rectangulares. Cuando el generador
    produce más puntos que n_points se usa _stride_subsample (paso uniforme
    fila-a-fila) en lugar de FPS, preservando el patrón visual de cuadrícula.
    """
    minx, miny, maxx, maxy = bbox_from_polygon(polygon)
    width = maxx - minx
    height = maxy - miny
    bbox_area = width * height
    if bbox_area < 1e-12:
        return []

    # Estimate fill ratio so the first iteration already lands close to n_points
    poly_area_deg = polygon_area_ha(polygon) / (111_320 ** 2 / 10_000)
    fill_ratio = max(poly_area_deg / bbox_area, 0.05)

    factor = 1.0
    points: List[Dict[str, Any]] = []
    for _ in range(max_iter):
        n_target = int(np.ceil(n_points * factor / fill_ratio))
        cell_size = np.sqrt(bbox_area / n_target)
        cols = max(1, int(np.ceil(width / cell_size)))
        rows = max(1, int(np.ceil(height / cell_size)))

        pts = []
        for r in range(rows):
            for c in range(cols):
                lon = minx + (c + 0.5) * (width / cols)
                lat = miny + (r + 0.5) * (height / rows)
                if point_in_polygon([lon, lat], polygon):
                    pts.append({"lon": round(lon, 7), "lat": round(lat, 7)})

        if len(pts) >= n_points:
            points = pts
            break
        if len(pts) > len(points):
            points = pts
        factor *= 2.0

    # Use stride subsample to preserve the row-and-column visual pattern.
    # FPS would destroy alignment by maximising minimum distances.
    return _stride_subsample(points, n_points)


def generate_hexagonal_grid(
    polygon: List[List[float]],
    n_points: int,
    max_iter: int = 8,
) -> List[Dict[str, Any]]:
    """Cuadrícula hexagonal (honeycomb) con sobredensificación iterativa.

    El tamaño de celda inicial se calibra usando el área real del polígono
    para reducir iteraciones. El submuestreo usa _stride_subsample (paso
    uniforme fila-a-fila) para preservar el patrón visual de honeycomb.
    """
    minx, miny, maxx, maxy = bbox_from_polygon(polygon)
    width = maxx - minx
    height = maxy - miny
    bbox_area = width * height
    if bbox_area < 1e-12:
        return []

    # Fill-ratio correction: use real polygon area, not bbox
    poly_area_deg = polygon_area_ha(polygon) / (111_320 ** 2 / 10_000)
    fill_ratio = max(poly_area_deg / bbox_area, 0.05)

    factor = 1.0
    points: List[Dict[str, Any]] = []
    for _ in range(max_iter):
        n_target = int(np.ceil(n_points * factor / fill_ratio))
        cell_size = np.sqrt(bbox_area / (n_target * 0.866))
        hex_w = cell_size
        hex_h = cell_size * np.sqrt(3)

        pts = []
        row = 0
        y = miny
        while y <= maxy + hex_h:
            offset = (hex_w / 2) if row % 2 else 0
            x = minx + offset
            while x <= maxx + hex_w:
                if point_in_polygon([x, y], polygon):
                    pts.append({"lon": round(x, 7), "lat": round(y, 7)})
                x += hex_w
            y += hex_h / 2
            row += 1

        if len(pts) >= n_points:
            points = pts
            break
        if len(pts) > len(points):
            points = pts
        factor *= 2.0

    # Use stride subsample to preserve the honeycomb visual pattern.
    # FPS would destroy the alternating-row offset that defines hexagonal grids.
    return _stride_subsample(points, n_points)


def generate_stratified_lhs(
    polygon: List[List[float]],
    n_points: int,
    seed: int = 42,
) -> List[Dict[str, Any]]:
    """Malla aleatoria estratificada — verdadero Latin Hypercube Sampling 2D.
    
    Procedure:
    1. Divide [0,1] en n_points estratos iguales en cada dimensión.
    2. En cada estrato (dim X e Y), muestrea un valor aleatorio dentro del estrato.
    3. Permuta aleatoriamente los índices de Y para crear pares (x_i, y_j).
    4. Escala a la bbox y filtra por polígono.
    """
    rng = np.random.default_rng(seed)
    minx, miny, maxx, maxy = bbox_from_polygon(polygon)
    width = maxx - minx
    height = maxy - miny

    n = n_points
    u_x = (rng.permutation(n) + rng.uniform(0, 1, n)) / n
    u_y = (rng.permutation(n) + rng.uniform(0, 1, n)) / n

    lhs_points = np.column_stack([u_x, u_y])
    lons = minx + lhs_points[:, 0] * width
    lats = miny + lhs_points[:, 1] * height

    candidates = []
    for lon, lat in zip(lons, lats):
        if point_in_polygon([float(lon), float(lat)], polygon):
            candidates.append({"lon": round(float(lon), 7), "lat": round(float(lat), 7)})

    if len(candidates) < n_points:
        extra_tries = n_points * 20
        ux2 = rng.uniform(0, 1, extra_tries)
        uy2 = rng.uniform(0, 1, extra_tries)
        existing = {(p["lon"], p["lat"]) for p in candidates}
        for u, v in zip(ux2, uy2):
            lon = minx + u * width
            lat = miny + v * height
            key = (round(float(lon), 7), round(float(lat), 7))
            if key not in existing and point_in_polygon([float(lon), float(lat)], polygon):
                candidates.append({"lon": key[0], "lat": key[1]})
                existing.add(key)
                if len(candidates) >= n_points:
                    break

    if len(candidates) < n_points:
        reg = generate_regular_grid(polygon, n_points)
        existing = {(p["lon"], p["lat"]) for p in candidates}
        for p in reg:
            if (p["lon"], p["lat"]) not in existing:
                candidates.append(p)
                if len(candidates) >= n_points:
                    break

    return candidates[:n_points]


def generate_grid(
    polygon: List[List[float]],
    n_points: int,
    grid_type: str = "regular",
    buffer_m: float = 0.0,
) -> Dict[str, Any]:
    """Genera grilla y devuelve GeoJSON FeatureCollection.

    F1-01: When buffer_m > 0, the polygon is first eroded inward by buffer_m
    metres so that no grid point falls within buffer_m metres of the field
    boundary. The eroded polygon is used only for point generation; the
    original polygon is stored in meta for display purposes.

    Padding tracking:
    - Generators return ≤ n_points (they subsample but do not pad).
    - If the generator result is short, _pad_to_n supplements with uniform-
      random points. The number of padded points is reported in meta so the
      frontend can show an informative notice to the user.
    """
    working_polygon = polygon
    buffer_meta = {
        "buffer_applied_m": 0.0,
        "buffer_skipped": False,
        "polygon_buffered": polygon,
    }
    if buffer_m > 0.0:
        eroded, buffer_meta = apply_interior_buffer_with_meta(polygon, buffer_m)
        if eroded is not polygon and len(eroded) >= 3:
            working_polygon = eroded

    buffer_applied = not buffer_meta.get("buffer_skipped", True) and buffer_meta.get("buffer_applied_m", 0.0) > 0.0

    if grid_type == "hexagonal":
        pts = generate_hexagonal_grid(working_polygon, n_points)
    elif grid_type in ("stratified", "lhs", "random"):
        pts = generate_stratified_lhs(working_polygon, n_points)
    else:
        pts = generate_regular_grid(working_polygon, n_points)

    grid_count = len(pts)
    if grid_count < n_points:
        pts = _pad_to_n(pts, working_polygon, n_points)

    padded_count = max(0, len(pts) - grid_count)

    features = [
        {
            "type": "Feature",
            "properties": {"index": i},
            "geometry": {"type": "Point", "coordinates": [p["lon"], p["lat"]]},
        }
        for i, p in enumerate(pts)
    ]
    return {
        "type": "FeatureCollection",
        "features": features,
        "meta": {
            "requested": n_points,
            "generated": len(features),
            "grid_count": grid_count,
            "padded_count": padded_count,
            "used_padding": padded_count > 0,
            "grid_type": grid_type,
            "buffer_m": buffer_m,
            "buffer_applied": buffer_applied,
            "buffer": buffer_meta,
        },
    }

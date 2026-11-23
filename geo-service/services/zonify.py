import numpy as np
from typing import List, Dict, Any, Tuple, Optional
from sklearn.cluster import KMeans
from services.zone_postprocess import postprocess_zones
from services.polygon_buffer import _bowring_deg_to_m


# ─── Agronomic thresholds per variable ────────────────────────────────────────
# Used to create threshold-based zones instead of data-driven clustering.
AGRONOMIC_THRESHOLDS: Dict[str, List[Dict[str, Any]]] = {
    "ph": [
        {"label": "Muy ácido",         "max": 5.5,  "color": "#d73027"},
        {"label": "Ácido",             "max": 6.2,  "color": "#fc8d59"},
        {"label": "Ligeramente ácido", "max": 6.5,  "color": "#fee090"},
        {"label": "Óptimo",            "max": 7.2,  "color": "#1a9850"},
        {"label": "Alcalino",          "max": 8.5,  "color": "#74add1"},
        {"label": "Muy alcalino",      "max": 14.0, "color": "#313695"},
    ],
    "mo": [
        {"label": "Muy bajo", "max": 1.0, "color": "#d73027"},
        {"label": "Bajo",     "max": 2.0, "color": "#fc8d59"},
        {"label": "Medio",    "max": 4.0, "color": "#1a9850"},
        {"label": "Alto",     "max": 100, "color": "#1f6c3c"},
    ],
    "ce": [
        {"label": "No salino",            "max": 2.0, "color": "#1a9850"},
        {"label": "Ligeramente salino",   "max": 4.0, "color": "#fee090"},
        {"label": "Moderadamente salino", "max": 8.0, "color": "#fc8d59"},
        {"label": "Salino",               "max": 50,  "color": "#d73027"},
    ],
    "n": [
        {"label": "Deficiente", "max": 15,   "color": "#d73027"},
        {"label": "Bajo",       "max": 30,   "color": "#fc8d59"},
        {"label": "Adecuado",   "max": 60,   "color": "#1a9850"},
        {"label": "Alto",       "max": 5000, "color": "#313695"},
    ],
    "p": [
        {"label": "Muy bajo", "max": 10,   "color": "#d73027"},
        {"label": "Bajo",     "max": 20,   "color": "#fc8d59"},
        {"label": "Adecuado", "max": 40,   "color": "#1a9850"},
        {"label": "Alto",     "max": 1000, "color": "#313695"},
    ],
    "k": [
        {"label": "Muy bajo", "max": 80,   "color": "#d73027"},
        {"label": "Bajo",     "max": 150,  "color": "#fc8d59"},
        {"label": "Adecuado", "max": 300,  "color": "#1a9850"},
        {"label": "Alto",     "max": 5000, "color": "#313695"},
    ],
    "ndvi": [
        {"label": "Sin vegetación",    "max": 0.1, "color": "#d73027"},
        {"label": "Vegetación escasa", "max": 0.3, "color": "#fc8d59"},
        {"label": "Vegetación media",  "max": 0.6, "color": "#a6d96a"},
        {"label": "Vegetación densa",  "max": 1.0, "color": "#1a9850"},
    ],
}

DEFAULT_ZONE_COLORS = ["#d73027", "#f46d43", "#fdae61", "#a6d96a", "#1a9850", "#313695"]


# ─── Elbow method to select optimal k ─────────────────────────────────────────

def elbow_k(values_flat: np.ndarray, k_min: int = 2, k_max: int = 6) -> int:
    """Selecciona k óptimo usando el método del codo (mínima segunda derivada de inercia)."""
    if len(values_flat) < k_min:
        return k_min
    inertias = []
    ks = list(range(k_min, min(k_max + 1, len(values_flat) + 1)))
    if not ks:
        return k_min
    for k in ks:
        km = KMeans(n_clusters=k, random_state=42, n_init=5, max_iter=100)
        km.fit(values_flat.reshape(-1, 1))
        inertias.append(km.inertia_)

    if len(inertias) <= 2:
        return ks[0]

    # Normalized slopes — find the knee
    inertias_arr = np.array(inertias, dtype=float)
    diffs = np.diff(inertias_arr)
    second_diffs = np.diff(diffs)
    if len(second_diffs) == 0:
        return ks[0]
    knee_idx = int(np.argmax(second_diffs)) + 1  # +1 offset for double diff
    return ks[min(knee_idx, len(ks) - 1)]


# ─── Fuzzy C-Means (pure-numpy implementation) ────────────────────────────────

def fuzzy_cmeans(X: np.ndarray, n_clusters: int, m: float = 2.0,
                 max_iter: int = 100, tol: float = 1e-4, seed: int = 42) -> Tuple[np.ndarray, np.ndarray]:
    """Fuzzy C-Means: retorna (labels crisp, membership matrix U [n_clusters, n_samples])."""
    rng = np.random.default_rng(seed)
    n = X.shape[0]
    # Initialize membership randomly and normalize columns
    U = rng.uniform(0, 1, (n_clusters, n))
    U = U / U.sum(axis=0, keepdims=True)

    for _ in range(max_iter):
        U_m = U ** m
        # Cluster centers
        centers = (U_m @ X) / U_m.sum(axis=1, keepdims=True)  # [k, d]
        # Update membership
        U_new = np.zeros_like(U)
        for k in range(n_clusters):
            d_k = np.linalg.norm(X - centers[k], axis=1) + 1e-12
            for j in range(n_clusters):
                d_j = np.linalg.norm(X - centers[j], axis=1) + 1e-12
                U_new[k] += (d_k / d_j) ** (2 / (m - 1))
        U_new = 1.0 / U_new
        # Normalize
        U_new = U_new / U_new.sum(axis=0, keepdims=True)
        if np.max(np.abs(U_new - U)) < tol:
            U = U_new
            break
        U = U_new

    labels = np.argmax(U, axis=0)
    # Reorder by center value
    centers_final = (U ** m) @ X / ((U ** m).sum(axis=1, keepdims=True))
    sort_order = np.argsort(centers_final[:, 0])
    remap = {old: new for new, old in enumerate(sort_order)}
    labels = np.array([remap[l] for l in labels])
    return labels, U


# ─── Spatial K-Means (coordinates weighted 0.3) ──────────────────────────────

def spatial_kmeans(
    grid_x: np.ndarray,
    grid_y: np.ndarray,
    values: np.ndarray,
    n_clusters: int,
    coord_weight: float = 0.3,
) -> np.ndarray:
    """K-Means espacial: combina valor normalizado + coordenadas normalizadas con peso coord_weight."""
    flat_vals = values.ravel()
    flat_x = grid_x.ravel()
    flat_y = grid_y.ravel()

    valid = ~np.isnan(flat_vals)
    if np.sum(valid) < n_clusters:
        return np.zeros(flat_vals.shape, dtype=int)

    v_norm = (flat_vals[valid] - np.nanmin(flat_vals)) / (np.nanmax(flat_vals) - np.nanmin(flat_vals) + 1e-12)
    x_norm = (flat_x[valid] - flat_x[valid].min()) / (float(flat_x[valid].max() - flat_x[valid].min()) + 1e-12)
    y_norm = (flat_y[valid] - flat_y[valid].min()) / (float(flat_y[valid].max() - flat_y[valid].min()) + 1e-12)

    X = np.column_stack([
        v_norm * (1.0 - coord_weight),
        x_norm * coord_weight,
        y_norm * coord_weight,
    ])

    km = KMeans(n_clusters=n_clusters, random_state=42, n_init=10, max_iter=200)
    km.fit(X)
    raw_labels = km.labels_

    # Sort clusters by mean value
    centers_val = np.array([np.mean(flat_vals[valid][raw_labels == k]) for k in range(n_clusters)])
    sort_order = np.argsort(centers_val)
    remap = {old: new for new, old in enumerate(sort_order)}

    full_labels = np.full(flat_vals.shape, -1, dtype=int)
    full_labels[valid] = np.array([remap[l] for l in raw_labels])
    return full_labels


# ─── Value-only K-Means (Jenks-like) ─────────────────────────────────────────

def classify_quantiles(values: np.ndarray, n_zones: int = 3) -> np.ndarray:
    """Equal-count quantile classification — each zone has the same pixel count.

    Useful for satellite-index zonification where the user wants balanced areas
    rather than data-driven breakpoints.
    """
    flat = values[~np.isnan(values)]
    n_valid = len(flat)
    if n_valid < n_zones:
        return np.full(len(values), -1, dtype=int)
    quantile_edges = np.quantile(flat, np.linspace(0, 1, n_zones + 1))
    # np.digitize returns 1..n_zones for bins; subtract 1 for 0-based labels and
    # clip to [0, n_zones-1] to handle the upper-edge corner case.
    labels = np.full(len(values), -1, dtype=int)
    valid_mask = ~np.isnan(values)
    raw = np.digitize(values[valid_mask], quantile_edges[1:-1], right=False)
    labels[valid_mask] = np.clip(raw, 0, n_zones - 1)
    return labels


def classify_natural_breaks(values: np.ndarray, n_zones: int = 3) -> np.ndarray:
    """Jenks natural breaks via 1-D K-means (Fisher-Jenks ≡ minimising within-class variance)."""
    flat = values[~np.isnan(values)].reshape(-1, 1)
    n_valid = len(flat)
    if n_valid < n_zones:
        return np.zeros(len(values), dtype=int)

    n_zones = min(n_zones, n_valid)
    km = KMeans(n_clusters=n_zones, random_state=42, n_init=10, max_iter=200)
    km.fit(flat)
    centers = km.cluster_centers_.ravel()
    sorted_idx = np.argsort(centers)
    remap = {old: new for new, old in enumerate(sorted_idx)}
    labels = np.full(len(values), -1, dtype=int)
    valid_mask = ~np.isnan(values)
    raw = km.predict(values[valid_mask].reshape(-1, 1))
    labels[valid_mask] = np.array([remap[r] for r in raw])
    return labels


# ─── Agronomic threshold zonification ────────────────────────────────────────

def classify_agronomic(values: np.ndarray, variable_code: str) -> Tuple[np.ndarray, List[str], List[str]]:
    """Zonifica usando umbrales agronómicos fijos para la variable dada."""
    thresholds = AGRONOMIC_THRESHOLDS.get(variable_code.lower())
    if thresholds is None:
        return None, [], []

    labels = np.full(values.shape, -1, dtype=int)
    zone_names = []
    zone_colors = []
    prev_max = -np.inf
    for i, t in enumerate(thresholds):
        mask = (values > prev_max) & (values <= t["max"]) & ~np.isnan(values)
        labels[mask] = i
        zone_names.append(t["label"])
        zone_colors.append(t["color"])
        prev_max = t["max"]

    # Assign any remaining unassigned valid values to the last zone
    unassigned = (labels == -1) & ~np.isnan(values)
    labels[unassigned] = len(thresholds) - 1
    return labels, zone_names, zone_colors


# ─── GeoJSON zone builder ─────────────────────────────────────────────────────

def zones_to_geojson(
    grid_x: np.ndarray,
    grid_y: np.ndarray,
    zone_labels: np.ndarray,
    values: np.ndarray,
    n_zones: int,
    cell_size_deg: float,
    zone_names: Optional[List[str]] = None,
    zone_colors: Optional[List[str]] = None,
    parcel_polygon_geom=None,  # Optional Shapely geometry — clips zones to field boundary
) -> List[Dict[str, Any]]:
    """Convierte etiquetas de zona raster a lista de features GeoJSON por zona.
    Si se proporciona parcel_polygon_geom, cada zona se intersecta con el polígono
    de la parcela para que las zonas sigan el contorno exacto del campo."""
    from shapely.geometry import box, mapping
    from shapely.ops import unary_union

    colors = zone_colors or DEFAULT_ZONE_COLORS
    actual_zones = sorted(set(int(z) for z in zone_labels.ravel() if z >= 0))
    zone_features = []

    for z in actual_zones:
        mask = zone_labels.ravel() == z
        if not np.any(mask):
            continue

        xs = grid_x.ravel()[mask]
        ys = grid_y.ravel()[mask]
        zvals = values.ravel()[mask]
        zvals = zvals[~np.isnan(zvals)]
        if len(zvals) == 0:
            continue

        half_x = abs(float(np.median(np.diff(grid_x[0])))) / 2 if grid_x.shape[1] > 1 else cell_size_deg / 2
        half_y = abs(float(np.median(np.diff(grid_y[:, 0])))) / 2 if grid_y.shape[0] > 1 else cell_size_deg / 2
        polys = [box(x - half_x, y - half_y, x + half_x, y + half_y) for x, y in zip(xs, ys)]

        try:
            merged = unary_union(polys)
            # Clip zone to parcel polygon — zones must stay within field boundary.
            # Fail-closed: if intersection raises or is empty, skip this zone.
            if parcel_polygon_geom is not None:
                try:
                    merged = merged.intersection(parcel_polygon_geom)
                except Exception as _clip_err:
                    import logging as _log
                    _log.warning("Zone %d clipping failed (%s: %s) — zone skipped",
                                 z, type(_clip_err).__name__, str(_clip_err)[:120])
                    continue  # Intersection failed — skip zone (fail closed)
            if merged.is_empty:
                continue
            geom = mapping(merged)
            # F1-06: Compute area in hectares using Bowring WGS84 ellipsoid formulas.
            # merged.area is in degrees²; convert to m² with latitude-dependent factors.
            import math as _math
            lat_center = float(np.mean(ys))
            phi = _math.radians(lat_center)
            m_per_deg_lat = 111132.954 - 559.822 * _math.cos(2.0 * phi) + 1.175 * _math.cos(4.0 * phi)
            m_per_deg_lon = max(
                111412.84 * _math.cos(phi) - 93.5 * _math.cos(3.0 * phi) + 0.118 * _math.cos(5.0 * phi),
                1e-3,
            )
            from pyproj import Transformer
            from shapely.ops import transform
            from services.raster import utm_epsg_from_latlon
            center = parcel_polygon_geom.centroid if parcel_polygon_geom is not None else merged.centroid
            projection = Transformer.from_crs(4326, utm_epsg_from_latlon(center.y, center.x), always_xy=True)
            area_ha = float(transform(projection.transform, merged).area / 10_000.)
        except Exception:
            geom = None
            area_ha = None

        color = colors[z % len(colors)] if z < len(colors) else colors[-1]
        label = zone_names[z] if zone_names and z < len(zone_names) else f"Zona {z + 1}"

        zone_features.append({
            "zone_index": z,
            "zone_label": label,
            "value_mean": float(np.mean(zvals)),
            "value_std": float(np.std(zvals)),
            "value_min": float(np.min(zvals)),
            "value_max": float(np.max(zvals)),
            "area_ha": area_ha,
            "n_pixels": int(np.sum(mask)),
            "color": color,
            "geojson": geom,  # Geometry object (not Feature wrapper)
        })

    return zone_features


# ─── Main entry point ─────────────────────────────────────────────────────────

def create_zones(
    grid_x: np.ndarray,
    grid_y: np.ndarray,
    values: np.ndarray,
    n_zones: int = 3,
    cell_size_deg: float = 0.0001,
    method: str = "spatial_kmeans",
    variable_code: str = "default",
    auto_k: bool = False,
    parcel_polygon_geom=None,
    min_zone_area_ha: float = 0.25,
    apply_mode_filter: bool = True,
) -> Tuple[np.ndarray, List[Dict[str, Any]], Optional[np.ndarray]]:
    """
    Crea zonas de manejo.
    method: 'spatial_kmeans' | 'kmeans' | 'fuzzy' | 'agronomic'
    auto_k: si True, usa método del codo para seleccionar k automáticamente.
    parcel_polygon_geom: Shapely Polygon — clips zone geometries to field boundary.
    """
    flat = values.ravel()
    valid = flat[~np.isnan(flat)]

    if auto_k and method != "agronomic" and len(valid) >= 4:
        # elbow_k needs at least 4 valid cells to compute meaningful inertia curve
        n_zones = elbow_k(valid, k_min=2, k_max=min(6, max(2, len(valid) // 3)))

    zone_names: Optional[List[str]] = None
    zone_colors: Optional[List[str]] = None
    membership_U: Optional[np.ndarray] = None

    if n_zones == 1 or (len(valid) and np.ptp(valid) < 1e-10):
        n_zones = 1
        labels = np.where(np.isfinite(values), 0, -1)
    elif method == "agronomic":
        labels, zone_names, zone_colors = classify_agronomic(values.ravel(), variable_code)
        if labels is None:
            # Fallback to spatial_kmeans if variable not in threshold table
            labels = spatial_kmeans(grid_x, grid_y, values, n_zones)
        else:
            labels = labels.reshape(grid_x.shape)

    elif method == "fuzzy":
        # F2-04: include normalized x/y with weight 0.3 for spatial coherence (audit §H-09)
        valid_mask = ~np.isnan(flat)
        v_norm = (flat[valid_mask] - np.nanmin(flat)) / (np.nanmax(flat) - np.nanmin(flat) + 1e-12)
        flat_x = grid_x.ravel()
        flat_y = grid_y.ravel()
        x_norm = (flat_x[valid_mask] - flat_x.min()) / (flat_x.max() - flat_x.min() + 1e-12)
        y_norm = (flat_y[valid_mask] - flat_y.min()) / (flat_y.max() - flat_y.min() + 1e-12)
        X = np.column_stack([v_norm * 0.7, x_norm * 0.3, y_norm * 0.3])
        if len(X) >= n_zones:
            raw_labels, membership_U = fuzzy_cmeans(X, n_clusters=n_zones)
            labels = np.full(flat.shape, -1, dtype=int)
            labels[valid_mask] = raw_labels
            labels = labels.reshape(grid_x.shape)
        else:
            labels = spatial_kmeans(grid_x, grid_y, values, n_zones)
            membership_U = None

    elif method == "kmeans" or method == "jenks":
        # 'kmeans' kept for backward-compatibility; both names invoke 1-D
        # Jenks natural-breaks (Fisher-Jenks via 1-D K-means).
        labels_flat = classify_natural_breaks(values.ravel(), n_zones)
        labels = labels_flat.reshape(grid_x.shape)

    elif method == "quantiles":
        # Equal-count classification — each zone gets ~the same pixel count.
        labels_flat = classify_quantiles(values.ravel(), n_zones)
        labels = labels_flat.reshape(grid_x.shape)

    else:  # spatial_kmeans (default)
        labels_flat = spatial_kmeans(grid_x, grid_y, values, n_zones)
        labels = labels_flat.reshape(grid_x.shape)

    # ── F2-05: Post-process (mode filter + small-zone removal) ─────────────────
    try:
        # Convert cell_size_deg to metres using Bowring WGS84 formula (F1-06)
        centroid_lat = float(np.nanmean(grid_y)) if grid_y.size > 0 else 0.0
        lat_m_per_deg, _ = _bowring_deg_to_m(centroid_lat)
        cell_size_m = cell_size_deg * lat_m_per_deg
        if cell_size_m > 0:
            labels = postprocess_zones(
                labels, cell_size_m, n_zones,
                min_zone_area_ha=min_zone_area_ha,
                apply_mode_filter=apply_mode_filter,
            )
    except Exception:
        pass  # Post-processing is best-effort; don't break zonification

    actual_n = len(set(int(l) for l in labels.ravel() if l >= 0))
    features = zones_to_geojson(
        grid_x, grid_y, labels, values, actual_n, cell_size_deg,
        zone_names=zone_names, zone_colors=zone_colors,
        parcel_polygon_geom=parcel_polygon_geom,
    )
    return labels, features, membership_U

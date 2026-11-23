"""Tests for services/zonify.py — classify_agronomic, fuzzy_cmeans, create_zones."""
import numpy as np
import pytest
from services.zonify import (
    classify_agronomic, fuzzy_cmeans, elbow_k, classify_natural_breaks,
    spatial_kmeans, create_zones, zones_to_geojson,
)


# ─── classify_agronomic ───────────────────────────────────────────────────────

def test_ph_very_acid():
    labels, names, colors = classify_agronomic(np.array([5.0]), "ph")
    assert names[labels[0]] == "Muy ácido"


def test_ph_slightly_acid():
    labels, names, colors = classify_agronomic(np.array([6.5]), "ph")
    assert names[labels[0]] == "Ligeramente ácido"


def test_ph_optimal():
    labels, names, colors = classify_agronomic(np.array([7.0]), "ph")
    assert names[labels[0]] == "Óptimo"


def test_ph_multiple_categories():
    values = np.array([4.5, 6.0, 6.5, 7.0, 9.0])
    labels, names, colors = classify_agronomic(values, "ph")
    assert names[labels[0]] == "Muy ácido"
    assert names[labels[2]] == "Ligeramente ácido"
    assert names[labels[3]] == "Óptimo"
    assert names[labels[4]] == "Muy alcalino"


def test_mo_high():
    labels, names, colors = classify_agronomic(np.array([4.5]), "mo")
    assert names[labels[0]] == "Alto"


def test_mo_very_low():
    labels, names, colors = classify_agronomic(np.array([0.5]), "mo")
    assert names[labels[0]] == "Muy bajo"


def test_unknown_variable_returns_none():
    result, names, colors = classify_agronomic(np.array([1.0]), "unknown_var")
    assert result is None
    assert names == []
    assert colors == []


def test_returns_correct_number_of_zone_names():
    _, names, colors = classify_agronomic(np.array([5.0, 7.0]), "ph")
    assert len(names) == 6
    assert len(colors) == 6


# ─── fuzzy_cmeans ─────────────────────────────────────────────────────────────

def _make_fuzzy_data(n=30, seed=0):
    rng = np.random.default_rng(seed)
    cluster1 = rng.normal(1.0, 0.1, (10, 2))
    cluster2 = rng.normal(5.0, 0.1, (10, 2))
    cluster3 = rng.normal(9.0, 0.1, (10, 2))
    return np.vstack([cluster1, cluster2, cluster3])


def test_fuzzy_cmeans_membership_shape():
    X = _make_fuzzy_data()
    labels, U = fuzzy_cmeans(X, n_clusters=3)
    assert U.shape == (3, X.shape[0])


def test_fuzzy_cmeans_membership_sums_to_one():
    X = _make_fuzzy_data()
    labels, U = fuzzy_cmeans(X, n_clusters=3)
    col_sums = U.sum(axis=0)
    assert np.allclose(col_sums, 1.0, atol=1e-6)


def test_fuzzy_cmeans_labels_shape():
    X = _make_fuzzy_data()
    labels, U = fuzzy_cmeans(X, n_clusters=3)
    assert labels.shape == (X.shape[0],)


def test_fuzzy_cmeans_labels_range():
    X = _make_fuzzy_data()
    labels, U = fuzzy_cmeans(X, n_clusters=3)
    assert set(labels).issubset({0, 1, 2})


def test_fuzzy_cmeans_well_separated_clusters():
    """With 3 clearly separated clusters, labels should match structure."""
    X = _make_fuzzy_data()
    labels, U = fuzzy_cmeans(X, n_clusters=3)
    # First 10 points should all share one label (cluster around (1,1))
    first_cluster = labels[:10]
    assert len(set(first_cluster)) == 1


# ─── elbow_k ──────────────────────────────────────────────────────────────────

def test_elbow_k_returns_integer():
    values = np.array([1.0, 2.0, 5.0, 6.0, 10.0, 11.0, 15.0, 16.0])
    k = elbow_k(values, k_min=2, k_max=5)
    assert isinstance(k, int)
    assert 2 <= k <= 5


def test_elbow_k_too_few_points():
    k = elbow_k(np.array([1.0]), k_min=2, k_max=6)
    assert k == 2


# ─── classify_natural_breaks ──────────────────────────────────────────────────

def test_natural_breaks_shape():
    values = np.arange(30, dtype=float)
    labels = classify_natural_breaks(values, n_zones=3)
    assert labels.shape == values.shape


def test_natural_breaks_zones():
    values = np.arange(30, dtype=float)
    labels = classify_natural_breaks(values, n_zones=3)
    assert set(labels).issubset({0, 1, 2})


def test_natural_breaks_too_few_points():
    values = np.array([1.0, 2.0])
    labels = classify_natural_breaks(values, n_zones=5)
    assert labels.shape == (2,)


# ─── spatial_kmeans ───────────────────────────────────────────────────────────

def _make_grid_xy(n=5):
    lons = np.linspace(-63.5, -63.4, n)
    lats = np.linspace(-34.2, -34.1, n)
    gx, gy = np.meshgrid(lons, lats)
    values = gx + gy
    return gx, gy, values


def test_spatial_kmeans_shape():
    gx, gy, values = _make_grid_xy()
    labels = spatial_kmeans(gx, gy, values, n_clusters=3)
    assert labels.shape == values.ravel().shape


def test_spatial_kmeans_label_range():
    gx, gy, values = _make_grid_xy()
    labels = spatial_kmeans(gx, gy, values, n_clusters=3)
    valid = labels[labels >= 0]
    assert set(valid).issubset({0, 1, 2})


def test_spatial_kmeans_too_few_points():
    gx = np.array([[1.0]])
    gy = np.array([[1.0]])
    values = np.array([[5.0]])
    labels = spatial_kmeans(gx, gy, values, n_clusters=3)
    assert labels.shape == (1,)


# ─── create_zones ─────────────────────────────────────────────────────────────

def test_create_zones_spatial_kmeans():
    gx, gy, values = _make_grid_xy()
    labels, features, _membership = create_zones(gx, gy, values, n_zones=3, method="spatial_kmeans")
    assert labels.shape == gx.shape
    assert isinstance(features, list)


def test_create_zones_kmeans():
    gx, gy, values = _make_grid_xy()
    labels, features, _membership = create_zones(gx, gy, values, n_zones=3, method="kmeans")
    assert labels.shape == gx.shape


def test_create_zones_fuzzy():
    gx, gy, values = _make_grid_xy()
    labels, features, _membership = create_zones(gx, gy, values, n_zones=3, method="fuzzy")
    assert labels.shape == gx.shape


def test_create_zones_agronomic_ph():
    gx, gy, _ = _make_grid_xy()
    values = np.full(gx.shape, 6.5)
    labels, features, _membership = create_zones(gx, gy, values, n_zones=3, method="agronomic", variable_code="ph")
    assert labels.shape == gx.shape


def test_create_zones_agronomic_unknown_fallback():
    gx, gy, values = _make_grid_xy()
    labels, features, _membership = create_zones(gx, gy, values, n_zones=3, method="agronomic", variable_code="unknown")
    assert labels.size == gx.size


def test_create_zones_auto_k():
    gx, gy, values = _make_grid_xy(n=8)
    labels, features, _membership = create_zones(gx, gy, values, n_zones=3, method="spatial_kmeans", auto_k=True)
    assert labels.shape == gx.shape


def test_create_zones_features_geojson_format():
    gx, gy, values = _make_grid_xy()
    _, features, _ = create_zones(gx, gy, values, n_zones=2, method="kmeans")
    assert isinstance(features, list)
    if features:
        for feature in features:
            assert "geojson" in feature or "color" in feature or "area_ha" in feature


# ─── zones_to_geojson ─────────────────────────────────────────────────────────

def test_zones_to_geojson_returns_list():
    """zones_to_geojson returns a list of feature dicts."""
    gx, gy, values = _make_grid_xy()
    labels_flat = spatial_kmeans(gx, gy, values, n_clusters=3)
    labels_2d = labels_flat.reshape(gx.shape)
    cell_size = float(gx[0, 1] - gx[0, 0])
    features = zones_to_geojson(gx, gy, labels_2d, values, n_zones=3, cell_size_deg=cell_size)
    assert isinstance(features, list)
    assert len(features) > 0


def test_zones_to_geojson_feature_fields():
    """Each feature has required fields: geojson, area_ha, color."""
    gx, gy, values = _make_grid_xy()
    labels_flat = spatial_kmeans(gx, gy, values, n_clusters=2)
    labels_2d = labels_flat.reshape(gx.shape)
    cell_size = float(gx[0, 1] - gx[0, 0])
    features = zones_to_geojson(gx, gy, labels_2d, values, n_zones=2, cell_size_deg=cell_size)
    for f in features:
        assert "geojson" in f
        assert "area_ha" in f
        assert "color" in f


def test_zones_to_geojson_clipped_to_parcel_polygon():
    """When a parcel polygon is provided, all zone geometries are subsets of it."""
    from shapely.geometry import box as shp_box, shape as shp_shape
    gx, gy, values = _make_grid_xy()
    labels_flat = spatial_kmeans(gx, gy, values, n_clusters=2)
    labels_2d = labels_flat.reshape(gx.shape)
    cell_size = float(gx[0, 1] - gx[0, 0])
    parcel_poly = shp_box(float(gx.min()) - 0.001, float(gy.min()) - 0.001,
                          float(gx.max()) + 0.001, float(gy.max()) + 0.001)
    features = zones_to_geojson(
        gx, gy, labels_2d, values, n_zones=2,
        cell_size_deg=cell_size, parcel_polygon_geom=parcel_poly,
    )
    for f in features:
        zone_geom = shp_shape(f["geojson"])
        assert zone_geom.within(parcel_poly.buffer(1e-6)), \
            f"Zone geometry extends outside parcel polygon (area_ha={f.get('area_ha')})"

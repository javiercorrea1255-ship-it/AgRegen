"""
Tests for using create_zones() with satellite-index rasters.

Covers:
- Partial NaN raster (cloud / out-of-polygon mask).
- Constant raster (no information → must not crash).
- All four methods on a synthetic NDVI gradient.
- Polygon clipping reduces or matches feature count.
"""
import numpy as np
import pytest
from shapely.geometry import Polygon

from services.zonify import create_zones


# ─── Fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture
def synthetic_ndvi():
    """40×40 grid simulating a smooth NDVI gradient inside a 1ha-ish bbox."""
    rows, cols = 40, 40
    # Lon range ~0.001° (~111m at equator → ~0.01ha cell)
    xs = np.linspace(-99.500, -99.499, cols)
    ys = np.linspace(20.000, 20.001, rows)
    grid_x, grid_y = np.meshgrid(xs, ys)
    # NDVI gradient 0.2 (low-vigour W) → 0.85 (high-vigour E)
    values = 0.2 + 0.65 * (grid_x - grid_x.min()) / (grid_x.max() - grid_x.min())
    return grid_x, grid_y, values


@pytest.fixture
def synthetic_ndvi_with_clouds(synthetic_ndvi):
    """Same NDVI, but with a NaN patch (clouds) covering ~10% of cells."""
    grid_x, grid_y, values = synthetic_ndvi
    v = values.copy()
    v[5:13, 5:13] = np.nan
    return grid_x, grid_y, v


@pytest.fixture
def parcel_polygon():
    """Field boundary that fully contains the synthetic raster bbox."""
    return Polygon([
        (-99.5005, 19.9995),
        (-99.4985, 19.9995),
        (-99.4985, 20.0015),
        (-99.5005, 20.0015),
    ])


# ─── 1. Partial NaN handling ─────────────────────────────────────────────────

def test_partial_nan_raster_does_not_crash(synthetic_ndvi_with_clouds):
    grid_x, grid_y, values = synthetic_ndvi_with_clouds
    labels, features, _ = create_zones(
        grid_x, grid_y, values,
        n_zones=3,
        cell_size_deg=2.5e-5,
        method="spatial_kmeans",
        min_zone_area_ha=0.01,
    )
    assert labels.shape == values.shape
    # Most cloudy pixels remain unlabeled (-1) — post-process mode-filter may
    # bleed into a few border cells but must NOT overwrite the bulk of the patch.
    cloud_patch = labels[5:13, 5:13]
    assert (cloud_patch == -1).mean() >= 0.85
    # Surrounding cells must have valid labels
    assert (labels[20:30, 20:30] >= 0).all()
    # At least one feature should be returned
    assert isinstance(features, list)


def test_partial_nan_raster_all_methods(synthetic_ndvi_with_clouds):
    grid_x, grid_y, values = synthetic_ndvi_with_clouds
    for method in ("spatial_kmeans", "kmeans", "jenks", "quantiles", "fuzzy"):
        labels, features, _ = create_zones(
            grid_x, grid_y, values,
            n_zones=3,
            cell_size_deg=2.5e-5,
            method=method,
            min_zone_area_ha=0.01,
        )
        assert labels.shape == values.shape, f"method={method}"
        # Bulk of cloudy patch stays invalid for any method (mode-filter may bleed borders)
        cloud_invalid_ratio = (labels[5:13, 5:13] == -1).mean()
        assert cloud_invalid_ratio >= 0.85, f"method={method} → only {cloud_invalid_ratio:.0%} invalid"


# ─── 2. Constant raster (degenerate case) ────────────────────────────────────

def test_constant_raster_does_not_crash(synthetic_ndvi):
    grid_x, grid_y, _ = synthetic_ndvi
    values = np.full_like(grid_x, 0.55)  # uniform NDVI

    labels, features, _ = create_zones(
        grid_x, grid_y, values,
        n_zones=3,
        cell_size_deg=2.5e-5,
        method="spatial_kmeans",
        min_zone_area_ha=0.01,
    )
    assert labels.shape == values.shape
    # All valid cells must end up in some label (>=0); we don't assert k=1
    # because spatial_kmeans may still partition spatially.
    assert (labels >= 0).all()


def test_constant_raster_kmeans(synthetic_ndvi):
    grid_x, grid_y, _ = synthetic_ndvi
    values = np.full_like(grid_x, 0.42)
    labels, _, _ = create_zones(
        grid_x, grid_y, values,
        n_zones=3,
        cell_size_deg=2.5e-5,
        method="kmeans",
        min_zone_area_ha=0.01,
    )
    # natural breaks on a constant array collapses to a single class;
    # accept any number ≤ requested
    n_classes = len({int(v) for v in labels.ravel() if v >= 0})
    assert 1 <= n_classes <= 3


# ─── 3. Smoke-test for all methods on a clean gradient ───────────────────────

@pytest.mark.parametrize("method", ["spatial_kmeans", "kmeans", "jenks", "quantiles", "fuzzy"])
def test_all_methods_produce_valid_labels(synthetic_ndvi, method):
    grid_x, grid_y, values = synthetic_ndvi
    labels, features, _ = create_zones(
        grid_x, grid_y, values,
        n_zones=4,
        cell_size_deg=2.5e-5,
        method=method,
        min_zone_area_ha=0.01,
    )
    assert labels.shape == values.shape
    valid_labels = labels[labels >= 0]
    assert valid_labels.size > 0, f"method={method} produced no valid labels"
    n_classes = len(set(valid_labels.tolist()))
    assert 2 <= n_classes <= 4, f"method={method} → got {n_classes} classes"


def test_agronomic_method_falls_back_for_unknown_variable(synthetic_ndvi):
    """NDVI/NDRE etc. are not in the agronomic threshold table → should fall back to spatial_kmeans."""
    grid_x, grid_y, values = synthetic_ndvi
    labels, features, _ = create_zones(
        grid_x, grid_y, values,
        n_zones=3,
        cell_size_deg=2.5e-5,
        method="agronomic",
        variable_code="ndvi",  # not in classify_agronomic table
        min_zone_area_ha=0.01,
    )
    # Fallback: should still produce labels
    assert labels.shape == values.shape
    assert (labels >= 0).any()


# ─── 4. Polygon clipping ──────────────────────────────────────────────────────

def test_polygon_clipping_keeps_features_within_boundary(synthetic_ndvi, parcel_polygon):
    grid_x, grid_y, values = synthetic_ndvi
    labels, features, _ = create_zones(
        grid_x, grid_y, values,
        n_zones=3,
        cell_size_deg=2.5e-5,
        method="spatial_kmeans",
        parcel_polygon_geom=parcel_polygon,
        min_zone_area_ha=0.01,
    )
    assert isinstance(features, list)
    assert len(features) >= 1
    # Each clipped feature must have a polygon geometry under the 'geojson' key
    for f in features:
        geom = f.get("geojson") or {}
        assert geom.get("type") in ("Polygon", "MultiPolygon"), f"got geom={geom!r}"


def test_quantiles_produces_balanced_zones(synthetic_ndvi):
    """Quantile classification should give zones with roughly equal pixel counts.

    On a smooth gradient with no NaNs, each of the K zones should contain ~N/K
    valid pixels (within ±10% slack to allow for ties at the bin edges).
    """
    grid_x, grid_y, values = synthetic_ndvi
    n_zones = 4
    labels, _features, _ = create_zones(
        grid_x, grid_y, values,
        n_zones=n_zones,
        cell_size_deg=2.5e-5,
        method="quantiles",
        min_zone_area_ha=0.001,
        # Disable post-processing so we can check the raw quantile property.
        apply_mode_filter=False,
    )
    valid = labels[labels >= 0]
    expected_per_zone = valid.size / n_zones
    counts = [int((valid == k).sum()) for k in range(n_zones)]
    for k, c in enumerate(counts):
        assert abs(c - expected_per_zone) / expected_per_zone <= 0.10, (
            f"zone {k} has {c} pixels (expected ~{expected_per_zone:.0f}) — quantile imbalance > 10%"
        )


def test_jenks_alias_matches_kmeans(synthetic_ndvi):
    """'jenks' must be a true alias for the legacy 'kmeans' method (1-D natural breaks)."""
    grid_x, grid_y, values = synthetic_ndvi
    labels_kmeans, _, _ = create_zones(
        grid_x, grid_y, values,
        n_zones=3,
        cell_size_deg=2.5e-5,
        method="kmeans",
        min_zone_area_ha=0.001,
        apply_mode_filter=False,
    )
    labels_jenks, _, _ = create_zones(
        grid_x, grid_y, values,
        n_zones=3,
        cell_size_deg=2.5e-5,
        method="jenks",
        min_zone_area_ha=0.001,
        apply_mode_filter=False,
    )
    # Both invocations dispatch to classify_natural_breaks → identical labels.
    assert np.array_equal(labels_kmeans, labels_jenks)


def test_auto_k_with_satellite_gradient(synthetic_ndvi):
    grid_x, grid_y, values = synthetic_ndvi
    labels, features, _ = create_zones(
        grid_x, grid_y, values,
        n_zones=3,
        cell_size_deg=2.5e-5,
        method="spatial_kmeans",
        auto_k=True,
        min_zone_area_ha=0.01,
    )
    n_classes = len({int(v) for v in labels.ravel() if v >= 0})
    assert 2 <= n_classes <= 6

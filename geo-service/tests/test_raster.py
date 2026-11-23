"""Tests for services/raster.py — PNG and GeoTIFF generation."""
import numpy as np
import pytest
import base64
import io
from services.raster import values_to_png_base64, values_to_geotiff_bytes, make_grid, COLORMAPS


def _sample_grid(rows=10, cols=10, nan_fraction=0.1, seed=0):
    rng = np.random.default_rng(seed)
    data = rng.uniform(1.0, 10.0, (rows, cols))
    n_nan = int(rows * cols * nan_fraction)
    idx = rng.choice(rows * cols, size=n_nan, replace=False)
    flat = data.ravel()
    flat[idx] = np.nan
    return flat.reshape(rows, cols)


BBOX = {"minx": -63.5, "miny": -34.2, "maxx": -63.4, "maxy": -34.1}


# ─── values_to_png_base64 ─────────────────────────────────────────────────────

def test_png_base64_returns_string():
    data = _sample_grid()
    result = values_to_png_base64(data)
    assert isinstance(result, str)
    assert len(result) > 0


def test_png_base64_is_valid_b64():
    data = _sample_grid()
    encoded = values_to_png_base64(data)
    decoded = base64.b64decode(encoded)
    assert decoded[:8] == b'\x89PNG\r\n\x1a\n'


def test_png_explicit_vmin_vmax():
    data = _sample_grid()
    result = values_to_png_base64(data, vmin=0.0, vmax=20.0)
    assert isinstance(result, str)


def test_png_uniform_data_no_crash():
    """When vmin == vmax, the function adjusts automatically to avoid norm error."""
    data = np.full((5, 5), 5.0)
    result = values_to_png_base64(data)
    assert isinstance(result, str)


def test_png_with_cmap_ndvi():
    data = _sample_grid()
    result = values_to_png_base64(data, cmap_name="ndvi")
    assert isinstance(result, str)


def test_png_with_cmap_ph():
    data = _sample_grid()
    result = values_to_png_base64(data, cmap_name="ph")
    assert isinstance(result, str)


def test_png_without_alpha():
    data = _sample_grid()
    result = values_to_png_base64(data, add_alpha=False)
    assert isinstance(result, str)


def test_png_unknown_cmap_falls_back():
    data = _sample_grid()
    result = values_to_png_base64(data, cmap_name="unknown_cmap")
    assert isinstance(result, str)


def test_png_all_nan():
    data = np.full((5, 5), np.nan)
    result = values_to_png_base64(data)
    assert isinstance(result, str)


# ─── values_to_geotiff_bytes ──────────────────────────────────────────────────

def test_geotiff_returns_bytes():
    data = _sample_grid()
    result = values_to_geotiff_bytes(data, BBOX)
    assert isinstance(result, bytes)
    assert len(result) > 0


def test_geotiff_is_valid_tiff():
    """GeoTIFF files start with TIFF magic bytes."""
    data = _sample_grid()
    result = values_to_geotiff_bytes(data, BBOX)
    assert result[:4] in (b'II\x2a\x00', b'MM\x00\x2a')


def test_geotiff_readable_by_rasterio():
    import rasterio
    data = _sample_grid()
    tiff_bytes = values_to_geotiff_bytes(data, BBOX)
    with rasterio.open(io.BytesIO(tiff_bytes)) as ds:
        assert str(ds.crs) == "EPSG:4326"
        assert ds.dtypes[0] == "float32"
        assert ds.nodata == -9999.0


def test_geotiff_nan_becomes_nodata():
    import rasterio
    data = np.array([[1.0, np.nan], [3.0, 4.0]])
    tiff_bytes = values_to_geotiff_bytes(data, BBOX)
    with rasterio.open(io.BytesIO(tiff_bytes)) as ds:
        arr = ds.read(1)
        assert np.any(arr == -9999.0)


def test_geotiff_north_up_orientation():
    """Top row of GeoTIFF should correspond to north (highest latitude) values."""
    import rasterio
    data = np.array([
        [1.0, 2.0],
        [3.0, 4.0],
    ])
    tiff_bytes = values_to_geotiff_bytes(data, BBOX)
    with rasterio.open(io.BytesIO(tiff_bytes)) as ds:
        assert ds.transform.e < 0


def test_geotiff_shape_correct():
    import rasterio
    rows, cols = 8, 12
    data = _sample_grid(rows=rows, cols=cols, nan_fraction=0)
    tiff_bytes = values_to_geotiff_bytes(data, BBOX)
    with rasterio.open(io.BytesIO(tiff_bytes)) as ds:
        assert ds.height == rows
        assert ds.width == cols


# ─── make_grid ────────────────────────────────────────────────────────────────

def test_make_grid_shape():
    gx, gy = make_grid((-63.5, -34.2, -63.4, -34.1), resolution=50)
    assert gx.shape == (50, 50)
    assert gy.shape == (50, 50)


def test_make_grid_extent():
    bbox = (-63.5, -34.2, -63.4, -34.1)
    gx, gy = make_grid(bbox, resolution=10)
    assert float(gx.min()) == pytest.approx(bbox[0])
    assert float(gx.max()) == pytest.approx(bbox[2])
    assert float(gy.min()) == pytest.approx(bbox[1])
    assert float(gy.max()) == pytest.approx(bbox[3])


# ─── COLORMAPS dict ───────────────────────────────────────────────────────────

def test_colormaps_has_expected_keys():
    for key in ("ndvi", "ph", "mo", "n", "p", "k", "ce", "default"):
        assert key in COLORMAPS

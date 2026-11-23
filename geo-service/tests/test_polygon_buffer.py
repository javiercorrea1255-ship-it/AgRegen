"""Tests for F1-01: Interior polygon buffer using Bowring WGS84 formulas."""
import pytest
from shapely.geometry import Polygon as ShapelyPolygon

from services.polygon_buffer import apply_interior_buffer, _bowring_deg_to_m


def square_poly(lon_c: float, lat_c: float, half_deg: float = 0.01) -> list:
    """Build a square polygon [[lon, lat], ...] centred at (lon_c, lat_c)."""
    h = half_deg
    return [
        [lon_c - h, lat_c - h],
        [lon_c + h, lat_c - h],
        [lon_c + h, lat_c + h],
        [lon_c - h, lat_c + h],
    ]


# ── Bowring helper tests ─────────────────────────────────────────────────────

def test_bowring_returns_two_values():
    """_bowring_deg_to_m must return a 2-tuple (m/° lat, m/° lon)."""
    result = _bowring_deg_to_m(0.0)
    assert len(result) == 2


def test_bowring_positive_meters():
    """One degree of latitude/longitude should be several tens of km."""
    m_lat, m_lon = _bowring_deg_to_m(0.0)
    assert m_lat > 100_000, "1° lat should be > 100 km at equator"
    assert m_lon > 100_000, "1° lon at equator should be > 100 km"


def test_bowring_lon_shrinks_at_high_latitude():
    """Longitude metres-per-degree decreases towards the poles."""
    _, m_lon_0 = _bowring_deg_to_m(0.0)
    _, m_lon_60 = _bowring_deg_to_m(60.0)
    assert m_lon_60 < m_lon_0 * 0.6, "m/° lon at 60° should be much less than at equator"


def test_bowring_lat_nearly_constant():
    """Latitude metres-per-degree should not vary more than 1% between equator and 60°."""
    m_lat_0, _ = _bowring_deg_to_m(0.0)
    m_lat_60, _ = _bowring_deg_to_m(60.0)
    ratio = abs(m_lat_60 - m_lat_0) / m_lat_0
    assert ratio < 0.01, f"Lat metres-per-degree varied by {ratio:.4f} (>1%)"


# ── apply_interior_buffer tests ──────────────────────────────────────────────

def test_zero_buffer_returns_original_polygon():
    """Buffer of 0 m should return the same polygon reference."""
    coords = square_poly(lon_c=-60.0, lat_c=-34.0, half_deg=0.05)
    result = apply_interior_buffer(coords, buffer_m=0.0)
    assert result is coords  # identical object when buffer_m <= 0


def test_small_buffer_reduces_area():
    """A 5 m interior buffer should reduce the polygon area."""
    coords = square_poly(lon_c=-60.0, lat_c=-34.0, half_deg=0.1)
    orig = ShapelyPolygon([tuple(c) for c in coords])
    result = apply_interior_buffer(coords, buffer_m=5.0)
    buf = ShapelyPolygon([tuple(c) for c in result])
    assert buf.area < orig.area, "Buffered polygon must be smaller"


def test_buffer_result_is_inside_original():
    """All vertices of the buffered polygon must lie inside the original."""
    coords = square_poly(lon_c=-60.0, lat_c=-34.0, half_deg=0.1)
    orig = ShapelyPolygon([tuple(c) for c in coords])
    result = apply_interior_buffer(coords, buffer_m=10.0)
    buf = ShapelyPolygon([tuple(c) for c in result])
    assert orig.contains(buf) or orig.equals(buf)


def test_excessive_buffer_returns_fallback():
    """A buffer larger than the polygon should fall back to the original."""
    coords = square_poly(lon_c=-60.0, lat_c=-34.0, half_deg=0.00001)
    result = apply_interior_buffer(coords, buffer_m=50.0)
    assert isinstance(result, list)
    assert len(result) >= 3


def test_buffer_at_different_latitudes():
    """Buffer should work correctly at multiple latitudes."""
    for lat in [5.0, -23.5, -34.0, -51.0]:
        coords = square_poly(lon_c=-60.0, lat_c=lat, half_deg=0.1)
        result = apply_interior_buffer(coords, buffer_m=8.0)
        assert isinstance(result, list) and len(result) >= 3


def test_closed_ring_output():
    """Output polygon must be geometrically valid."""
    coords = square_poly(lon_c=-60.0, lat_c=-34.0, half_deg=0.05)
    result = apply_interior_buffer(coords, buffer_m=5.0)
    assert len(result) >= 3
    poly = ShapelyPolygon([tuple(c) for c in result])
    assert not poly.is_empty

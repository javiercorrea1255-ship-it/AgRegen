"""Tests for services/grid_generator.py."""
import numpy as np
import pytest
from services.grid_generator import (
    optimal_sample_size,
    generate_regular_grid,
    generate_hexagonal_grid,
    generate_stratified_lhs,
    generate_grid,
    n_cochran,
    n_fao,
    n_cressie_wikle,
    bbox_from_polygon,
    point_in_polygon,
    polygon_area_ha,
)

SQUARE_10HA = [
    [-63.501, -34.201],
    [-63.501, -34.192],
    [-63.492, -34.192],
    [-63.492, -34.201],
]

SMALL_SQUARE = [
    [-63.500, -34.200],
    [-63.500, -34.199],
    [-63.499, -34.199],
    [-63.499, -34.200],
]


# ─── helpers ──────────────────────────────────────────────────────────────────

def test_bbox_from_polygon():
    minx, miny, maxx, maxy = bbox_from_polygon(SQUARE_10HA)
    assert minx == pytest.approx(-63.501)
    assert miny == pytest.approx(-34.201)
    assert maxx == pytest.approx(-63.492)
    assert maxy == pytest.approx(-34.192)


def test_point_in_polygon_inside():
    assert point_in_polygon([-63.496, -34.196], SQUARE_10HA) is True


def test_point_in_polygon_outside():
    assert point_in_polygon([-63.600, -34.300], SQUARE_10HA) is False


def test_polygon_area_ha_positive():
    area = polygon_area_ha(SQUARE_10HA)
    assert area > 0.0


# ─── n_ functions ─────────────────────────────────────────────────────────────

def test_n_cochran_reasonable():
    n = n_cochran(cv_pct=30, precision_pct=20)
    assert n >= 3
    assert n <= 100


def test_n_fao_small_area():
    n = n_fao(1.0)
    assert n == 5


def test_n_fao_large_area():
    n = n_fao(500.0)
    assert n == 60


def test_n_cressie_wikle_clamped():
    n = n_cressie_wikle(1.0, range_m=300.0)
    assert n >= 5
    assert n <= 100


# ─── optimal_sample_size ──────────────────────────────────────────────────────

def test_optimal_sample_size_reasonable_large():
    result = optimal_sample_size(SQUARE_10HA, cv_pct=30)
    n = result["n_optimal"]
    assert 5 <= n <= 60


def test_optimal_sample_size_low_cv():
    result = optimal_sample_size(SMALL_SQUARE, cv_pct=10)
    n = result["n_optimal"]
    assert n >= 5


def test_optimal_sample_size_contains_keys():
    result = optimal_sample_size(SQUARE_10HA)
    for key in ("area_ha", "n_cochran", "n_fao", "n_cressie_wikle", "n_optimal"):
        assert key in result


# ─── regular grid ─────────────────────────────────────────────────────────────

def test_regular_grid_count():
    pts = generate_regular_grid(SQUARE_10HA, n_points=25)
    assert len(pts) == 25


def test_regular_grid_inside_bbox():
    pts = generate_regular_grid(SQUARE_10HA, n_points=20)
    minx, miny, maxx, maxy = bbox_from_polygon(SQUARE_10HA)
    for p in pts:
        assert minx <= p["lon"] <= maxx
        assert miny <= p["lat"] <= maxy


def test_regular_grid_has_lon_lat():
    pts = generate_regular_grid(SQUARE_10HA, n_points=5)
    for p in pts:
        assert "lon" in p and "lat" in p


# ─── hexagonal grid ───────────────────────────────────────────────────────────

def test_hexagonal_grid_count():
    pts = generate_hexagonal_grid(SQUARE_10HA, n_points=25)
    assert len(pts) == 25


def test_hexagonal_grid_inside_bbox():
    pts = generate_hexagonal_grid(SQUARE_10HA, n_points=20)
    minx, miny, maxx, maxy = bbox_from_polygon(SQUARE_10HA)
    for p in pts:
        assert minx - 0.001 <= p["lon"] <= maxx + 0.001
        assert miny - 0.001 <= p["lat"] <= maxy + 0.001


# ─── stratified LHS ───────────────────────────────────────────────────────────

def test_stratified_lhs_count():
    pts = generate_stratified_lhs(SQUARE_10HA, n_points=20)
    assert len(pts) == 20


def test_stratified_lhs_has_coords():
    pts = generate_stratified_lhs(SQUARE_10HA, n_points=10)
    for p in pts:
        assert "lon" in p and "lat" in p


# ─── generate_grid dispatcher ─────────────────────────────────────────────────

def test_generate_grid_regular():
    result = generate_grid(SQUARE_10HA, n_points=10, grid_type="regular")
    assert result["type"] == "FeatureCollection"
    assert len(result["features"]) == 10


def test_generate_grid_hexagonal():
    result = generate_grid(SQUARE_10HA, n_points=10, grid_type="hexagonal")
    assert result["type"] == "FeatureCollection"
    assert len(result["features"]) == 10


def test_generate_grid_stratified():
    result = generate_grid(SQUARE_10HA, n_points=10, grid_type="stratified")
    assert result["type"] == "FeatureCollection"
    assert result["meta"]["grid_type"] == "stratified"

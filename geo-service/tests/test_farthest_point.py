"""Tests for F1-02: Farthest-Point (Maximin) subsampling in grid_generator."""
import pytest
import numpy as np
from itertools import combinations

from services.grid_generator import _farthest_point_subsample


def make_pts(locs: list) -> list:
    """Convert [(lon, lat), ...] to [{lon, lat}, ...] as expected by the function."""
    return [{"lon": float(x), "lat": float(y)} for x, y in locs]


def clustered_pts(n: int = 40, seed: int = 42) -> list:
    rng = np.random.default_rng(seed)
    a = rng.normal(loc=[0.0, 0.0], scale=0.01, size=(n // 2, 2))
    b = rng.normal(loc=[1.0, 1.0], scale=0.01, size=(n // 2, 2))
    pts = np.vstack([a, b])
    return [{"lon": float(p[0]), "lat": float(p[1])} for p in pts]


def min_nn_dist(pts: list) -> float:
    """Min pairwise distance (slow but correct for small n)."""
    coords = [(p["lon"], p["lat"]) for p in pts]
    dists = [np.linalg.norm(np.array(a) - np.array(b)) for a, b in combinations(coords, 2)]
    return min(dists) if dists else 0.0


# ── Tests ────────────────────────────────────────────────────────────────────

def test_farthest_point_returns_correct_count():
    pts = clustered_pts(40)
    result = _farthest_point_subsample(pts, n=10)
    assert len(result) == 10


def test_farthest_point_dicts_with_lon_lat():
    """Returned items must have 'lon' and 'lat' keys."""
    pts = clustered_pts(20)
    result = _farthest_point_subsample(pts, n=6)
    for item in result:
        assert "lon" in item and "lat" in item


def test_farthest_point_better_coverage_than_random():
    """FPS selected set should have ≥ half the min-NN-dist of a random subset."""
    import random
    random.seed(0)
    pts = clustered_pts(60)
    k = 12
    fp = _farthest_point_subsample(pts, n=k)
    rand_pts = random.sample(pts, k)
    assert min_nn_dist(fp) >= min_nn_dist(rand_pts) * 0.5


def test_farthest_point_k_equals_n():
    """When n == len(pts), all points should be returned."""
    pts = clustered_pts(8)
    result = _farthest_point_subsample(pts, n=8)
    assert len(result) == 8


def test_farthest_point_k_larger_than_n_returns_all():
    """When n > len(pts), should return all pts without error."""
    pts = clustered_pts(5)
    result = _farthest_point_subsample(pts, n=20)
    assert len(result) == len(pts)

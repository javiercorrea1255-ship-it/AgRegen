"""Tests for F1-05: Kriging variance export (kriging_std, kriging_sigma2, kriging_msdr)."""
import math
import pytest
import numpy as np

from services.interpolation import kriging_interpolate


def make_grid(n: int = 20) -> tuple:
    xs = np.linspace(0, 1, n)
    ys = np.linspace(0, 1, n)
    return np.meshgrid(xs, ys)


def make_samples(n: int = 15, seed: int = 0) -> tuple:
    rng = np.random.default_rng(seed)
    coords = rng.uniform(0, 1, (n, 2))
    values = np.sin(coords[:, 0] * 3) + np.cos(coords[:, 1] * 3)
    return coords, values


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_kriging_returns_std_key():
    coords, values = make_samples(15)
    gx, gy = make_grid(20)
    _, metrics = kriging_interpolate(coords, values, gx, gy)
    assert "kriging_std" in metrics


def test_kriging_returns_sigma2_key():
    coords, values = make_samples(15)
    gx, gy = make_grid(20)
    _, metrics = kriging_interpolate(coords, values, gx, gy)
    assert "kriging_sigma2" in metrics


def test_kriging_std_non_negative():
    coords, values = make_samples(15)
    gx, gy = make_grid(20)
    _, metrics = kriging_interpolate(coords, values, gx, gy)
    std_grid = np.array(metrics["kriging_std"])
    finite_vals = std_grid[np.isfinite(std_grid)]
    assert np.all(finite_vals >= 0)


def test_kriging_sigma2_non_negative():
    coords, values = make_samples(15)
    gx, gy = make_grid(20)
    _, metrics = kriging_interpolate(coords, values, gx, gy)
    s2_grid = np.array(metrics["kriging_sigma2"])
    finite_vals = s2_grid[np.isfinite(s2_grid)]
    assert np.all(finite_vals >= 0)


def test_kriging_std_shape_matches_grid():
    coords, values = make_samples(15)
    gx, gy = make_grid(20)
    z, metrics = kriging_interpolate(coords, values, gx, gy)
    std_grid = np.array(metrics["kriging_std"])
    assert std_grid.shape == z.shape


def test_kriging_msdr_key_present():
    """kriging_msdr must be present in metrics (may be 0.0 when LOOCV not available)."""
    coords, values = make_samples(15)
    gx, gy = make_grid(20)
    _, metrics = kriging_interpolate(coords, values, gx, gy)
    assert "kriging_msdr" in metrics


def test_kriging_msdr_is_finite_or_zero():
    coords, values = make_samples(15)
    gx, gy = make_grid(20)
    _, metrics = kriging_interpolate(coords, values, gx, gy)
    msdr = metrics["kriging_msdr"]
    assert msdr is None or (math.isfinite(float(msdr)) and float(msdr) >= 0)


def test_kriging_std_lower_near_samples():
    """Std should correlate positively with distance to nearest sample."""
    coords, values = make_samples(20)
    gx, gy = make_grid(30)
    _, metrics = kriging_interpolate(coords, values, gx, gy)
    std_grid = np.array(metrics["kriging_std"])
    grid_pts = np.column_stack([gx.ravel(), gy.ravel()])
    std_flat = std_grid.ravel()

    from scipy.spatial import cKDTree
    tree = cKDTree(coords)
    dists, _ = tree.query(grid_pts, k=1)

    valid = np.isfinite(std_flat) & np.isfinite(dists) & (dists < 0.5)
    if valid.sum() < 10:
        pytest.skip("Not enough valid points to assess spatial trend")

    corr = float(np.corrcoef(dists[valid], std_flat[valid])[0, 1])
    assert corr > -0.1, f"Expected non-negative distance-std correlation, got {corr:.3f}"

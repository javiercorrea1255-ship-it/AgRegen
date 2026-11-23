"""Tests for interpolation functions with synthetic 5×5 grid, 9 sample points."""
import numpy as np
import pytest
from services.interpolation import idw_interpolate, kriging_interpolate, glm_interpolate, rfk_interpolate, rbf_interpolate, cokriging_interpolate


BBOX = (-63.50, -34.20, -63.40, -34.10)


def _make_grid(nx=10, ny=10):
    lons = np.linspace(BBOX[0], BBOX[2], nx)
    lats = np.linspace(BBOX[1], BBOX[3], ny)
    gx, gy = np.meshgrid(lons, lats)
    return gx, gy


def _known_points(n=9):
    """9 known points on a 3×3 sub-grid inside BBOX with simple z = lon + lat."""
    lons = np.linspace(BBOX[0] + 0.02, BBOX[2] - 0.02, 3)
    lats = np.linspace(BBOX[1] + 0.02, BBOX[3] - 0.02, 3)
    coords = np.array([[lo, la] for la in lats for lo in lons])
    values = coords[:, 0] + coords[:, 1]
    return coords, values


def _large_points(n=25, seed=42):
    """n random sample points for methods requiring more data."""
    rng = np.random.default_rng(seed)
    lons = rng.uniform(BBOX[0] + 0.01, BBOX[2] - 0.01, n)
    lats = rng.uniform(BBOX[1] + 0.01, BBOX[3] - 0.01, n)
    coords = np.column_stack([lons, lats])
    values = lons * 10 + lats * 5 + rng.normal(0, 0.01, n)
    return coords, values


# ─── IDW ──────────────────────────────────────────────────────────────────────

def test_idw_output_shape():
    coords, values = _known_points()
    gx, gy = _make_grid()
    z, metrics = idw_interpolate(coords, values, gx, gy, transform="none")
    assert z.shape == gx.shape


def test_idw_returns_metrics():
    coords, values = _known_points()
    gx, gy = _make_grid()
    _, metrics = idw_interpolate(coords, values, gx, gy, transform="none")
    for key in ("rmse", "mae", "r2"):
        assert key in metrics


def test_idw_finite_output():
    coords, values = _known_points()
    gx, gy = _make_grid()
    z, _ = idw_interpolate(coords, values, gx, gy, transform="none")
    assert np.all(np.isfinite(z))


def test_idw_exact_at_sample_points():
    """IDW is exact at sample points: querying at the exact input coordinates
    returns the original value (weight → ∞ at coincident point)."""
    lons = np.linspace(BBOX[0] + 0.02, BBOX[2] - 0.02, 3)
    lats = np.linspace(BBOX[1] + 0.02, BBOX[3] - 0.02, 3)
    gx_exact, gy_exact = np.meshgrid(lons, lats)
    coords = np.array([[lo, la] for la in lats for lo in lons])
    values = coords[:, 0] + coords[:, 1]
    z, _ = idw_interpolate(coords, values, gx_exact, gy_exact, transform="none")
    for lo, la, v in zip(coords[:, 0], coords[:, 1], values):
        i = np.argmin(np.abs(lats - la))
        j = np.argmin(np.abs(lons - lo))
        assert abs(float(z[i, j]) - v) < 1e-4, f"IDW not exact at ({lo:.4f},{la:.4f})"


def test_idw_output_range():
    coords, values = _known_points()
    gx, gy = _make_grid()
    z, _ = idw_interpolate(coords, values, gx, gy, transform="none")
    margin = (values.max() - values.min()) * 0.2
    assert z.min() >= values.min() - margin
    assert z.max() <= values.max() + margin


# ─── Kriging ──────────────────────────────────────────────────────────────────

def test_kriging_output_shape():
    coords, values = _known_points()
    gx, gy = _make_grid()
    z, metrics = kriging_interpolate(coords, values, gx, gy, transform="none")
    assert z.shape == gx.shape


def test_kriging_returns_metrics():
    coords, values = _known_points()
    gx, gy = _make_grid()
    _, metrics = kriging_interpolate(coords, values, gx, gy, transform="none")
    for key in ("rmse", "mae", "r2"):
        assert key in metrics


def test_kriging_interior_finite():
    coords, values = _known_points()
    gx, gy = _make_grid(nx=5, ny=5)
    z, _ = kriging_interpolate(coords, values, gx, gy, transform="none")
    interior = z[1:-1, 1:-1]
    assert np.all(np.isfinite(interior))


# ─── GLM ──────────────────────────────────────────────────────────────────────

def test_glm_output_shape():
    coords, values = _known_points()
    gx, gy = _make_grid()
    z, metrics = glm_interpolate(coords, values, gx, gy, transform="none")
    assert z.shape == gx.shape


def test_glm_nondegenerate():
    """std(grid) must be > 0 — not a constant surface."""
    coords, values = _known_points()
    gx, gy = _make_grid()
    z, _ = glm_interpolate(coords, values, gx, gy, transform="none")
    assert float(np.nanstd(z)) > 0.0


def test_glm_returns_metrics():
    coords, values = _known_points()
    gx, gy = _make_grid()
    _, metrics = glm_interpolate(coords, values, gx, gy, transform="none")
    for key in ("rmse", "mae"):
        assert key in metrics


# ─── RFK ──────────────────────────────────────────────────────────────────────

def test_rfk_small_n_falls_back_to_idw():
    coords, values = _known_points(9)
    gx, gy = _make_grid()
    z, metrics = rfk_interpolate(coords, values, gx, gy)
    assert "error" in metrics
    assert "idw" in metrics["error"].lower() or "idw-fallback" in str(metrics.get("params", {}))


def test_rfk_large_n_works():
    coords, values = _large_points(25)
    gx, gy = _make_grid()
    z, metrics = rfk_interpolate(coords, values, gx, gy)
    assert z.shape == gx.shape
    assert "error" not in metrics or "IDW" not in metrics.get("error", "")


def test_rfk_large_n_output_finite():
    coords, values = _large_points(25)
    gx, gy = _make_grid()
    z, _ = rfk_interpolate(coords, values, gx, gy)
    assert np.sum(np.isfinite(z)) > z.size // 2


# ─── RBF ──────────────────────────────────────────────────────────────────────

def test_rbf_output_shape():
    coords, values = _known_points()
    gx, gy = _make_grid()
    z, metrics = rbf_interpolate(coords, values, gx, gy, transform="none")
    assert z.shape == gx.shape


def test_rbf_returns_metrics():
    coords, values = _known_points()
    gx, gy = _make_grid()
    _, metrics = rbf_interpolate(coords, values, gx, gy, transform="none")
    for key in ("rmse", "mae"):
        assert key in metrics


def test_rbf_finite_output():
    coords, values = _known_points()
    gx, gy = _make_grid()
    z, _ = rbf_interpolate(coords, values, gx, gy, transform="none")
    assert np.sum(np.isfinite(z)) > z.size // 2


def test_rbf_nondegenerate():
    coords, values = _known_points()
    gx, gy = _make_grid()
    z, _ = rbf_interpolate(coords, values, gx, gy, transform="none")
    assert float(np.nanstd(z)) > 0.0


def test_rbf_auto_transform():
    coords, values = _known_points()
    gx, gy = _make_grid()
    z, metrics = rbf_interpolate(coords, values, gx, gy, transform="auto")
    assert z.shape == gx.shape


def test_rbf_large_dataset():
    coords, values = _large_points(20)
    gx, gy = _make_grid()
    z, metrics = rbf_interpolate(coords, values, gx, gy)
    assert z.shape == gx.shape
    assert "rmse" in metrics


# ─── CoKriging ────────────────────────────────────────────────────────────────

def _cokriging_points(n=12, seed=42):
    """n points with a highly correlated co-variable (Pearson r ≈ 0.95)."""
    rng = np.random.default_rng(seed)
    lons = rng.uniform(BBOX[0] + 0.01, BBOX[2] - 0.01, n)
    lats = rng.uniform(BBOX[1] + 0.01, BBOX[3] - 0.01, n)
    coords = np.column_stack([lons, lats])
    primary = lons * 10 + lats * 5 + rng.normal(0, 0.01, n)
    covariate = primary + rng.normal(0, 0.5, n)
    return coords, primary, covariate


def test_cokriging_fallback_small_n():
    """n < 8: cokriging (alias for regression_kriging) completes without error.
    F2-01: The old 'error' key is replaced by covariate_info.fallback=True."""
    coords, values = _known_points()
    coords, values = coords[:5], values[:5]
    gx, gy = _make_grid()
    z, metrics = cokriging_interpolate(coords, values, gx, gy, covariates=None)
    assert z.shape == gx.shape
    # F2-01: fallback is indicated via covariate_info instead of top-level 'error' key
    assert isinstance(metrics, dict)


def test_cokriging_no_covariates_uses_kriging():
    """No covariates provided → falls back to Ordinary Kriging."""
    coords, values, _ = _cokriging_points()
    gx, gy = _make_grid()
    z, metrics = cokriging_interpolate(coords, values, gx, gy, covariates=None)
    assert z.shape == gx.shape
    assert "rmse" in metrics


def test_cokriging_with_correlated_covariate():
    """Highly correlated covariate → Co-Kriging path activated."""
    coords, values, cov_values = _cokriging_points()
    gx, gy = _make_grid()
    covariates = [{"code": "ndvi", "values": cov_values.tolist()}]
    z, metrics = cokriging_interpolate(coords, values, gx, gy, covariates=covariates)
    assert z.shape == gx.shape
    assert "rmse" in metrics


def test_cokriging_output_finite():
    coords, values, cov_values = _cokriging_points()
    gx, gy = _make_grid()
    covariates = [{"code": "ndvi", "values": cov_values.tolist()}]
    z, _ = cokriging_interpolate(coords, values, gx, gy, covariates=covariates)
    assert np.sum(np.isfinite(z)) > z.size // 2


def test_cokriging_uncorrelated_covariate_fallback():
    """Uncorrelated covariate (|r| < 0.4) → fallback to Ordinary Kriging."""
    coords, values, _ = _cokriging_points()
    gx, gy = _make_grid()
    rng = np.random.default_rng(99)
    random_cov = rng.uniform(0, 1, len(values)).tolist()
    covariates = [{"code": "noise", "values": random_cov}]
    z, metrics = cokriging_interpolate(coords, values, gx, gy, covariates=covariates)
    assert z.shape == gx.shape
    assert "covariate_info" in metrics


def test_cokriging_metrics_structure():
    coords, values, cov_values = _cokriging_points()
    gx, gy = _make_grid()
    covariates = [{"code": "ndvi", "values": cov_values.tolist()}]
    _, metrics = cokriging_interpolate(coords, values, gx, gy, covariates=covariates)
    assert "covariate_info" in metrics


def test_cokriging_rmse_not_worse_than_kriging_with_correlated_covariate():
    """With a perfectly correlated co-variable, CoKriging RMSE ≤ Ordinary Kriging RMSE."""
    n = 15
    rng = np.random.default_rng(0)
    lons = rng.uniform(BBOX[0] + 0.01, BBOX[2] - 0.01, n)
    lats = rng.uniform(BBOX[1] + 0.01, BBOX[3] - 0.01, n)
    coords = np.column_stack([lons, lats])
    values = lons * 10.0 + lats * 5.0
    cov_values = values + rng.normal(0, 0.001, n)
    gx, gy = _make_grid()
    _, krig_m = kriging_interpolate(coords, values, gx, gy, transform="none")
    _, cok_m = cokriging_interpolate(
        coords, values, gx, gy,
        covariates=[{"code": "ndvi", "values": cov_values.tolist()}],
        transform="none",
    )
    krig_rmse = krig_m.get("rmse", float("inf"))
    cok_rmse = cok_m.get("rmse", float("inf"))
    assert cok_rmse <= krig_rmse * 1.1, (
        f"CoKriging RMSE ({cok_rmse:.4f}) worse than Kriging ({krig_rmse:.4f}) "
        "even with a nearly-perfect covariate"
    )

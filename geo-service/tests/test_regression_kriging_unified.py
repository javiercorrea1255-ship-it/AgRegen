"""
F2-01 tests: Unified regression_kriging() equivalence with alias functions.

Verifies that:
- glm_interpolate() and cokriging_interpolate() call through to regression_kriging()
  and produce numerically identical results (tolerance ±1e-6).
- regression_kriging() with feature_source='coords' behaves like the original GLM path.
- regression_kriging() with feature_source='external' behaves like the original co-kriging path.
- The unified function accepts all feature_source values: 'coords', 'external', 'both'.
"""
import sys
import os
import pytest
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.interpolation import (
    regression_kriging,
    glm_interpolate,
    cokriging_interpolate,
)
from services.raster import make_grid


POLYGON = [
    [-58.6, -34.0],
    [-58.4, -34.0],
    [-58.4, -34.2],
    [-58.6, -34.2],
    [-58.6, -34.0],
]
N_POINTS = 25
RNG = np.random.default_rng(42)

lons = RNG.uniform(-58.6, -58.4, N_POINTS)
lats = RNG.uniform(-34.2, -34.0, N_POINTS)
vals = 30.0 + 20.0 * lons + 15.0 * lats + RNG.normal(0, 2, N_POINTS)

COORDS = np.column_stack([lons, lats])
BBOX = (-58.6, -34.2, -58.4, -34.0)
GRID_X, GRID_Y = make_grid(BBOX, 40)


class TestRegressionKrigingUnified:
    def test_glm_alias_calls_regression_kriging(self):
        """glm_interpolate is a thin alias for regression_kriging(feature_source='coords')."""
        z_glm, metrics_glm = glm_interpolate(COORDS, vals, GRID_X, GRID_Y, degree=2, transform="none")
        z_rk, metrics_rk = regression_kriging(
            COORDS, vals, GRID_X, GRID_Y,
            feature_source="coords",
            degree=2,
            transform="none",
        )
        assert z_glm.shape == z_rk.shape, "Output shapes must match"
        np.testing.assert_allclose(z_glm, z_rk, atol=1e-6, err_msg="glm alias ≠ regression_kriging(coords)")

    def test_cokriging_alias_calls_regression_kriging(self):
        """cokriging_interpolate is a thin alias for regression_kriging(feature_source='external')."""
        covariate_values = RNG.uniform(0, 1, N_POINTS).tolist()
        covariates = [{"code": "ndvi", "values": covariate_values}]

        z_ck, metrics_ck = cokriging_interpolate(
            COORDS, vals, GRID_X, GRID_Y,
            covariates=covariates,
            transform="none",
        )
        z_rk, metrics_rk = regression_kriging(
            COORDS, vals, GRID_X, GRID_Y,
            feature_source="external",
            external_covariates=covariates,
            transform="none",
        )
        assert z_ck.shape == z_rk.shape, "Output shapes must match"
        np.testing.assert_allclose(z_ck, z_rk, atol=1e-6, err_msg="cokriging alias ≠ regression_kriging(external)")

    def test_feature_source_coords(self):
        """feature_source='coords' uses polynomial coordinate features."""
        z, metrics = regression_kriging(
            COORDS, vals, GRID_X, GRID_Y,
            feature_source="coords",
            transform="none",
        )
        assert z.shape == GRID_X.shape
        assert np.isfinite(z).any(), "Output should have some finite values"

    def test_feature_source_external(self):
        """feature_source='external' uses supplied covariate data."""
        covariates = [{"code": "ph", "values": (vals * 0.1).tolist()}]
        z, metrics = regression_kriging(
            COORDS, vals, GRID_X, GRID_Y,
            feature_source="external",
            external_covariates=covariates,
            transform="none",
        )
        assert z.shape == GRID_X.shape
        assert np.isfinite(z).any()

    def test_feature_source_both(self):
        """feature_source='both' combines coords + external covariates."""
        covariates = [{"code": "k", "values": (vals * 0.5 + 1).tolist()}]
        z, metrics = regression_kriging(
            COORDS, vals, GRID_X, GRID_Y,
            feature_source="both",
            external_covariates=covariates,
            transform="none",
        )
        assert z.shape == GRID_X.shape
        assert np.isfinite(z).any()

    def test_metrics_contain_rmse(self):
        """regression_kriging always returns metrics with rmse key."""
        z, metrics = regression_kriging(COORDS, vals, GRID_X, GRID_Y, transform="none")
        assert isinstance(metrics, dict), "metrics should be a dict"
        assert any(k.lower() in ("rmse", "loocv_rmse") for k in metrics.keys()), (
            f"metrics should contain rmse, got keys: {list(metrics.keys())}"
        )

    def test_p_value_gate_external_low_correlation(self):
        """External covariate with p >= 0.10 should be ignored or handled gracefully."""
        rng2 = np.random.default_rng(99)
        uncorrelated = rng2.uniform(0, 100, N_POINTS).tolist()
        covariates = [{"code": "noise", "values": uncorrelated}]
        # Should not raise; may fall back to coords-only behavior
        z, metrics = regression_kriging(
            COORDS, vals, GRID_X, GRID_Y,
            feature_source="external",
            external_covariates=covariates,
            transform="none",
        )
        assert z.shape == GRID_X.shape

    def test_glm_transform_auto(self):
        """glm_interpolate with transform='auto' should not crash."""
        z, metrics = glm_interpolate(COORDS, vals, GRID_X, GRID_Y, degree=2, transform="auto")
        assert z.shape == GRID_X.shape

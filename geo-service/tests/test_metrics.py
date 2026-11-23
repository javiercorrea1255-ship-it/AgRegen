"""Tests for utils/metrics.py — compute_metrics and loocv_idw."""
import numpy as np
import pytest
from utils.metrics import compute_metrics, loocv_idw


def test_perfect_prediction():
    y = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
    m = compute_metrics(y, y)
    assert m["rmse"] == pytest.approx(0.0, abs=1e-10)
    assert m["mae"] == pytest.approx(0.0, abs=1e-10)
    assert m["r2"] == pytest.approx(1.0, abs=1e-10)
    assert m["me"] == pytest.approx(0.0, abs=1e-10)


def test_constant_error():
    y_true = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
    bias = 2.0
    y_pred = y_true + bias
    m = compute_metrics(y_true, y_pred)
    assert m["rmse"] == pytest.approx(bias, abs=1e-10)
    assert m["mae"] == pytest.approx(bias, abs=1e-10)
    assert m["me"] == pytest.approx(-bias, abs=1e-10)


def test_r2_worse_than_mean():
    y_true = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
    y_pred = np.array([5.0, 4.0, 3.0, 2.0, 1.0])
    m = compute_metrics(y_true, y_pred)
    assert m["r2"] < 0.0


def test_msdr_approaches_unity():
    """MSDR ≈ 1 when mean squared residual ≈ variance of observations."""
    rng = np.random.default_rng(0)
    y_true = rng.normal(10, 2, 50)
    var_true = float(np.var(y_true))
    residuals = rng.normal(0, np.sqrt(var_true), 50)
    y_pred = y_true - residuals
    m = compute_metrics(y_true, y_pred)
    assert m["mse_ratio"] == pytest.approx(1.0, rel=0.5)
    assert "msdr" not in m


def test_constant_observations_r2_zero():
    y_true = np.ones(5) * 3.0
    y_pred = np.array([2.5, 3.0, 3.5, 2.8, 3.2])
    m = compute_metrics(y_true, y_pred)
    assert m["r2"] == 0.0


def test_loocv_idw_returns_dict():
    rng = np.random.default_rng(1)
    coords = rng.uniform(0, 1, (10, 2))
    values = rng.uniform(1, 10, 10)
    result = loocv_idw(coords, values)
    for key in ("rmse", "mae", "r2", "r2_loocv", "me", "mse_ratio"):
        assert key in result
    assert result["rmse"] >= 0.0
    assert result["mae"] >= 0.0

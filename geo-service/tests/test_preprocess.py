"""Tests for interpolation._preprocess_values()."""
import numpy as np
import pytest
from scipy.stats import skew as scipy_skew
from services.interpolation import _preprocess_values


def _make_positive(n=20, seed=0):
    rng = np.random.default_rng(seed)
    return rng.uniform(1.0, 10.0, n)


def test_transform_none_no_change_on_normal_data():
    data = np.array([1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0])
    v, ttype, shift, lam = _preprocess_values(data, force_transform="none")
    assert ttype == "none"
    assert shift == pytest.approx(0.0)
    assert lam == pytest.approx(0.0)
    assert np.allclose(v, data, atol=1e-6)


def test_transform_log1p_positive_values():
    data = np.array([1.0, 2.0, 4.0, 8.0, 16.0, 32.0, 64.0, 128.0, 256.0, 512.0])
    v, ttype, shift, lam = _preprocess_values(data, force_transform="log1p")
    assert ttype == "log1p"
    assert np.all(v > 0)
    assert np.all(np.isfinite(v))


def test_transform_log1p_with_negative_values_adds_shift():
    data = np.array([-5.0, -2.0, 0.0, 1.0, 3.0, 5.0, 7.0, 9.0, 11.0, 13.0])
    v, ttype, shift, lam = _preprocess_values(data, force_transform="log1p")
    assert ttype == "log1p"
    assert shift > 0.0
    assert np.all(v > 0)


def test_transform_sqrt_positive_data():
    data = _make_positive()
    v, ttype, shift, lam = _preprocess_values(data, force_transform="sqrt")
    assert ttype == "sqrt"
    assert shift == pytest.approx(0.0, abs=1e-3)
    assert np.allclose(v, np.sqrt(data), atol=1e-6)


def test_transform_sqrt_negative_data_adds_shift():
    data = np.array([-3.0, -1.0, 0.0, 2.0, 4.0, 6.0, 8.0, 10.0, 12.0, 14.0])
    v, ttype, shift, lam = _preprocess_values(data, force_transform="sqrt")
    assert ttype == "sqrt"
    assert shift > 0.0
    assert np.all(np.isfinite(v))
    assert np.all(v >= 0)


def test_transform_boxcox_returns_lambda():
    data = _make_positive()
    v, ttype, shift, lam = _preprocess_values(data, force_transform="boxcox")
    assert ttype == "boxcox"
    assert isinstance(lam, float)
    assert np.all(np.isfinite(v))


def test_transform_auto_selects_log1p_for_high_skew():
    """Highly right-skewed data (skew >> 1) should trigger log1p."""
    rng = np.random.default_rng(42)
    base = rng.uniform(0.1, 1.0, 50)
    data = np.concatenate([base, [50.0, 80.0, 120.0]])
    skewness = float(scipy_skew(data))
    assert skewness > 1.0, f"Setup error: expected skew>1, got {skewness:.2f}"
    v, ttype, shift, lam = _preprocess_values(data, force_transform="auto")
    assert ttype == "log1p"


def test_transform_auto_none_for_symmetric_data():
    """Near-symmetric data should result in transform=none."""
    rng = np.random.default_rng(7)
    data = rng.normal(50, 5, 40)
    v, ttype, shift, lam = _preprocess_values(data, force_transform="auto")
    assert ttype == "none"


def test_winsorization_clips_to_3iqr_bounds():
    """Winsorization clips at q1−3×IQR and q3+3×IQR exactly."""
    base = np.array([1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0])
    outliers = np.array([100.0, -100.0])
    data = np.concatenate([base, outliers])
    q1 = np.percentile(data, 25)
    q3 = np.percentile(data, 75)
    iqr = q3 - q1
    expected_upper = q3 + 3.0 * iqr
    expected_lower = q1 - 3.0 * iqr
    v, ttype, shift, lam = _preprocess_values(data, force_transform="none")
    assert float(v.max()) == pytest.approx(expected_upper, rel=1e-3)
    assert float(v.min()) == pytest.approx(expected_lower, rel=1e-3)
    assert ttype == "none"

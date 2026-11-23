"""
Tests: zone statistics back-transform correctness.

Verifies that after _back_transform is applied to zone value_mean/min/max,
the returned statistics are in original agronomic units — not in
Box-Cox / log1p / sqrt transformed space.
"""
import sys
import os
import pytest
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.interpolation import _back_transform, _back_transform_std, _preprocess_values


# ── Helpers ───────────────────────────────────────────────────────────────────

def _round3(x: float) -> float:
    return round(float(x), 3)


def back_transform_stat(v: float, ttype: str, shift: float, lam: float) -> float:
    """Apply _back_transform to a single scalar value."""
    arr = _back_transform(np.array([float(v)]), ttype, shift, lam)
    return float(arr[0])


# ── Case 1: No transform (identity) ──────────────────────────────────────────

class TestNoTransform:
    """When transform_type is 'none', back-transform must be a no-op."""

    def test_mean_unchanged(self):
        original_mean = 6.3
        result = back_transform_stat(original_mean, "none", 0.0, 0.0)
        assert abs(result - original_mean) < 1e-9, (
            f"No-transform: expected {original_mean}, got {result}"
        )

    def test_min_max_unchanged(self):
        for v in (2.5, 7.8, 0.0, 100.0):
            result = back_transform_stat(v, "none", 0.0, 0.0)
            assert abs(result - v) < 1e-9, f"No-transform: value {v} changed to {result}"


# ── Case 2: log1p transform ───────────────────────────────────────────────────

class TestLog1pBackTransform:
    """
    log1p forward: z_t = log(x + 1 + shift)
    Back-transform: x = expm1(z_t) - shift  →  original x
    """

    def test_mean_in_original_scale(self):
        original_values = np.array([3.0, 5.0, 7.0, 9.0])
        v, ttype, shift, lam = _preprocess_values(original_values, force_transform="log1p")
        # v is in transformed space; compute mean of transformed values (as create_zones would)
        transformed_mean = float(np.mean(v))
        # Back-transform the zone mean
        recovered = back_transform_stat(transformed_mean, ttype, shift, lam)
        # The recovered mean should be close to the geometric mean of the original
        # (log1p transform → back-transform of mean of logs ≈ geometric mean)
        geom_mean = float(np.exp(np.mean(np.log(original_values + shift + 1))) - 1 - shift)
        # Recovered and geom_mean should agree; also verify it's in original-value range
        assert original_values.min() <= recovered <= original_values.max() + 1e-6, (
            f"log1p back-transform: recovered mean {recovered:.4f} not in "
            f"[{original_values.min()}, {original_values.max()}]"
        )
        assert abs(recovered - geom_mean) < 1e-6, (
            f"log1p back-transform: expected {geom_mean:.6f}, got {recovered:.6f}"
        )

    def test_back_transform_is_expm1_inverse(self):
        """Forward: z = log1p(x), Back: x = expm1(z)."""
        for x in (0.5, 2.0, 5.5, 10.0):
            z = np.log1p(x)
            recovered = back_transform_stat(float(z), "log1p", 0.0, 0.0)
            assert abs(recovered - x) < 1e-9, (
                f"log1p round-trip failed for x={x}: got {recovered}"
            )

    def test_values_in_original_range(self):
        """All original pH values should be recoverable."""
        ph_values = np.array([4.5, 5.0, 6.0, 6.5, 7.0, 7.5])
        v, ttype, shift, lam = _preprocess_values(ph_values, force_transform="log1p")
        for orig, trans in zip(ph_values, v):
            recovered = back_transform_stat(float(trans), ttype, shift, lam)
            assert abs(recovered - orig) < 1e-6, (
                f"pH {orig}: log1p back-transform gave {recovered:.6f}"
            )


# ── Case 3: sqrt transform ────────────────────────────────────────────────────

class TestSqrtBackTransform:
    """
    sqrt forward: z_t = sqrt(x + shift)
    Back-transform: x = z_t² - shift
    """

    def test_round_trip(self):
        for x in (0.0, 1.0, 4.0, 9.0, 25.0):
            z = np.sqrt(x)
            recovered = back_transform_stat(float(z), "sqrt", 0.0, 0.0)
            assert abs(recovered - x) < 1e-9, (
                f"sqrt round-trip failed for x={x}: got {recovered}"
            )

    def test_mean_in_original_range(self):
        values = np.array([10.0, 20.0, 30.0, 40.0])
        v, ttype, shift, lam = _preprocess_values(values, force_transform="sqrt")
        transformed_mean = float(np.mean(v))
        recovered = back_transform_stat(transformed_mean, ttype, shift, lam)
        assert values.min() <= recovered <= values.max() + 1e-6, (
            f"sqrt back-transform: recovered mean {recovered:.4f} not in "
            f"[{values.min()}, {values.max()}]"
        )


# ── Case 4: Box-Cox transform ─────────────────────────────────────────────────

class TestBoxCoxBackTransform:
    """
    Box-Cox with known lambda should round-trip correctly.
    """

    def test_round_trip_with_known_lambda(self):
        from scipy.stats import boxcox
        original = np.array([2.0, 3.0, 4.0, 5.0, 6.0])
        v_boxcox, lam = boxcox(original)
        for orig, trans in zip(original, v_boxcox):
            recovered = back_transform_stat(float(trans), "boxcox", 0.0, float(lam))
            assert abs(recovered - orig) < 1e-6, (
                f"Box-Cox round-trip failed: x={orig}, lambda={lam:.4f}, got {recovered:.6f}"
            )

    def test_zone_mean_in_original_range(self):
        """Back-transformed zone mean must lie within original data range."""
        ph = np.array([5.5, 6.0, 6.5, 7.0, 7.5])
        v, ttype, shift, lam = _preprocess_values(ph, force_transform="boxcox")
        transformed_mean = float(np.mean(v))
        recovered = back_transform_stat(transformed_mean, ttype, shift, lam)
        assert ph.min() - 0.1 <= recovered <= ph.max() + 0.1, (
            f"Box-Cox zone mean {recovered:.4f} outside original range "
            f"[{ph.min()}, {ph.max()}]"
        )


# ── Case 5: Verify create_zones output bug is addressed ───────────────────────

class TestZoneStatsNotInTransformedSpace:
    """
    Regression test: zone statistics must NOT be in Box-Cox space when
    the back-transform loop is applied.
    After back-transform, value_mean for a pH dataset should be near the
    geometric/original mean — not a Box-Cox-space value like 0.8.
    """

    def test_ph_zone_mean_plausible(self):
        """
        Simulate what the router does: interpolate → create fake zone features
        in transformed space → apply back-transform → check units.
        """
        ph_values = np.array([5.2, 5.8, 6.1, 6.5, 6.9, 7.2])
        v, ttype, shift, lam = _preprocess_values(ph_values, force_transform="auto")

        # Simulated zone feature as returned by create_zones (values in transformed space)
        fake_feat = {
            "value_mean": float(np.mean(v)),
            "value_min": float(np.min(v)),
            "value_max": float(np.max(v)),
        }

        # Apply back-transform (mirrors the fix in routers/interpolation.py)
        for stat_key in ("value_mean", "value_min", "value_max"):
            raw_val = fake_feat[stat_key]
            bt = _back_transform(np.array([raw_val]), ttype, shift, lam)
            fake_feat[stat_key] = float(bt[0])

        # After back-transform, all values should be in original pH range
        assert 5.0 <= fake_feat["value_mean"] <= 7.5, (
            f"Zone mean {fake_feat['value_mean']:.4f} not in pH range [5.0, 7.5]; "
            "back-transform may not have been applied."
        )
        assert 5.0 <= fake_feat["value_min"] <= 7.5, (
            f"Zone min {fake_feat['value_min']:.4f} not in pH range"
        )
        assert 5.0 <= fake_feat["value_max"] <= 7.5, (
            f"Zone max {fake_feat['value_max']:.4f} not in pH range"
        )
        # value_min ≤ value_mean ≤ value_max
        assert fake_feat["value_min"] <= fake_feat["value_mean"] <= fake_feat["value_max"], (
            "Zone stats ordering violated after back-transform"
        )


# ── Case 6: _back_transform_std — delta method ────────────────────────────────

class TestBackTransformStd:
    """
    Verifies that _back_transform_std returns a standard deviation in original
    (agronomic) units using the delta method: σ_orig ≈ σ_t × |f⁻¹'(mean_t)|.
    """

    def test_none_transform_returns_std_unchanged(self):
        """Identity transform: σ_orig must equal σ_t exactly."""
        assert _back_transform_std(0.1, 5.0, "none", 0.0, 0.0) == pytest.approx(0.1)
        assert _back_transform_std(2.5, 100.0, "none", 0.0, 0.0) == pytest.approx(2.5)

    def test_zero_std_returns_zero(self):
        """A zone with zero variability stays zero regardless of transform."""
        for ttype in ("none", "log1p", "sqrt", "boxcox"):
            result = _back_transform_std(0.0, 1.0, ttype, 0.0, 0.5)
            assert result == 0.0, f"Expected 0 for transform '{ttype}', got {result}"

    def test_log1p_derivative_is_exp(self):
        """For log1p: σ_orig = σ_t × exp(mean_t)."""
        std_t = 0.05
        mean_t = 1.8
        expected = std_t * np.exp(mean_t)
        result = _back_transform_std(std_t, mean_t, "log1p", 0.0, 0.0)
        assert result == pytest.approx(expected, rel=1e-9), (
            f"log1p std back-transform: expected {expected:.6f}, got {result:.6f}"
        )

    def test_log1p_std_larger_than_transformed(self):
        """For mean_t > 0 the original-space std should be larger than transformed std."""
        result = _back_transform_std(0.04, 1.5, "log1p", 0.0, 0.0)
        assert result > 0.04, f"log1p should amplify std; got {result}"

    def test_sqrt_derivative_is_2z(self):
        """For sqrt: σ_orig = σ_t × 2 × mean_t (mean_t is the sqrt-space mean)."""
        std_t = 0.3
        mean_t = 2.5
        expected = std_t * 2.0 * mean_t
        result = _back_transform_std(std_t, mean_t, "sqrt", 0.0, 0.0)
        assert result == pytest.approx(expected, rel=1e-9), (
            f"sqrt std back-transform: expected {expected:.6f}, got {result:.6f}"
        )

    def test_sqrt_zero_mean_gives_zero_std(self):
        """At mean_t=0 the sqrt derivative is 0, so σ_orig = 0."""
        result = _back_transform_std(1.0, 0.0, "sqrt", 0.0, 0.0)
        assert result == pytest.approx(0.0), f"sqrt std at mean=0 should be 0, got {result}"

    def test_boxcox_numerical_derivative_positive(self):
        """Box-Cox back-transformed std must be strictly positive for positive std_t."""
        from scipy.stats import boxcox as scipy_boxcox
        original = np.array([5.0, 6.0, 7.0, 8.0, 9.0])
        v_t, lam = scipy_boxcox(original)
        mean_t = float(np.mean(v_t))
        std_t = float(np.std(v_t))
        result = _back_transform_std(std_t, mean_t, "boxcox", 0.0, float(lam))
        assert result > 0.0, f"Box-Cox std back-transform must be positive, got {result}"

    def test_boxcox_std_order_of_magnitude_reasonable(self):
        """Box-Cox σ_orig should be in the same order of magnitude as the original data spread."""
        from scipy.stats import boxcox as scipy_boxcox
        original = np.array([5.0, 6.0, 7.0, 8.0, 9.0])
        orig_std = float(np.std(original))
        v_t, lam = scipy_boxcox(original)
        mean_t = float(np.mean(v_t))
        std_t = float(np.std(v_t))
        result = _back_transform_std(std_t, mean_t, "boxcox", 0.0, float(lam))
        assert 0.1 * orig_std <= result <= 10.0 * orig_std, (
            f"Box-Cox σ_orig={result:.4f} is implausible vs original σ={orig_std:.4f}"
        )

    def test_delta_method_consistency_log1p(self):
        """
        Cross-check: the delta method approximation should closely match the
        empirical std computed directly on back-transformed values, when the
        distribution is tight enough that linearity holds.
        """
        original = np.array([6.0, 6.2, 6.4, 6.6, 6.8])
        v_t, ttype, shift, lam = _preprocess_values(original, force_transform="log1p")
        mean_t = float(np.mean(v_t))
        std_t = float(np.std(v_t))
        # Empirical back-transformed std
        bt_vals = np.expm1(v_t) - shift
        empirical_std = float(np.std(bt_vals))
        # Delta method estimate
        delta_std = _back_transform_std(std_t, mean_t, ttype, shift, lam)
        # Should agree within 20% for a tight distribution
        assert abs(delta_std - empirical_std) / (empirical_std + 1e-12) < 0.20, (
            f"Delta method log1p: estimated {delta_std:.4f}, empirical {empirical_std:.4f}"
        )

    def test_result_is_nonnegative(self):
        """Results are always non-negative regardless of inputs."""
        for ttype, shift, lam in [
            ("log1p", 0.0, 0.0),
            ("sqrt", 0.0, 0.0),
            ("boxcox", 0.0, 0.5),
            ("none", 0.0, 0.0),
        ]:
            for std_t in (0.01, 0.5, 2.0):
                for mean_t in (0.5, 1.5, 3.0):
                    result = _back_transform_std(std_t, mean_t, ttype, shift, lam)
                    assert result >= 0.0, (
                        f"{ttype}: std={std_t}, mean_t={mean_t} → {result} (negative)"
                    )

    def test_std_smaller_than_range(self):
        """
        After back-transform, the std in original units should be smaller than
        the min-max range of the original data (basic plausibility check).
        """
        ph = np.array([5.5, 6.0, 6.2, 6.8, 7.0])
        v, ttype, shift, lam = _preprocess_values(ph, force_transform="log1p")
        mean_t = float(np.mean(v))
        std_t = float(np.std(v))
        std_orig = _back_transform_std(std_t, mean_t, ttype, shift, lam)
        original_range = float(ph.max() - ph.min())
        assert std_orig <= original_range + 0.1, (
            f"std_orig {std_orig:.4f} > data range {original_range:.4f}"
        )

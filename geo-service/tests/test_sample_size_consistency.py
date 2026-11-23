"""Tests for F1-03: Unified sample-size formulas with agronomic priors."""
import pytest
from services.grid_generator import optimal_sample_size, VARIABLE_PRIORS

POLYGON_1HA = [
    [-60.0000, -34.0000],
    [-60.0095, -34.0000],
    [-60.0095, -34.0090],
    [-60.0000, -34.0090],
]

POLYGON_10HA = [
    [-60.0000, -34.0000],
    [-60.0300, -34.0000],
    [-60.0300, -34.0285],
    [-60.0000, -34.0285],
]


def test_returns_required_keys():
    result = optimal_sample_size(POLYGON_1HA)
    for key in ("n_cochran", "n_fao", "n_cressie_wikle", "n_optimal"):
        assert key in result, f"Missing key '{key}'"


def test_n_optimal_is_positive_integer():
    result = optimal_sample_size(POLYGON_1HA)
    assert isinstance(result["n_optimal"], int)
    assert result["n_optimal"] >= 1


def test_prior_variables_ph_less_than_p():
    """pH (low CV) should yield ≤ samples than P (high CV) at same polygon."""
    n_ph = optimal_sample_size(POLYGON_10HA, variable_code="pH")["n_optimal"]
    n_p = optimal_sample_size(POLYGON_10HA, variable_code="P")["n_optimal"]
    assert n_ph <= n_p, f"pH ({n_ph}) should need ≤ samples than P ({n_p})"


def test_confidence_99_geq_90():
    """99% confidence level should require ≥ samples than 90%."""
    n_90 = optimal_sample_size(POLYGON_10HA, confidence_level=90)["n_optimal"]
    n_99 = optimal_sample_size(POLYGON_10HA, confidence_level=99)["n_optimal"]
    assert n_99 >= n_90


def test_larger_polygon_needs_more_samples():
    """10 ha polygon should require ≥ samples than 1 ha."""
    n_1ha = optimal_sample_size(POLYGON_1HA)["n_optimal"]
    n_10ha = optimal_sample_size(POLYGON_10HA)["n_optimal"]
    assert n_10ha >= n_1ha


def test_all_prior_codes_work():
    """All variable codes in VARIABLE_PRIORS should produce n_optimal >= 1."""
    for code in VARIABLE_PRIORS:
        result = optimal_sample_size(POLYGON_10HA, variable_code=code)
        assert result["n_optimal"] >= 1, f"variable_code={code} returned 0"


def test_unknown_variable_code_falls_back():
    """Unknown variable_code should fall back to defaults."""
    result = optimal_sample_size(POLYGON_10HA, variable_code="UNKNOWN_XYZ")
    assert result["n_optimal"] >= 1


def test_area_ha_in_result():
    """Result must contain area_ha computed from the polygon."""
    result = optimal_sample_size(POLYGON_1HA)
    assert "area_ha" in result
    assert result["area_ha"] > 0

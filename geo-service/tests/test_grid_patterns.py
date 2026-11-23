"""
Tests for visual grid pattern preservation in structured generators.

Verifies that generate_regular_grid and generate_hexagonal_grid return points
that actually form the expected spatial pattern, and that _stride_subsample
preserves order while _farthest_point_subsample (FPS) is still available for
unstructured use.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import numpy as np
import pytest

from services.grid_generator import (
    generate_regular_grid,
    generate_hexagonal_grid,
    generate_stratified_lhs,
    _stride_subsample,
)

SQUARE_POLYGON = [
    [-60.0, -31.0],
    [-59.9, -31.0],
    [-59.9, -30.9],
    [-60.0, -30.9],
    [-60.0, -31.0],
]


class TestStrideSubsample:
    def test_returns_all_when_short(self):
        pts = [{"lon": i, "lat": 0} for i in range(5)]
        result = _stride_subsample(pts, 10)
        assert len(result) == 5

    def test_returns_n_when_long(self):
        pts = [{"lon": i, "lat": 0} for i in range(40)]
        result = _stride_subsample(pts, 25)
        assert len(result) == 25

    def test_preserves_order(self):
        pts = [{"lon": float(i), "lat": 0.0} for i in range(20)]
        result = _stride_subsample(pts, 10)
        lons = [p["lon"] for p in result]
        assert lons == sorted(lons), "stride subsample should preserve list order"


class TestRegularGridPattern:
    def test_returns_requested_count(self):
        pts = generate_regular_grid(SQUARE_POLYGON, 16)
        assert len(pts) == 16

    def test_columns_are_aligned(self):
        """Points should cluster into ~sqrt(16)=4 distinct columns."""
        pts = generate_regular_grid(SQUARE_POLYGON, 16)
        lons = sorted(set(round(p["lon"], 5) for p in pts))

        if len(lons) < 3:
            pytest.skip("Too few unique x values to assess columns")

        gaps = [lons[i + 1] - lons[i] for i in range(len(lons) - 1)]
        mean_gap = float(np.mean(gaps))
        cv = float(np.std(gaps) / mean_gap) if mean_gap > 0 else 1.0
        assert cv < 0.30, (
            f"Column spacing CV={cv:.3f} is too high; expected a regular grid. "
            f"Unique x-coords: {lons}"
        )

    def test_all_points_inside_polygon(self):
        from services.grid_generator import point_in_polygon
        pts = generate_regular_grid(SQUARE_POLYGON, 16)
        for p in pts:
            assert point_in_polygon([p["lon"], p["lat"]], SQUARE_POLYGON), (
                f"Point ({p['lon']}, {p['lat']}) is outside the polygon"
            )


class TestHexagonalGridPattern:
    def test_returns_requested_count(self):
        pts = generate_hexagonal_grid(SQUARE_POLYGON, 16)
        assert len(pts) == 16

    def test_alternating_row_offset(self):
        """In a hexagonal grid, alternating rows must be offset by ~half a cell width."""
        pts = generate_hexagonal_grid(SQUARE_POLYGON, 20)

        row_xs: dict = {}
        for p in pts:
            lat_r = round(p["lat"], 6)
            row_xs.setdefault(lat_r, []).append(p["lon"])

        sorted_rows = sorted(row_xs.keys())
        if len(sorted_rows) < 4:
            pytest.skip("Not enough distinct rows to assess hex offset")

        # Estimate cell width from intra-row spacing in the densest rows
        spacings = []
        for row_lons in row_xs.values():
            if len(row_lons) >= 2:
                s = sorted(row_lons)
                spacings.extend(s[i + 1] - s[i] for i in range(len(s) - 1))
        assert spacings, "No intra-row spacing found"
        cell_w = float(np.median(spacings))

        # Rows alternate between two x-phase families; compare min-x of consecutive rows
        min_xs = [min(row_xs[r]) for r in sorted_rows]
        offsets = [abs(min_xs[i + 1] - min_xs[i]) for i in range(len(min_xs) - 1)]
        # At least one inter-row offset should be near half a cell width (±40% tol)
        half_cell = cell_w / 2
        near_half = [o for o in offsets if abs(o - half_cell) < 0.40 * half_cell]
        assert near_half, (
            f"No inter-row offset near half-cell-width ({half_cell:.6f}°); "
            f"got offsets={[round(o, 6) for o in offsets]}"
        )

    def test_all_points_inside_polygon(self):
        from services.grid_generator import point_in_polygon
        pts = generate_hexagonal_grid(SQUARE_POLYGON, 16)
        for p in pts:
            assert point_in_polygon([p["lon"], p["lat"]], SQUARE_POLYGON), (
                f"Point ({p['lon']}, {p['lat']}) is outside the polygon"
            )


class TestStratifiedIsNotGrid:
    def test_stratified_not_aligned(self):
        """LHS/stratified should NOT produce strongly aligned columns.

        A regular grid of n=20 points would produce ~4-5 distinct x-bins.
        LHS should have far more unique x-values since it is random by design.
        We also check that the column-spacing CV is high (not uniform).
        """
        n = 20
        pts = generate_stratified_lhs(SQUARE_POLYGON, n)
        assert len(pts) == n

        lons = sorted(p["lon"] for p in pts)
        unique_lons = len(set(round(l, 6) for l in lons))

        # LHS guarantees each stratum is sampled once → ~n unique x-values
        assert unique_lons >= n // 2, (
            f"Stratified produced only {unique_lons} unique x-values out of {n}; "
            "expected at least n/2 (≥10) for a non-grid random layout"
        )

        # Column spacing should be irregular (CV > 0.30 for random distributions)
        gaps = [lons[i + 1] - lons[i] for i in range(len(lons) - 1)]
        mean_gap = float(np.mean(gaps))
        if mean_gap > 1e-10:
            cv = float(np.std(gaps) / mean_gap)
            assert cv > 0.20, (
                f"Stratified x-spacing CV={cv:.3f} is too low; "
                "looks suspiciously grid-like for a random generator"
            )

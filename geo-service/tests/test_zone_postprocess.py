"""
F2-05 tests: zone_postprocess.py — mode_filter + remove_tiny_zones.

Verifies:
- 3 isolated pixels surrounded by a different label → removed (absorbed into neighbor) by mode_filter.
- Zones with area < min_zone_area_ha are relabeled to the most frequent neighbor label.
- postprocess_zones is idempotent on already-clean inputs.
- mode_filter=False skips spatial smoothing.
"""
import sys
import os
import pytest
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.zone_postprocess import postprocess_zones


METERS_PER_DEG = 111_320.0


def ha_to_cell_size_m(target_ha: float, n_pixels: int) -> float:
    """Return cell_size_m (metres/pixel) such that n_pixels cells == target_ha."""
    area_m2 = target_ha * 10_000.0
    return float(np.sqrt(area_m2 / n_pixels))


class TestModeFilter:
    def test_isolated_pixel_absorbed(self):
        """
        A single isolated pixel (zone 1) surrounded by zone 0 should be absorbed into zone 0
        after the 3×3 mode filter.
        """
        labels = np.zeros((9, 9), dtype=int)
        labels[4, 4] = 1  # one isolated pixel

        result = postprocess_zones(
            labels,
            cell_size_m=50.0,
            n_zones=2,
            min_zone_area_ha=0.0,
            apply_mode_filter=True,
        )
        assert result[4, 4] == 0, "Isolated pixel should be absorbed by 3×3 mode filter"

    def test_three_isolated_pixels_absorbed(self):
        """
        Three isolated pixels (zone 1) each surrounded by zone 0 should all be removed.
        """
        labels = np.zeros((15, 15), dtype=int)
        labels[2, 2] = 1
        labels[7, 7] = 1
        labels[12, 12] = 1

        result = postprocess_zones(
            labels,
            cell_size_m=50.0,
            n_zones=2,
            min_zone_area_ha=0.0,
            apply_mode_filter=True,
        )
        assert result[2, 2] == 0, "Isolated pixel at (2,2) should be absorbed"
        assert result[7, 7] == 0, "Isolated pixel at (7,7) should be absorbed"
        assert result[12, 12] == 0, "Isolated pixel at (12,12) should be absorbed"

    def test_large_region_not_absorbed(self):
        """
        A large contiguous region should NOT be absorbed by the mode filter.
        """
        labels = np.zeros((20, 20), dtype=int)
        labels[5:15, 5:15] = 1  # 10×10 block = 100 cells

        result = postprocess_zones(
            labels,
            cell_size_m=50.0,
            n_zones=2,
            min_zone_area_ha=0.0,
            apply_mode_filter=True,
        )
        # Core interior pixels (far from edges) should remain zone 1
        assert result[10, 10] == 1, "Interior of large region should not be absorbed"

    def test_mode_filter_disabled(self):
        """
        When apply_mode_filter=False, isolated pixels should be left untouched
        (provided the zone is not below min_zone_area_ha).
        """
        labels = np.zeros((9, 9), dtype=int)
        labels[4, 4] = 1  # 1 pixel

        # Set cell_size such that 1 pixel is well above min_zone_area_ha
        # e.g. 1 pixel = 1 ha → cell_size_m = 100m, min=0.0001 ha
        result = postprocess_zones(
            labels,
            cell_size_m=100.0,
            n_zones=2,
            min_zone_area_ha=0.0,
            apply_mode_filter=False,
        )
        assert result[4, 4] == 1, "With mode_filter=False, pixel should remain as-is"


class TestRemoveTinyZones:
    def test_tiny_zone_below_threshold_absorbed(self):
        """
        A zone of ~0.1 ha with min_zone_area_ha=0.25 should be relabeled to the dominant neighbor.
        """
        labels = np.zeros((20, 20), dtype=int)
        labels[0:3, 0:3] = 1  # 9 cells ≈ 0.1 ha with cell_size_m≈33m

        cell_size_m = ha_to_cell_size_m(0.1, 9)  # 9 cells = 0.1 ha

        result = postprocess_zones(
            labels,
            cell_size_m=cell_size_m,
            n_zones=2,
            min_zone_area_ha=0.25,
            apply_mode_filter=False,
        )
        # The small 0.1 ha region should be absorbed into zone 0
        assert result[1, 1] == 0, "Zone smaller than 0.25 ha should be relabeled to neighbor"

    def test_adequate_zone_preserved(self):
        """
        A zone of 0.5 ha (above 0.25 ha threshold) should be preserved.
        """
        labels = np.zeros((20, 20), dtype=int)
        labels[5:15, 5:15] = 1  # 100 cells

        cell_size_m = ha_to_cell_size_m(0.5, 100)  # 100 cells = 0.5 ha

        result = postprocess_zones(
            labels,
            cell_size_m=cell_size_m,
            n_zones=2,
            min_zone_area_ha=0.25,
            apply_mode_filter=False,
        )
        assert result[10, 10] == 1, "Zone larger than 0.25 ha should be preserved"

    def test_idempotent_on_clean_grid(self):
        """
        postprocess_zones is idempotent: applying it twice gives the same result.
        """
        labels = np.zeros((20, 20), dtype=int)
        labels[5:15, 5:15] = 1

        cell_size_m = ha_to_cell_size_m(0.5, 100)

        first_pass = postprocess_zones(
            labels,
            cell_size_m=cell_size_m,
            n_zones=2,
            min_zone_area_ha=0.1,
            apply_mode_filter=True,
        )
        second_pass = postprocess_zones(
            first_pass,
            cell_size_m=cell_size_m,
            n_zones=2,
            min_zone_area_ha=0.1,
            apply_mode_filter=True,
        )
        np.testing.assert_array_equal(
            first_pass, second_pass,
            err_msg="postprocess_zones should be idempotent",
        )

    def test_all_same_label_no_crash(self):
        """
        Grid with a single label (no boundaries) should not crash.
        """
        labels = np.zeros((10, 10), dtype=int)
        result = postprocess_zones(
            labels,
            cell_size_m=50.0,
            n_zones=1,
            min_zone_area_ha=0.25,
            apply_mode_filter=True,
        )
        assert result.shape == labels.shape
        assert np.all(result == 0)

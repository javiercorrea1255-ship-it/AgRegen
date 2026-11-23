"""F2-05 — Zone post-processing: mode filter + minimum area removal.

Audit reference: AgRegen MVZ v3.1.1 §H-10.
Filters out salt-and-pepper noise (isolated pixels) and removes small
management zones that precision equipment cannot handle (< min_zone_area_ha).
"""

import numpy as np
from scipy.ndimage import generic_filter
from scipy.ndimage import label as cc_label


def mode_filter(labels: np.ndarray, size: int = 3) -> np.ndarray:
    """Mode filter: each pixel takes the majority value in a size×size window.

    Uses scipy.ndimage.generic_filter which handles borders with 'nearest'
    padding. Works on any integer label array including -1 (invalid/NoData).
    """
    def most_common(window: np.ndarray) -> float:
        vals, counts = np.unique(window, return_counts=True)
        return float(vals[np.argmax(counts)])

    return generic_filter(labels.astype(float), most_common, size=size, mode="nearest").astype(int)


def remove_tiny_zones(
    labels: np.ndarray,
    min_area_pixels: int,
    n_zones: int,
) -> np.ndarray:
    """Absorb connected components smaller than min_area_pixels into the
    adjacent majority zone.

    Uses scipy.ndimage for connected-component labelling (binary structuring
    element = 4-connectivity). scikit-image is NOT required.

    Parameters
    ----------
    labels : 2-D integer array (rows × cols). -1 = NoData.
    min_area_pixels : minimum component size to keep (in pixels).
    n_zones : total number of zones (0 … n_zones-1).
    """
    out = labels.copy()
    for z in range(n_zones):
        mask = (out == z)
        labeled, n_components = cc_label(mask)
        for c in range(1, n_components + 1):
            comp = labeled == c
            if comp.sum() < min_area_pixels:
                # Dilate the component by 1 pixel to find neighbours
                from scipy.ndimage import binary_dilation
                dilated = binary_dilation(comp, iterations=1) & ~comp
                neighbour_vals = out[dilated]
                neighbour_vals = neighbour_vals[neighbour_vals != z]
                neighbour_vals = neighbour_vals[neighbour_vals >= 0]
                if len(neighbour_vals) > 0:
                    vals, counts = np.unique(neighbour_vals, return_counts=True)
                    out[comp] = int(vals[np.argmax(counts)])
    return out


def postprocess_zones(
    labels: np.ndarray,
    cell_size_m: float,
    n_zones: int,
    min_zone_area_ha: float = 0.25,
    mode_filter_size: int = 3,
    apply_mode_filter: bool = True,
) -> np.ndarray:
    """Full post-processing pipeline: optional mode filter + small-zone removal.

    Parameters
    ----------
    labels : 2-D integer label array. -1 = NoData / outside polygon.
    cell_size_m : spatial resolution in metres per pixel.
    n_zones : number of zones (0 … n_zones-1).
    min_zone_area_ha : minimum operable zone area in hectares (default 0.25 ha).
                       Agronómic rule: A_min = 2 × w² where w = machine width.
                       For 24-m boom → 0.12 ha; conservative default = 0.25 ha.
    mode_filter_size : kernel size for mode filter (3 or 5).
    apply_mode_filter : set False to skip mode filtering.
    """
    if apply_mode_filter:
        labels = mode_filter(labels, size=mode_filter_size)

    min_pixels = int(np.ceil(min_zone_area_ha * 10_000.0 / (cell_size_m ** 2)))
    return remove_tiny_zones(labels, min_pixels, n_zones)

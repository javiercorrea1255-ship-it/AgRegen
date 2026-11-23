"""Independent spherical random field, fixed a priori seed 2026 (not tuned).

Circulant embedding on a 512 m periodic lattice with compact 120 m covariance.
The 300 m crop has no wrap-around correlations (512-300 > 120).
Fixture generation is excluded from endpoint response-time measurements.
"""
import time
import numpy as np
import pytest
from scipy.interpolate import RegularGridInterpolator
from shapely.geometry import Polygon
from shapely.ops import transform
from pyproj import Transformer
from routers.interpolation import InterpolateRequest, handle_interpolate
from services.interpolation import idw_interpolate, kriging_interpolate, svr_interpolate
from services.variogram import fit_variogram
from services.raster import make_grid


@pytest.fixture(scope="module")
def field():
    rng = np.random.default_rng(2026)
    size = 512
    distances = np.minimum(np.arange(size), size - np.arange(size))
    dx, dy = np.meshgrid(distances, distances)
    ratio = np.hypot(dx, dy) / 120
    covariance = .25 * np.where(ratio < 1, 1 - 1.5 * ratio + .5 * ratio ** 3, 0.)
    spectrum = np.maximum(np.fft.fft2(covariance).real, 0)
    surface = np.fft.ifft2(np.sqrt(spectrum) * np.fft.fft2(rng.normal(size=(size, size)))).real
    truth_interpolator = RegularGridInterpolator((np.arange(size), np.arange(size)), surface)
    def truth(xy):
        return 2.2 + .6 * xy[:, 0] / 300 + truth_interpolator(xy[:, ::-1])
    x, y = np.meshgrid(np.linspace(25, 275, 6), np.linspace(25, 275, 6))
    samples = np.column_stack([x.ravel(), y.ravel()]) + rng.uniform(-10, 10, (36, 2))
    values = truth(samples) + rng.normal(0, .05, 36)
    validation = rng.uniform(0, 300, (500, 2))
    to_wgs = Transformer.from_crs(32614, 4326, always_xy=True)
    def wgs(xy):
        return np.column_stack(to_wgs.transform(xy[:, 0] + 500_000, xy[:, 1] + 2_200_000))
    coords, queries = wgs(samples), wgs(validation)
    polygon = wgs(np.array([[0, 0], [300, 0], [300, 300], [0, 300]])).tolist()
    return dict(coords=coords, values=values, queries=queries, truth=truth(validation),
                polygon=polygon, truth_fn=truth, wgs=wgs, samples=samples)


def request(field, method="kriging", **overrides):
    payload = dict(points=[dict(lon=x, lat=y, value=float(v)) for (x, y), v in zip(field["coords"], field["values"])],
                   polygon=field["polygon"], method=method, transform="none", resolution=80)
    payload.update(overrides)
    return InterpolateRequest(**payload)


@pytest.mark.parametrize("method,bound", [("kriging", .39), ("idw", .40), ("svr", .41)])
def test_known_truth(field, method, bound):
    fun = dict(kriging=kriging_interpolate, idw=idw_interpolate, svr=svr_interpolate)[method]
    q = field["queries"]
    z, metrics = fun(field["coords"], field["values"], q[:, 0].reshape(1, -1), q[:, 1].reshape(1, -1), transform="none")
    rmse = float(np.sqrt(np.mean((z.ravel() - field["truth"]) ** 2)))
    print(f"\n{method}: truth RMSE={rmse:.6f}; grid std={np.std(z):.6f}; metrics={metrics.get('kriging_msdr')}; params={metrics.get('params')}")
    assert rmse <= bound
    if method == "kriging":
        assert .7 <= metrics["msdr"] <= 1.4
        assert metrics["variogram"]["status"] == "fitted"
        fit, info = fit_variogram(field["samples"], field["values"], "spherical")
        print("spherical fit:", fit)
        assert info["status"] == "fitted"
        assert 60 <= fit["range"] <= 250
    if method == "svr":
        assert np.std(z) >= .2
        assert metrics["params"]["method"] == "svr"
        raster_result = handle_interpolate(request(field, "svr"))
        print("SVR raster std (80x80):", raster_result["grid_stats"]["std"])
        assert raster_result["grid_stats"]["std"] >= .2
        assert raster_result["metrics"]["params"]["method"] == "svr"


def test_coverage_and_latency(field):
    start = time.perf_counter()
    result = handle_interpolate(request(field))
    elapsed = time.perf_counter() - start
    print("\nendpoint seconds:", elapsed)
    assert elapsed < 6
    grid = np.array(result["grid_values"], dtype=float)
    assert np.isfinite(grid).all()
    assert sum(z["area_ha"] for z in result["zones"]) == pytest.approx(9., rel=.005)
    assert all(b["n_pairs"] >= 30 for b in result["metrics"]["variogram"]["empirical"])
    assert result["metrics"]["variogram"]["fit_status"] == "ajustado"


@pytest.mark.parametrize("transformation", ["log1p", "boxcox"])
def test_transformed_grid_bias(field, transformation):
    result = handle_interpolate(request(field, transform=transformation))
    bbox = result["raster_bbox"]
    gx, gy = make_grid(tuple(bbox[k] for k in ("minx", "miny", "maxx", "maxy")), 80, cell_centers=True)
    to_utm = Transformer.from_crs(4326, 32614, always_xy=True)
    x, y = to_utm.transform(gx.ravel(), gy.ravel())
    truth = field["truth_fn"](np.column_stack([x - 500_000, y - 2_200_000]))
    grid = np.array(result["grid_values"], dtype=float)
    bias = float(np.nanmean(grid.ravel() - truth))
    print(f"\n{transformation} grid bias: {bias:.6f}")
    assert abs(bias) <= .1
    assert result["grid_stats"]["mean"] == pytest.approx(np.nanmean(grid), abs=1e-6)
    assert result["grid_scale"] == "original"
    assert result["metrics"]["params"]["bias_correction"] != "none"


def test_exclusion_preserves_cv(field):
    baseline = handle_interpolate(request(field))
    points = request(field).model_dump()["points"]
    far = field["wgs"](np.array([[1300, 1300]]))[0]
    points.append(dict(lon=far[0], lat=far[1], value=500))
    result = handle_interpolate(request(field, points=points))
    assert result["metrics"]["rmse"] == baseline["metrics"]["rmse"]
    assert result["loocv_residuals"][:-1] == baseline["loocv_residuals"]
    assert result["loocv_residuals"][-1]["original_index"] == 36
    assert result["loocv_residuals"][-1]["excluded"]
    assert any(w["code"] == "outside_polygon" and w["indices"] == [36] for w in result["warnings"])


def test_outlier_and_constant(field):
    points = request(field, "idw").model_dump()["points"]
    points[0]["value"] *= 10
    result = handle_interpolate(request(field, "idw", points=points))
    assert any(w["code"] == "outliers" for w in result["warnings"])
    assert not result["near_constant_grid"]
    assert not result["low_variance_warning"]
    for p in points:
        p["value"] = 3.
    result = handle_interpolate(request(field, points=points))
    assert len(result["zones"]) == 1
    assert result["zones"][0]["area_ha"] == pytest.approx(9., rel=.005)


def test_invalid_and_duplicates(field):
    points = request(field, "idw").model_dump()["points"]
    points.insert(3, dict(lon=points[0]["lon"], lat=points[0]["lat"], value=None))
    points.append(dict(points[0]))
    points.append(dict(lon=points[0]["lon"], lat=points[0]["lat"], value="bad"))
    result = handle_interpolate(request(field, "idw", points=points))
    assert result["metrics"]["n_points_excluded"] == 2
    assert result["metrics"]["n_points_used"] == 36
    assert result["metrics"]["n_points_merged"] == 1
    assert [r["original_index"] for r in result["loocv_residuals"]] == list(range(39))
    assert result["loocv_residuals"][3]["excluded"]
    assert result["loocv_residuals"][-1]["excluded"]


def test_kriging_seven_remains_400(field):
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        handle_interpolate(request(field, points=request(field).points[:7]))
    assert exc.value.status_code == 400


def test_mapping_sample_count(field):
    from services.grid_generator import optimal_sample_size
    mapping = optimal_sample_size(field["polygon"], range_m=120)
    mean = optimal_sample_size(field["polygon"], range_m=120, purpose="mean")
    assert mapping["purpose"] == "mapping"
    assert mapping["n_recommended"] >= max(30, mapping["n_cochran"], mapping["n_spatial_mapping"])
    assert mean["n_recommended"] < 30
    assert mapping["mapping_spacing_m"] == 60
    assert optimal_sample_size(field["polygon"], range_m=30)["n_recommended"] >= 400


def test_small_sample_fit_is_explicit_fallback(field):
    params, info = fit_variogram(field["samples"][:14], field["values"][:14], "spherical")
    assert info["fit_status"] == "respaldo"
    assert params["psill"] > 0


def test_rezonify_original_scale_without_double_inverse(field):
    from routers.zones import handle_zonify, ZonifyRequest
    result = handle_interpolate(request(field, "idw", transform="log1p", resolution=20))
    rezoned = handle_zonify(ZonifyRequest(
        grid_values=result["grid_values"], bbox=result["raster_bbox"], polygon=field["polygon"],
        transform_type="none", grid_layout="cell_centers",
    ))
    assert sum(z["area_ha"] for z in rezoned["zones"]) == pytest.approx(9., rel=.005)
    for zone in rezoned["zones"]:
        assert result["grid_stats"]["min"] <= zone["value_mean"] <= result["grid_stats"]["max"]


def test_fractional_cells_cover_concave_parcel(field):
    polygon = field["wgs"](np.array([[0, 0], [300, 0], [300, 140], [160, 140], [160, 300], [0, 300]])).tolist()
    result = handle_interpolate(request(field, "idw", polygon=polygon))
    assert sum(z["area_ha"] for z in result["zones"]) == pytest.approx(6.76, rel=.005)
    from shapely import intersects_xy
    gx, gy = make_grid(tuple(result["raster_bbox"][k] for k in ("minx", "miny", "maxx", "maxy")), 80, cell_centers=True)
    inside = intersects_xy(Polygon(polygon), gx, gy)
    assert np.isfinite(np.array(result["grid_values"], dtype=float)[inside]).all()


def test_solver_fallback_preserves_original_units(field, monkeypatch):
    import services.interpolation as service
    def failing_cv(*args, **kwargs):
        raise RuntimeError("forced CV failure")
    monkeypatch.setattr(service, "_kriging_original_cv", failing_cv)
    result = handle_interpolate(request(field, transform="log1p", resolution=20))
    reference = handle_interpolate(request(field, "idw", transform="log1p", resolution=20))
    assert np.allclose(np.array(result["grid_values"], dtype=float), np.array(reference["grid_values"], dtype=float), equal_nan=True)
    assert any(w["code"] == "interpolation_fallback" for w in result["warnings"])
    assert "msdr" not in result["metrics"]

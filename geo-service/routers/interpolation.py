"""
F2-09: Interpolation router — /interpolate and /variogram-lags endpoints.
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any

from services.grid_generator import generate_grid, optimal_sample_size, adaptive_grid_resolution
from services.interpolation import (
    idw_interpolate, kriging_interpolate,
    rbf_interpolate, glm_interpolate, rfk_interpolate, svr_interpolate,
    interpolate_auto_best,
    _back_transform, _back_transform_std,
)
from services.zonify import create_zones
from services.raster import values_to_png_base64, make_grid
from services.interpolation_input import sanitize_points
from services.variogram import inverse_moments
from routers.shared import (
    SamplingPoint, _safe_error, _validate_polygon_or_400,
    _mask_outside_polygon, _forward_transform, _percentile_bounds,
)
import math
from threadpoolctl import threadpool_limits

def _sanitize_for_json(obj: Any) -> Any:
    """Recursively replace NaN/Inf floats with None so json.dumps never raises."""
    if isinstance(obj, float):
        return None if (math.isnan(obj) or math.isinf(obj)) else obj
    if isinstance(obj, dict):
        return {k: _sanitize_for_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize_for_json(v) for v in obj]
    return obj

router = APIRouter()


class InterpolationPoint(SamplingPoint):
    # Invalid measurements are reported with lineage, not rejected as an opaque 422.
    value: Any = None


class InterpolateRequest(BaseModel):
    points: List[InterpolationPoint] = Field(..., description="Puntos de muestreo con valores medidos")
    method: str = Field(
        default="idw",
        description="idw | kriging",
    )
    polygon: List[List[float]] = Field(..., description="[[lon, lat], ...]")
    resolution: Optional[int] = Field(default=None, ge=20, le=200,
                                       description="F2-03: Grid resolution (None = adaptive based on polygon area and variogram range)")
    n_zones: int = Field(default=3, ge=2, le=8)
    variable_code: Optional[str] = Field(default="default")
    variogram_model: Optional[str] = Field(default="auto")
    power: Optional[float] = Field(default=None, description="IDW power (None = auto)")
    k: Optional[int] = Field(default=None, ge=1, le=30, description="IDW k nearest neighbors (None = auto LOOCV)")
    kriging_range_init: Optional[float] = Field(default=None, gt=0, description="Kriging variogram range init in meters (None = auto data-driven)")
    kriging_sill_init: Optional[float] = Field(default=None, gt=0, description="Kriging variogram sill/psill init (None = auto = sample variance)")
    rbf_kernel: Optional[str] = Field(default="auto")
    rbf_smoothing: Optional[float] = Field(default=None, gt=0, description="RBF smoothing parameter (None = auto 5% of variance)")
    svr_kernel: Optional[str] = Field(default="rbf", description="SVR kernel: rbf | linear | poly")
    svr_C: Optional[float] = Field(default=None, gt=0, description="SVR regularization C (None = auto LOOCV)")
    svr_epsilon: Optional[float] = Field(default=None, gt=0, description="SVR epsilon tube width (None = auto 5% std)")
    zone_method: Optional[str] = Field(default="spatial_kmeans")
    auto_k: Optional[bool] = Field(default=False)
    transform: Optional[str] = Field(
        default="auto",
        description="none | log1p | sqrt | boxcox | auto",
    )
    covariates: Optional[List[Dict[str, Any]]] = Field(
        default=[],
        description='List of {"code": str, "values": [float,...]} — co-variable values at sampling points',
    )


@router.post("/interpolate")
@threadpool_limits.wrap(limits=1)
def handle_interpolate(req: InterpolateRequest):
    """Spatial interpolation + integrated zonification."""
    try:
        _validate_polygon_or_400(req.polygon, context="polygon")

        if req.power is not None and req.power <= 0:
            raise HTTPException(status_code=400, detail="IDW power debe ser > 0")
        if req.k is not None and req.k < 1:
            raise HTTPException(status_code=400, detail="IDW k (vecinos) debe ser ≥ 1")

        _ALLOWED_METHODS = ("idw", "kriging", "rbf", "glm", "rfk", "svr", "auto")
        method_lc = (req.method or "idw").lower()
        if method_lc not in _ALLOWED_METHODS:
            raise HTTPException(
                status_code=400,
                detail=f"Método '{method_lc}' no disponible. Use: {', '.join(_ALLOWED_METHODS)}.",
            )

        coords, vals, groups, excluded, warnings = sanitize_points(req.points, req.polygon)
        n_pts = len(vals)
        _MIN_PTS = {"kriging": 8, "glm": 6, "rfk": 20, "svr": 5, "rbf": 3}
        _min = _MIN_PTS.get(method_lc, 3)
        if n_pts < _min:
            raise HTTPException(
                status_code=400,
                detail=f"{method_lc.upper()} requiere ≥ {_min} puntos ({n_pts} disponibles). Usa IDW para conjuntos pequeños.",
            )

        lons, lats = coords.T
        covariates = [{**c, "values": [float(np.mean([c["values"][i] for i in group])) for group in groups]}
                      for c in (req.covariates or []) if len(c.get("values", [])) == len(req.points)]

        v_mean = float(np.mean(vals))
        v_std = float(np.std(vals))
        v_min_in = float(np.min(vals))
        v_max_in = float(np.max(vals))
        v_range = v_max_in - v_min_in
        cv_pct = (v_std / abs(v_mean) * 100.0) if abs(v_mean) > 1e-6 else float("inf")
        scale_ref = max(abs(v_min_in), abs(v_max_in), 1e-6)
        relative_range = v_range / scale_ref
        q1, q3 = np.percentile(vals, [25, 75])
        iqr = q3 - q1
        outlier_indices = np.flatnonzero((vals < q1 - 3 * iqr) | (vals > q3 + 3 * iqr)).tolist()
        has_outliers = bool(outlier_indices or cv_pct > 100)
        if has_outliers:
            warnings.append({"code": "outliers", "indices": [j for i in outlier_indices for j in groups[i]],
                             "message": f"Valores atípicos (3×IQR) o CV de entrada superior a 100 % (CV={cv_pct:.1f}%). Revisar mediciones."})
        low_variance_warning = None
        if v_range < 1e-9:
            low_variance_warning = (
                f"Todos los puntos tienen el mismo valor ({v_mean:.4f}). "
                "Cualquier método de interpolación devolverá una superficie constante. "
                "Captura mediciones con variabilidad real para obtener un mapa de zonas útil."
            )
        elif not has_outliers and relative_range < 0.02 and cv_pct < 2.0:
            cv_label = f"CV={cv_pct:.2f}%" if not np.isinf(cv_pct) else "CV=∞ (media≈0)"
            low_variance_warning = (
                f"La variabilidad de los datos es muy baja "
                f"({cv_label} · rango={v_range:.4f} · media={v_mean:.4f}). "
                "Todos los métodos de interpolación producirán resultados muy similares "
                "y casi constantes. Esto es matemáticamente correcto: con poca varianza "
                "no hay un patrón espacial que un método pueda captar mejor que otro."
            )

        from services.interpolation import _deg_to_m as _dtm
        _coords_m_check = _dtm(coords)
        _lon_spread = float(np.std(_coords_m_check[:, 0]))
        _lat_spread = float(np.std(_coords_m_check[:, 1]))
        if _lon_spread < 1.0 and _lat_spread < 1.0:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Todos los puntos de muestreo están ubicados en el mismo lugar "
                    f"(dispersión lon={_lon_spread:.2f} m, lat={_lat_spread:.2f} m). "
                    "Asegurá que cada punto tenga coordenadas GPS distintas."
                ),
            )

        minx = min(p[0] for p in req.polygon)
        miny = min(p[1] for p in req.polygon)
        maxx = max(p[0] for p in req.polygon)
        maxy = max(p[1] for p in req.polygon)

        # F2-03: Adaptive resolution when not explicitly provided
        if req.resolution is not None:
            resolution = req.resolution
        else:
            try:
                from services.grid_generator import VARIABLE_PRIORS
                prior = VARIABLE_PRIORS.get(req.variable_code or "default", {})
                range_m = float(prior.get("range_m", 200.0))
            except Exception:
                range_m = 200.0
            resolution, _cell_m = adaptive_grid_resolution(req.polygon, range_m=range_m)
        grid_x, grid_y = make_grid((minx, miny, maxx, maxy), resolution, cell_centers=True)

        method = (req.method or "idw").lower()
        transform = (req.transform or "auto").lower()

        if method == "kriging":
            z, metrics = kriging_interpolate(
                coords, vals, grid_x, grid_y,
                variogram_model=req.variogram_model or "auto",
                transform=transform,
                range_init=req.kriging_range_init,
                sill_init=req.kriging_sill_init,
            )
        elif method == "rbf":
            z, metrics = rbf_interpolate(
                coords, vals, grid_x, grid_y,
                kernel=req.rbf_kernel or "auto",
                transform=transform,
            )
        elif method == "glm":
            z, metrics = glm_interpolate(
                coords, vals, grid_x, grid_y,
                degree=2,
                transform=transform,
            )
        elif method == "rfk":
            z, metrics = rfk_interpolate(
                coords, vals, grid_x, grid_y,
                transform=transform,
            )
        elif method == "svr":
            z, metrics = svr_interpolate(
                coords, vals, grid_x, grid_y,
                kernel=req.svr_kernel or "rbf",
                C=req.svr_C,
                epsilon=req.svr_epsilon,
                transform=transform,
            )
        elif method == "auto":
            z, metrics, method = interpolate_auto_best(
                coords, vals, grid_x, grid_y,
                transform=transform,
                covariates=covariates,
            )
        else:
            # idw (default)
            z, metrics = idw_interpolate(
                coords, vals, grid_x, grid_y,
                power=req.power,
                k=req.k,
                transform=transform,
            )

        _params_early = metrics.get("params", {})
        transform_type = _params_early.get("transform", transform)
        transform_lambda = _params_early.get("transform_lambda")
        transform_shift_val = float(_params_early.get("transform_shift", 0.))
        transform_lambda_val = float(transform_lambda or 0.)
        variance_t = metrics.get("kriging_sigma2_transformed")
        if variance_t is not None:
            z, _ = inverse_moments(z, np.asarray(variance_t), transform_type, transform_shift_val, transform_lambda_val)
        else:
            z = _back_transform(z, transform_type, transform_shift_val, transform_lambda_val)
        metrics["params"]["grid_scale"] = "original"
        if metrics.get("error"):
            warnings.append({"code": "interpolation_fallback", "indices": [], "message": str(metrics["error"])})
        if (metrics.get("variogram") or {}).get("status") == "fallback":
            warnings.append({"code": "variogram_fallback", "indices": [],
                             "message": "Variograma de respaldo: " + str(metrics["variogram"].get("fallback_reason"))})
        z_masked = _mask_outside_polygon(z, grid_x, grid_y, req.polygon, cell_coverage=True)
        finite = z_masked[np.isfinite(z_masked)]
        near_constant_grid = bool(v_range < 1e-9 or (
            len(finite) and (np.std(finite) < .01 * abs(np.mean(finite))
                            or np.ptp(finite) < .02 * v_range)))

        parcel_geom = None
        if len(req.polygon) >= 3:
            try:
                from shapely.geometry import Polygon as ShapelyPolygon
                parcel_geom = ShapelyPolygon(req.polygon)
                if not parcel_geom.is_valid:
                    parcel_geom = parcel_geom.buffer(0)
            except Exception:
                parcel_geom = None

        cell_size = (maxx - minx) / resolution
        zone_labels, zone_features, zone_membership_u = create_zones(
            grid_x, grid_y, z_masked,
            n_zones=1 if near_constant_grid else req.n_zones,
            cell_size_deg=cell_size,
            method=req.zone_method or "spatial_kmeans",
            variable_code=req.variable_code or "default",
            auto_k=False if near_constant_grid else req.auto_k or False,
            parcel_polygon_geom=parcel_geom,
            min_zone_area_ha=0.25,
            apply_mode_filter=True,
        )

        # Zones, statistics, raster and returned cells now share the original scale.
        _valid_grid = z_masked.ravel()
        _valid_grid = _valid_grid[~np.isnan(_valid_grid)]
        grid_std = float(np.std(_valid_grid)) if len(_valid_grid) > 1 else 0.0

        vmin_pct, vmax_pct, _ = _percentile_bounds(z_masked)

        if near_constant_grid:
            if grid_std < 1e-9:
                vmin_png, vmax_png = vmin_pct, vmax_pct
            elif (v_max_in - v_min_in) > 1e-9:
                vmin_png = v_min_in
                vmax_png = v_max_in
                if vmin_png > vmax_png:
                    vmin_png, vmax_png = vmax_png, vmin_png
                if vmax_png - vmin_png < 1e-9:
                    vmin_png, vmax_png = vmin_pct, vmax_pct
            else:
                vmin_png, vmax_png = vmin_pct, vmax_pct
        else:
            vmin_png, vmax_png = vmin_pct, vmax_pct

        raster_b64 = values_to_png_base64(
            z_masked,
            vmin=vmin_png,
            vmax=vmax_png,
            cmap_name=req.variable_code or "default",
        )

        _valid_grid_orig = _valid_grid[np.isfinite(_valid_grid)]

        grid_stats = {
            "min":  float(np.min(_valid_grid_orig))  if len(_valid_grid_orig) > 0 else None,
            "max":  float(np.max(_valid_grid_orig))  if len(_valid_grid_orig) > 0 else None,
            "mean": float(np.mean(_valid_grid_orig)) if len(_valid_grid_orig) > 0 else None,
            "std":  float(np.std(_valid_grid_orig))  if len(_valid_grid_orig) > 1 else 0.0,
        }

        loocv_preds = metrics.get("loocv_predictions") if isinstance(metrics, dict) else None
        effective_index = {original: group_id for group_id, group in enumerate(groups) for original in group}
        loocv_residuals = []
        for index, point in enumerate(req.points):
            group_id = effective_index.get(index)
            prediction = loocv_preds[group_id] if group_id is not None and loocv_preds else None
            actual = float(point.value) if group_id is not None else None
            loocv_residuals.append({
                "original_index": index, "excluded": index in excluded,
                "exclusion_reason": excluded.get(index), "aggregate_index": group_id,
                "lon": point.lon, "lat": point.lat, "actual": actual,
                "predicted": prediction, "error": actual - prediction if prediction is not None else None,
            })
        metrics.update(n_points_used=n_pts, n_points_excluded=len(excluded),
                       n_points_merged=sum(len(g) - 1 for g in groups))

        _STRIP_FROM_METRICS = {"loocv_predictions", "kriging_sigma2", "kriging_std", "kriging_sigma2_transformed"}
        metrics_clean = (
            {k: v for k, v in metrics.items() if k not in _STRIP_FROM_METRICS}
            if isinstance(metrics, dict)
            else metrics
        )

        kriging_sigma2_grid = metrics.get("kriging_sigma2") if isinstance(metrics, dict) else None
        kriging_std_grid = metrics.get("kriging_std") if isinstance(metrics, dict) else None
        kriging_msdr = metrics.get("kriging_msdr") if isinstance(metrics, dict) else None

        if near_constant_grid and (v_max_in - v_min_in) > 1e-9:
            d_vmin = v_min_in
            d_vmax = v_max_in
        else:
            d_vmin, d_vmax = float(vmin_png), float(vmax_png)
            if d_vmax < d_vmin:
                d_vmin, d_vmax = d_vmax, d_vmin

        if near_constant_grid and not low_variance_warning and not has_outliers:
            cv_label = f"CV={cv_pct:.2f}%" if not np.isinf(cv_pct) else "CV=∞ (media≈0)"
            if grid_std < 1e-9 and v_range > 1e-9:
                grid_center_orig = np.array([(vmin_pct + vmax_pct) / 2.0])
                grid_val_str = f"{float(grid_center_orig[0]):.4f}" if len(grid_center_orig) else "N/A"
                low_variance_warning = (
                    f"El método de interpolación ({method.upper()}) produjo una superficie "
                    f"completamente constante (valor ≈ {grid_val_str}) aunque los datos de entrada "
                    f"tienen variación real ({cv_label} · rango={v_range:.4f}). "
                    "Esto puede ocurrir cuando el algoritmo no converge con los parámetros actuales. "
                    "Prueba un método diferente (Kriging, RBF) o ajusta los parámetros."
                )
            else:
                low_variance_warning = (
                    f"La superficie interpolada es casi constante "
                    f"({cv_label} · rango={v_range:.4f} · media={v_mean:.4f}). "
                    "El mapa muestra una escala expandida para visualización — "
                    "la superficie interpolada es casi constante."
                )

        covariate_info = metrics_clean.get("covariate_info") if isinstance(metrics_clean, dict) else None

        response: Dict[str, Any] = {
            "method": method,
            "warnings": warnings,
            "grid_scale": "original",
            "metrics": metrics_clean,
            "raster_png_b64": raster_b64,
            "raster_bbox": {"minx": minx, "miny": miny, "maxx": maxx, "maxy": maxy},
            "raster_vmin": round(float(vmin_png), 6),
            "raster_vmax": round(float(vmax_png), 6),
            "display_vmin": round(float(d_vmin), 6),
            "display_vmax": round(float(d_vmax), 6),
            "near_constant_grid": near_constant_grid,
            "zones": zone_features,
            "n_zones_actual": len(zone_features),
            "grid_stats": grid_stats,
            "loocv_residuals": loocv_residuals,
            "transform_type": transform_type,
            "transform_shift": round(transform_shift_val, 6),
            "transform_lambda": round(transform_lambda_val, 6) if transform_lambda is not None else None,
            "covariate_info": covariate_info,
            "grid_values": [[round(float(v), 6) if not np.isnan(v) else None for v in row] for row in z_masked.tolist()],
            "input_stats": {
                "n": int(len(vals)),
                "n_input": len(req.points),
                "n_used": n_pts,
                "n_excluded": len(excluded),
                "n_merged": sum(len(g) - 1 for g in groups),
                "min": round(v_min_in, 6),
                "max": round(v_max_in, 6),
                "mean": round(v_mean, 6),
                "std": round(v_std, 6),
                "range": round(v_range, 6),
                "cv_pct": round(cv_pct, 4),
            },
            "low_variance_warning": low_variance_warning,
        }
        if kriging_sigma2_grid is not None:
            response["kriging_sigma2_grid"] = kriging_sigma2_grid
        if kriging_std_grid is not None:
            response["kriging_std_grid"] = kriging_std_grid
        if kriging_msdr is not None:
            response["kriging_msdr"] = kriging_msdr
        return _sanitize_for_json(response)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=_safe_error(e, "interpolate"))


@router.post("/variogram-lags")
def handle_variogram_lags(req: InterpolateRequest):
    """Computes empirical semivariogram (Cressie-Hawkins) + F2-08 anisotropy detection."""
    try:
        lons = np.array([p.lon for p in req.points])
        lats = np.array([p.lat for p in req.points])
        vals = np.array([p.value for p in req.points], dtype=float)

        lat_m = 111320.0
        lon_m = 111320.0 * np.cos(np.radians(float(np.mean(lats))))
        cx = (lons - np.mean(lons)) * lon_m
        cy = (lats - np.mean(lats)) * lat_m

        n = len(vals)
        distances, abs_diffs = [], []
        for i in range(n):
            for j in range(i + 1, n):
                d = float(np.sqrt((cx[i] - cx[j]) ** 2 + (cy[i] - cy[j]) ** 2))
                ad = float(abs(vals[i] - vals[j]))
                distances.append(d)
                abs_diffs.append(ad)

        distances = np.array(distances)
        abs_diffs = np.array(abs_diffs)

        if len(distances) == 0:
            return {"lags": [], "variogram_fit": None, "anisotropy": {}}

        d_cutoff = 0.5 * float(np.max(distances))
        valid_pairs = distances <= d_cutoff

        n_bins = min(15, max(5, n))
        lag_edges = np.linspace(0, d_cutoff, n_bins + 1)
        lags = []
        for k in range(n_bins):
            mask = valid_pairs & (distances >= lag_edges[k]) & (distances < lag_edges[k + 1])
            n_pairs = int(np.sum(mask))
            if n_pairs < 2:
                continue
            ad_bin = abs_diffs[mask]
            ch_sv = (float(np.mean(ad_bin ** 0.5)) ** 4) / (0.457 + 0.494 / n_pairs)
            lags.append({
                "lag": float((lag_edges[k] + lag_edges[k + 1]) / 2),
                "semivariance": ch_sv,
                "n_pairs": n_pairs,
            })

        variogram_fit = None
        if len(lags) >= 3:
            from pykrige.ok import OrdinaryKriging
            from services.interpolation import _VARIOGRAM_MODELS, _select_best_variogram, _deg_to_m
            coords = np.column_stack([lons, lats])
            coords_m = _deg_to_m(coords)
            best_model = _select_best_variogram(coords_m, vals)
            try:
                nlags = min(10, max(5, n // 3))
                with np.errstate(invalid="ignore", divide="ignore"):
                    ok_v = OrdinaryKriging(
                        coords_m[:, 0], coords_m[:, 1], vals,
                        variogram_model=best_model,
                        nlags=nlags, weight=True,
                        verbose=False, enable_plotting=False,
                    )
                vp = ok_v.variogram_model_parameters
                variogram_fit = {
                    "model": best_model,
                    "psill": float(vp[0]) if len(vp) > 0 else None,
                    "range": float(vp[1]) if len(vp) > 1 else None,
                    "nugget": float(vp[2]) if len(vp) > 2 else None,
                }
            except Exception:
                variogram_fit = {"model": best_model}

        # F2-08: Anisotropy detection
        anisotropy_info: Dict[str, Any] = {}
        try:
            from services.interpolation import _detect_anisotropy
            coords_a = np.column_stack([lons, lats])
            anisotropy_info = _detect_anisotropy(coords_a, vals)
        except Exception:
            pass

        return _sanitize_for_json({"lags": lags, "variogram_fit": variogram_fit, "anisotropy": anisotropy_info})

    except Exception as e:
        raise HTTPException(status_code=500, detail=_safe_error(e, "variogram-lags"))

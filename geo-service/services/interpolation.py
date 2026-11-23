"""
AgRegen – Interpolation Service v3.1.1
Métodos: IDW adaptativo, Kriging Ordinario, RBF, GLM (Regression Kriging), RF+Kriging.

Mejoras respecto a v3.1.0 (fix GLM degeneración y valores imposibles):
  - GLM: coordenadas normalizadas antes del OLS (condition number ~7 vs ~37k raw)
  - GLM: init_params data-driven + range floor para el Kriging de residuos (mismo fix que Kriging)
  - GLM: threshold degree-2 aumentado 8→12 puntos + guard de condición >1000
  - GLM: guard post-interpolación (std(grid)<5%×std(data) → fallback IDW)
  - GLM: clamp de output a [min−10%rango, max+10%rango] — evita valores físicamente imposibles
  - GLM: flags de observabilidad: trend_r2, residual_std_ratio, condition_number, residual_kriging_used
  - RFK: mismos fixes de init_params + range floor + clamp para el Kriging de residuos RF
  - np.errstate(invalid/divide="ignore") en todos los OrdinaryKriging calls de GLM y RFK

Mejoras respecto a v3.0.0 (fix Kriging over-smoothing):
  - Eliminado modelo `linear` de candidatos (degenera a pendiente≈0 con n≤15)
  - Parámetros iniciales basados en datos (sill=var, range=0.5*max_dist, nugget=10%sill)
  - Detección de fits degenerados en _select_best_variogram (skip si std(ŷ)<5% std(y))
  - Forzar range >= 0.5 * min_inter_point_distance tras el ajuste del variograma
  - Guard post-interpolación: si std(grid)<5% std(pts), cae a IDW con degenerate_fallback
  - Umbral small_n aumentado de 10 a 15 para aplicar safeguards a más muestras pequeñas

Mejoras respecto a v2.x:
  - Winsorización (3×IQR) + transformación automática por asimetría (log1p / sqrt)
  - Métricas LOOCV en escala original (predicciones re-transformadas antes de compute_metrics)
  - GLM = Regresión Kriging: superficie de tendencia polinomial OLS + Kriging de residuos
  - RBF con suavizado adaptativo (5% de la varianza) para evitar oscilaciones
  - Kriging con 4 modelos de variograma + WLS + nlags adaptativo a n
  - RF+Kriging usa selección automática de variograma para los residuos (no fijo "spherical")
  - interpolate_auto_best incluye GLM como candidato en todas las muestras (no solo n≥20)

Referencias:
  Hengl et al. (2007) A practical guide to geostatistical mapping.
  Cressie & Hawkins (1980) Robust estimation of the variogram.
  Chilès & Delfiner (2012) Geostatistics: Modeling Spatial Uncertainty.
"""
import numpy as np
from typing import Dict, List, Tuple, Optional
from scipy.interpolate import RBFInterpolator
from scipy.optimize import minimize_scalar
from scipy.spatial.distance import cdist as _cdist
from scipy.stats import skew as scipy_skew
from scipy.stats import boxcox as scipy_boxcox
from scipy.stats import pearsonr
from scipy.special import inv_boxcox
from pykrige.ok import OrdinaryKriging
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import LinearRegression
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVR
from sklearn.pipeline import make_pipeline
from sklearn.compose import TransformedTargetRegressor
from sklearn.model_selection import GridSearchCV, KFold
from utils.metrics import compute_metrics, loocv_idw
from services.variogram import fit_variogram, inverse_moments


# ─── Coordinate conversion ────────────────────────────────────────────────────

def _wgs84_meters_per_degree(lat_deg: float) -> Tuple[float, float]:
    """WGS84 metres-per-degree at the given latitude.

    Series expansions (Bowring 1985) accounting for the Earth ellipsoid:
      lat_m = 111132.954 - 559.822·cos(2φ) + 1.175·cos(4φ)
      lon_m = (111412.84·cos φ - 93.5·cos 3φ + 0.118·cos 5φ)

    Latitude is clamped to ±89.9° to avoid the longitude singularity at the poles.
    Accurate to ~1 cm for parcels up to ~50 km extent at any non-polar latitude
    (vs. ±0.5 % error of the previous fixed 111320 m constant).
    """
    lat_safe = max(min(float(lat_deg), 89.9), -89.9)
    phi = np.radians(lat_safe)
    lat_m = 111132.954 - 559.822 * np.cos(2 * phi) + 1.175 * np.cos(4 * phi)
    lon_m = (
        111412.84 * np.cos(phi)
        - 93.5 * np.cos(3 * phi)
        + 0.118 * np.cos(5 * phi)
    )
    # Guard against any residual negative value near the pole
    lon_m = max(lon_m, 1e-3)
    return float(lat_m), float(lon_m)


def _deg_to_m(coords: np.ndarray) -> np.ndarray:
    """Local equirectangular projection of (lon, lat) → metres centred on the centroid.

    Uses WGS84 metres-per-degree formulas (varies with latitude). Safe for any
    non-polar latitude. For typical agricultural parcels (≤ ~50 km extent), the
    distance error is below 0.1 %.
    """
    cx = float(np.mean(coords[:, 0]))
    cy = float(np.mean(coords[:, 1]))
    lat_m, lon_m = _wgs84_meters_per_degree(cy)
    out = coords.copy().astype(float)
    out[:, 0] = (out[:, 0] - cx) * lon_m
    out[:, 1] = (out[:, 1] - cy) * lat_m
    return out


def _grid_coords_m(grid_x: np.ndarray, grid_y: np.ndarray, ref_coords: np.ndarray) -> np.ndarray:
    """Same projection as `_deg_to_m` applied to a lon/lat meshgrid."""
    cx = float(np.mean(ref_coords[:, 0]))
    cy = float(np.mean(ref_coords[:, 1]))
    lat_m, lon_m = _wgs84_meters_per_degree(cy)
    gx = (grid_x.ravel() - cx) * lon_m
    gy = (grid_y.ravel() - cy) * lat_m
    return np.column_stack([gx, gy])


# ─── Pre-processing: Winsorisation + auto-transform ──────────────────────────

def _preprocess_values(
    values: np.ndarray, force_transform: str = "auto"
) -> Tuple[np.ndarray, str, float, float]:
    """
    1. Winsorize at 3×IQR (caps outliers without discarding them).
    2. Apply transform — either user-specified or auto-detected from skewness.

    force_transform:
      "auto"   → auto-detect: skew>1.0→log1p, skew>0.5→sqrt, else→none
      "none"   → identity (only winsorize)
      "log1p"  → always apply log(x+1); shift added if values ≤ 0
      "sqrt"   → always apply sqrt(x); shift added if values ≤ 0
      "boxcox" → scipy.stats.boxcox (optimal λ); shift added if values ≤ 0

    Returns (transformed_values, transform_type, shift, lam).
    'lam' is non-zero only for boxcox; 'shift' is non-zero only when values ≤ 0.
    """
    v = values.copy().astype(float)

    # Winsorize
    q1, q3 = np.percentile(v, 25), np.percentile(v, 75)
    iqr = q3 - q1
    if iqr > 1e-12:
        v = np.clip(v, q1 - 3.0 * iqr, q3 + 3.0 * iqr)

    t = force_transform.lower() if force_transform else "auto"

    if t == "none":
        return v, "none", 0.0, 0.0

    if t == "log1p":
        shift = max(0.0, -float(np.min(v)) + 1e-3)
        return np.log1p(v + shift), "log1p", shift, 0.0

    if t == "sqrt":
        shift = max(0.0, -float(np.min(v)) + 1e-3)
        return np.sqrt(v + shift), "sqrt", shift, 0.0

    if t == "boxcox":
        shift = max(0.0, -float(np.min(v)) + 1e-3)
        v_pos = v + shift
        try:
            v_bc, lam = scipy_boxcox(v_pos)
            return v_bc, "boxcox", shift, float(lam)
        except Exception:
            # Fallback to log1p when scipy_boxcox fails (e.g. constant array)
            return np.log1p(v_pos), "log1p", shift, 0.0

    # "auto": detect from skewness
    sk = float(scipy_skew(v)) if len(v) >= 3 else 0.0
    if sk > 1.0:
        shift = max(0.0, -float(np.min(v)) + 1e-3)
        return np.log1p(v + shift), "log1p", shift, 0.0
    elif sk > 0.5:
        shift = max(0.0, -float(np.min(v)) + 1e-3)
        return np.sqrt(v + shift), "sqrt", shift, 0.0
    else:
        return v, "none", 0.0, 0.0


def _back_transform(z: np.ndarray, transform_type: str, shift: float, lam: float = 0.0) -> np.ndarray:
    """Inverts the transform applied by _preprocess_values."""
    if transform_type == "log1p":
        return np.expm1(z) - shift
    elif transform_type == "sqrt":
        return np.maximum(z, 0.0) ** 2 - shift
    elif transform_type == "boxcox":
        try:
            return inv_boxcox(z, lam) - shift
        except Exception:
            # Fallback: if inv_boxcox fails (e.g. lam=0 edge case), use expm1
            return np.expm1(z) - shift
    return z.copy()


def _back_transform_std(
    std_t: float,
    mean_t: float,
    transform_type: str,
    shift: float,
    lam: float = 0.0,
) -> float:
    """Approximate std in original units from std in transformed space (delta method).

    Delta method: std_orig ≈ |g'(μ_t)| · std_t  where g is the back-transform
    and μ_t is the zone mean in transformed space.

    For boxcox the derivative is estimated via a small finite difference because
    the analytic form varies with lam and can be numerically fragile.

    Returns std_t unchanged (safe fallback) if transform_type is "none"/unknown.
    Clamps the result to be non-negative.
    """
    if std_t <= 0.0 or transform_type in ("none", "identity"):
        return max(std_t, 0.0)
    try:
        if transform_type == "log1p":
            # g(z) = exp(z) - shift  →  g'(z) = exp(z)
            deriv = float(np.exp(mean_t))
        elif transform_type == "sqrt":
            # g(z) = max(z,0)^2 - shift  →  g'(z) = 2·max(z,0)
            deriv = 2.0 * max(float(mean_t), 0.0)
        elif transform_type == "boxcox":
            # Use symmetric finite difference: h = 1e-4 * (|mean_t| + 1)
            h = 1e-4 * (abs(mean_t) + 1.0)
            hi = float(_back_transform(np.array([mean_t + h]), transform_type, shift, lam)[0])
            lo = float(_back_transform(np.array([mean_t - h]), transform_type, shift, lam)[0])
            deriv = (hi - lo) / (2.0 * h)
        else:
            return max(std_t, 0.0)
        return max(abs(deriv) * std_t, 0.0)
    except Exception:
        return max(std_t, 0.0)  # safe fallback: return unchanged


# ─── IDW Adaptativo ──────────────────────────────────────────────────────────

def _idw_predict_knn(
    coords_m: np.ndarray, values: np.ndarray, query: np.ndarray,
    power: float, k: int,
) -> np.ndarray:
    result = np.zeros(len(query))
    for i, q in enumerate(query):
        dx = q[0] - coords_m[:, 0]
        dy = q[1] - coords_m[:, 1]
        dist = np.sqrt(dx ** 2 + dy ** 2)
        dist = np.where(dist < 1e-6, 1e-6, dist)
        kk = min(k, len(dist))
        idx = np.argpartition(dist, kk - 1)[:kk]
        w = 1.0 / (dist[idx] ** power)
        result[i] = np.sum(w * values[idx]) / np.sum(w)
    return result


def _loocv_idw_knn(coords_m: np.ndarray, values: np.ndarray, power: float, k: int) -> float:
    n = len(values)
    y_pred = np.zeros(n)
    for i in range(n):
        mask = np.arange(n) != i
        c_sub, v_sub = coords_m[mask], values[mask]
        dx = coords_m[i, 0] - c_sub[:, 0]
        dy = coords_m[i, 1] - c_sub[:, 1]
        dist = np.sqrt(dx ** 2 + dy ** 2)
        dist = np.where(dist < 1e-12, 1e-12, dist)
        kk = min(k, len(dist))
        idx = np.argpartition(dist, kk - 1)[:kk]
        w = 1.0 / (dist[idx] ** power)
        y_pred[i] = np.sum(w * v_sub[idx]) / np.sum(w)
    return float(np.sqrt(np.mean((values - y_pred) ** 2)))


def _optimize_idw_power(coords_m: np.ndarray, values: np.ndarray) -> float:
    """Optimize IDW power using the same KNN predictor used for actual interpolation.

    A fixed k=min(5, n-1) is used here so the LOOCV objective evaluates the
    same model family as `_idw_predict_knn`.  Previously this called `loocv_idw`
    (all-neighbours), which was inconsistent with the KNN prediction path and
    could yield sub-optimal powers when n was small.
    """
    k_fixed = max(2, min(5, len(values) - 1))
    def loocv_rmse(p: float) -> float:
        return _loocv_idw_knn(coords_m, values, power=p, k=k_fixed)
    try:
        res = minimize_scalar(loocv_rmse, bounds=(1.5, 4.0), method="bounded",
                              options={"xatol": 0.1, "maxiter": 20})
        return float(np.clip(res.x, 1.5, 4.0))
    except Exception:
        return 2.0


def _optimize_idw_k(coords_m: np.ndarray, values: np.ndarray, power: float) -> int:
    n = len(values)
    k_max = min(n - 1, 7)
    candidates = list(range(2, max(3, k_max + 1)))
    if not candidates:
        return min(2, n)
    best_k, best_rmse = candidates[0], float("inf")
    for k in candidates:
        rmse = _loocv_idw_knn(coords_m, values, power, k)
        if rmse < best_rmse:
            best_rmse, best_k = rmse, k
    return best_k


def idw_interpolate(
    coords: np.ndarray, values: np.ndarray,
    grid_x: np.ndarray, grid_y: np.ndarray,
    power: Optional[float] = None, k: Optional[int] = None,
    transform: str = "auto",
) -> Tuple[np.ndarray, Dict]:
    """
    Adaptive IDW: optimises power p and k (neighbours) by LOOCV.
    Pre-processes with Winsorisation + user-specified or auto-skewness transform.
    Returns metrics in original scale (back-transformed LOOCV predictions).
    """
    v, ttype, shift, lam = _preprocess_values(values, force_transform=transform)
    coords_m = _deg_to_m(coords)
    grid_pts_m = _grid_coords_m(grid_x, grid_y, coords)
    n = len(v)

    auto_power = power is None or power <= 0
    p_opt = _optimize_idw_power(coords_m, v) if auto_power else float(power)

    auto_k = k is None or k <= 0
    k_opt = _optimize_idw_k(coords_m, v, p_opt) if auto_k else int(k)

    z_t = _idw_predict_knn(coords_m, v, grid_pts_m, p_opt, k_opt)
    # z_t is in transformed space — raster returned in transformed space

    # ── Post-predict degeneracy guard ────────────────────────────────────────
    # IDW can still collapse to a near-constant surface when all sample points
    # land at essentially the same meter-space location (spatial degeneracy that
    # slipped past the pre-interpolation check, e.g. only 2 unique coordinate
    # clusters). Detect and log it so the caller can surface a useful error.
    _grid_std = float(np.std(z_t))
    _data_std = float(np.std(v))
    _idw_degenerate = (_data_std > 1e-9) and (_grid_std < 1e-6 * _data_std)
    if _idw_degenerate:
        import logging as _logging
        _logging.getLogger("geo-service").warning(
            "IDW produced a near-constant grid "
            f"(grid_std={_grid_std:.3e} < 1e-6 × data_std={_data_std:.3e}). "
            f"power={p_opt:.3f} k={k_opt} n={n} transform={ttype}. "
            "Likely cause: all sample-point coordinates are nearly identical in meter-space."
        )

    # LOOCV in transformed space, back-transform predictions for original-scale metrics
    y_cv_t = np.zeros(n)
    for i in range(n):
        mask = np.arange(n) != i
        dx = coords_m[i, 0] - coords_m[mask, 0]
        dy = coords_m[i, 1] - coords_m[mask, 1]
        dist = np.sqrt(dx ** 2 + dy ** 2)
        dist = np.where(dist < 1e-12, 1e-12, dist)
        kk = min(k_opt, int(np.sum(mask)))
        idx = np.argpartition(dist, kk - 1)[:kk]
        w = 1.0 / (dist[idx] ** p_opt)
        y_cv_t[i] = np.sum(w * v[mask][idx]) / np.sum(w)
    y_cv = _back_transform(y_cv_t, ttype, shift, lam)
    cv = compute_metrics(values, y_cv)

    _params: Dict = {
        "power": round(float(p_opt), 3),
        "k_neighbors": k_opt,
        "auto_power": auto_power,
        "auto_k": auto_k,
        "transform": ttype,
        "transform_shift": float(shift),
        "transform_lambda": round(float(lam), 6) if lam != 0.0 else None,
    }
    if _idw_degenerate:
        _params["degenerate_fallback"] = True
        _params["degenerate_reason"] = {
            "check": "idw_grid_std_collapse",
            "grid_std": round(float(_grid_std), 8),
            "data_std": round(float(_data_std), 8),
            "ratio": round(float(_grid_std / _data_std), 10) if _data_std > 1e-9 else 0.0,
            "threshold": 1e-6,
            "n_points": int(n),
            "power_used": round(float(p_opt), 3),
            "k_used": int(k_opt),
            "transform": ttype,
        }

    return z_t.reshape(grid_x.shape), {
        **cv,
        "loocv_predictions": y_cv.tolist(),
        "params": _params,
    }


# ─── Kriging Ordinario ────────────────────────────────────────────────────────

# Four variogram models. `linear` removed: it degenerates to slope≈0 with n≤15,
# causing the kriging system to collapse to the global mean (std≈0 maps).
_VARIOGRAM_MODELS = ["spherical", "exponential", "gaussian"]

# Models for which a finite "range" parameter exists and must be enforced
_RANGE_MODELS = {"spherical", "exponential", "gaussian"}


def _compute_variogram_init_params(coords_m: np.ndarray, values: np.ndarray) -> Dict:
    """Computes data-driven initial variogram parameters to guide PyKrige's optimizer.

    Without good starting points PyKrige often converges to degenerate local minima
    (e.g. range=0.013 m or psill≈0). We anchor:
      psill  = sample variance          (target structural variance)
      range  = 0.5 × max inter-pt dist  (realistic spatial scale)
      nugget = 10% of psill             (small but non-zero)
    """
    D = _cdist(coords_m, coords_m)
    max_dist = float(D.max()) if D.size > 0 else 1.0
    sill_est = max(1e-6, float(np.var(values)))
    return {
        "psill": sill_est,
        "range": max(1.0, 0.5 * max_dist),
        "nugget": max(1e-8, 0.1 * sill_est),
    }


def _model_init_params(model: str, base: Dict) -> Optional[Dict]:
    """Converts generic init params to PyKrige model-specific parameter dict.

    PyKrige requires different key names per model type:
      spherical / exponential / gaussian : {"psill", "range", "nugget"}
      power                              : {"scale", "exponent", "nugget"}
      linear                             : {"slope", "nugget"}  (model removed; kept for safety)
    Returns None for unknown models so PyKrige uses its own defaults.
    """
    if model in ("spherical", "exponential", "gaussian"):
        return {"psill": base["psill"], "range": base["range"], "nugget": base["nugget"]}
    if model == "power":
        # scale ≈ psill; exponent fixed at 1.5 (moderate power law)
        return {"scale": base["psill"], "exponent": 1.5, "nugget": base["nugget"]}
    if model == "linear":
        return {"slope": max(1e-6, base["psill"] / max(base["range"], 1.0)), "nugget": base["nugget"]}
    return None


def _enforce_range_floor(ok: OrdinaryKriging, coords_m: np.ndarray, model: str) -> None:
    """Post-fitting enforcement: range >= 0.5 × 10th-percentile inter-point distance.

    F1-07: Uses the 10th percentile of all pairwise distances instead of the
    minimum. The minimum is easily dominated by a single near-duplicate pair and
    yields an artificially small floor.  The 10th percentile is robust to
    clustered designs while still enforcing a physically meaningful minimum range.

    Only applied to spherical / exponential / gaussian (they have a finite range param).
    """
    if model not in _RANGE_MODELS:
        return
    D = _cdist(coords_m, coords_m)
    np.fill_diagonal(D, np.inf)
    D_finite = D[D < np.inf]
    if D_finite.size == 0:
        return
    q10 = float(np.percentile(D_finite, 10))
    range_floor = max(1.0, 0.5 * q10)
    vp = list(ok.variogram_model_parameters)
    if len(vp) >= 2 and vp[1] < range_floor:
        vp[1] = range_floor
        ok.variogram_model_parameters = vp


def _kriging_loocv_pts(
    coords_m: np.ndarray, values: np.ndarray, model: str, nlags: int,
    nugget_floor: float = 0.0,
    init_params: Optional[Dict] = None,
) -> np.ndarray:
    """Returns per-point LOOCV predictions (transformed space) for the given variogram model.

    nugget_floor: if > 0, post-fitting nugget floor is enforced (prevents degenerate fits).
    init_params:  if provided, passed as variogram_parameters to PyKrige for each fold.
                  Per-fold sill/range are recomputed from the n-1 subset.
    """
    n = len(values)
    y_pred = np.zeros(n)
    small_n = (n - 1) < 15  # increased from 10 — n=10-14 still benefit from safeguards
    for i in range(n):
        mask = np.arange(n) != i
        c_sub = coords_m[mask]
        v_sub = values[mask]
        try:
            kwargs: Dict = {}
            if small_n:
                kwargs["anisotropy_scaling"] = 1.0
            if init_params is not None:
                # Recompute per-fold base params from the leave-one-out subset,
                # then convert to model-specific key names via _model_init_params
                fold_sill = max(1e-6, float(np.var(v_sub)))
                D_sub = _cdist(c_sub, c_sub)
                fold_range = max(1.0, 0.5 * float(D_sub.max()))
                fold_base = {
                    "psill": fold_sill,
                    "range": fold_range,
                    "nugget": max(1e-8, 0.1 * fold_sill),
                }
                fitted, _ = fit_variogram(c_sub, v_sub, model)
                model_params = _model_init_params(model, fitted)
                if model_params is not None:
                    kwargs["variogram_parameters"] = model_params
            with np.errstate(invalid="ignore", divide="ignore"):
                ok_i = OrdinaryKriging(
                    c_sub[:, 0], c_sub[:, 1], v_sub,
                    variogram_model=model, nlags=nlags, weight=True,
                    verbose=False, enable_plotting=False,
                    **kwargs,
                )
            _enforce_range_floor(ok_i, c_sub, model)
            if nugget_floor > 0:
                vp = list(ok_i.variogram_model_parameters)
                if len(vp) >= 3 and vp[2] < nugget_floor:
                    vp[2] = nugget_floor
                    ok_i.variogram_model_parameters = vp
            z_i, _ = ok_i.execute("points", [coords_m[i, 0]], [coords_m[i, 1]])
            y_pred[i] = float(z_i[0])
        except Exception:
            y_pred[i] = float(np.mean(v_sub))
    return y_pred


def _select_best_variogram(coords_m: np.ndarray, values: np.ndarray) -> str:
    """Selects the variogram model with lowest LOOCV RMSE.

    Uses:
      - nlags adapted to sample size
      - Weighted LS variogram fitting (weight=True)
      - Data-driven initial parameter estimates to avoid degenerate local minima
      - Degeneracy filter: skips models whose LOOCV predictions are near-constant
        (std < 5% of data std), since they just predict the global mean

    If ALL models are degenerate, returns "spherical" as a safe fallback.
    """
    n = len(values)
    nlags = min(10, max(5, n // 3))
    init_params = _compute_variogram_init_params(coords_m, values)
    data_std = float(np.std(values))
    degenerate_threshold = 0.05 * data_std  # predictions must vary by at least 5% of data std

    best_model, best_rmse = "spherical", float("inf")
    for model in _VARIOGRAM_MODELS:
        try:
            with np.errstate(invalid="ignore", divide="ignore"):
                y_pred = _kriging_loocv_pts(
                    coords_m, values, model, nlags, init_params=init_params,
                )
            # Skip degenerate models: they predict ≈ global mean for all points
            if float(np.std(y_pred)) < degenerate_threshold:
                continue
            rmse = float(np.sqrt(np.mean((values - y_pred) ** 2)))
            if rmse < best_rmse:
                best_rmse, best_model = rmse, model
        except Exception:
            continue
    return best_model


def _kriging_original_cv(coords_m, values, model, transform):
    """Refit preprocessing and variogram on each training fold, not held-out data."""
    predictions, variances = [], []
    for i in range(len(values)):
        keep = np.arange(len(values)) != i
        v, t, shift, lam = _preprocess_values(values[keep], transform)
        params, _ = fit_variogram(coords_m[keep], v, model)
        ok = OrdinaryKriging(*coords_m[keep].T, v, variogram_model=model,
                             variogram_parameters=_model_init_params(model, params),
                             verbose=False, enable_plotting=False, pseudo_inv=True)
        mu, s2 = ok.execute("points", coords_m[i:i+1, 0], coords_m[i:i+1, 1])
        mean, var = inverse_moments(np.asarray(mu), np.asarray(s2), t, shift, lam)
        predictions.append(float(mean[0]))
        variances.append(max(float(var[0]), 1e-12))
    return np.array(predictions), np.array(variances)


def kriging_interpolate(
    coords: np.ndarray, values: np.ndarray,
    grid_x: np.ndarray, grid_y: np.ndarray,
    variogram_model: str = "auto",
    transform: str = "auto",
    range_init: Optional[float] = None,
    sill_init: Optional[float] = None,
) -> Tuple[np.ndarray, Dict]:
    """
    Ordinary Kriging with:
      - Cressie-weighted empirical fits; auto compares spherical/exponential/gaussian
      - Every held-out fold refits its transform and variogram on training only
      - Range floor enforcement: range >= 0.5 × min inter-point distance
      - Post-interpolation degeneracy guard: falls back to IDW if std(grid) < 5% std(data)
      - nlags adapted to sample size; small_n safeguards for n < 15
      - LOOCV metrics in original scale
    """
    v, ttype, shift, lam = _preprocess_values(values, force_transform=transform)
    coords_m = _deg_to_m(coords)
    grid_pts_m = _grid_coords_m(grid_x, grid_y, coords)
    n = len(v)
    nlags = min(10, max(5, n // 3))  # min 5 lags, adapted to sample size

    # Small-sample safeguards: anisotropy_scaling=1.0 + nugget floor ≥ 5% variance
    # Threshold increased from 10 → 15 (n=10-14 still benefit from safeguards)
    small_n = n < 15
    nugget_floor = max(1e-8, 0.05 * float(np.var(v))) if small_n else 0.0

    # Data-driven initial variogram params (global scope: used for full-data fit)
    init_params = _compute_variogram_init_params(coords_m, v)
    # Apply user-specified overrides for range and sill if provided
    if range_init is not None and range_init > 0:
        init_params["range"] = float(range_init)
    if sill_init is not None and sill_init > 0:
        init_params["psill"] = float(sill_init)

    auto_model = variogram_model in ("auto", None, "")
    candidates = _VARIOGRAM_MODELS if auto_model else [variogram_model]
    cv_results, candidate_errors = {}, {}
    for model in candidates:
        try:
            cv_results[model] = _kriging_original_cv(coords_m, values, model, transform)
        except Exception as error:
            candidate_errors[model] = str(error)[:120]
    if not cv_results:
        z_idw, idw_metrics = idw_interpolate(coords, values, grid_x, grid_y, transform=transform)
        return z_idw, {**idw_metrics, "variogram": None,
                       "error": f"LOOCV de kriging falló; se usó IDW: {candidate_errors}",
                       "params": {**idw_metrics.get("params", {}), "model": "idw-fallback", "degenerate_fallback": True}}
    selected_model = min(cv_results, key=lambda model: np.mean((values - cv_results[model][0]) ** 2))
    fitted_params, fit_info = fit_variogram(coords_m, v, selected_model, range_init, sill_init)

    try:
        ok_kwargs: Dict = {}
        model_vp = _model_init_params(selected_model, fitted_params)
        if model_vp is not None:
            ok_kwargs["variogram_parameters"] = model_vp
        if small_n:
            ok_kwargs["anisotropy_scaling"] = 1.0
        with np.errstate(invalid="ignore", divide="ignore"):
            ok = OrdinaryKriging(
                coords_m[:, 0], coords_m[:, 1], v,
                variogram_model=selected_model,
                nlags=nlags, weight=True,
                verbose=False, enable_plotting=False,
                **ok_kwargs,
            )

        # Enforce range floor to prevent near-zero range from collapsing predictions to mean
        _enforce_range_floor(ok, coords_m, selected_model)

        # Enforce nugget floor for small-n
        if small_n and nugget_floor > 0:
            vp_list = list(ok.variogram_model_parameters)
            if len(vp_list) >= 3 and vp_list[2] < nugget_floor:
                vp_list[2] = nugget_floor
                ok.variogram_model_parameters = vp_list

        z_t, sigma_sq = ok.execute("points", grid_pts_m[:, 0], grid_pts_m[:, 1])
        z_t = np.array(z_t)
        sigma_sq = np.array(sigma_sq)
        # z_t is in transformed space — raster returned in transformed space

        # ── Post-interpolation degeneracy guard (compare in transformed space) ─
        # If the output grid is nearly flat (std < 5% of transformed data std),
        # Kriging collapsed to the mean despite our safeguards — fall back to IDW.
        data_std = float(np.std(v))    # v is already transformed
        grid_std = float(np.nanstd(z_t))
        degenerate_output = (data_std > 1e-9) and (grid_std < 0.05 * data_std)

        if degenerate_output:
            z_idw, idw_metrics = idw_interpolate(coords, values, grid_x, grid_y, transform=transform)
            return z_idw, {
                **idw_metrics,
                "variogram": None,
                "params": {
                    "model": "idw-fallback",
                    "transform": ttype,
                    "transform_shift": float(shift),
                    "transform_lambda": round(float(lam), 6) if lam != 0.0 else None,
                    "degenerate_fallback": True,
                    "degenerate_reason": {
                        "check": "kriging_grid_std_collapse",
                        "model": selected_model,
                        "grid_std": round(float(grid_std), 8),
                        "data_std": round(float(data_std), 8),
                        "ratio": round(float(grid_std / data_std), 10) if data_std > 1e-9 else 0.0,
                        "threshold": 0.05,
                        "fallback": "idw",
                    },
                },
            }

        vp = ok.variogram_model_parameters
        vm_info = {
            **fit_info,
            "model": selected_model,
            "auto_selected": auto_model,
            "psill": float(vp[0]) if len(vp) > 0 else None,
            "range": float(vp[1]) if len(vp) > 1 else None,
            "nugget": float(vp[2]) if len(vp) > 2 else None,
        }

        # Fold-wise predictions and predictive variances in original units.
        y_cv, cv_variance = cv_results[selected_model]
        cv = compute_metrics(values, y_cv)

        # MSDR uses each held-out predictive variance, never mean raster variance.
        _, sigma2_original = inverse_moments(z_t, sigma_sq, ttype, shift, lam)
        sigma_orig = np.sqrt(np.maximum(sigma2_original, 0.))
        msdr = float(np.mean((values - y_cv) ** 2 / cv_variance))

        return z_t.reshape(grid_x.shape), {
            **cv, "variogram": vm_info,
            "loocv_predictions": y_cv.tolist(),
            "kriging_sigma2": sigma2_original.reshape(grid_x.shape).tolist(),
            "kriging_sigma2_transformed": sigma_sq.reshape(grid_x.shape).tolist(),
            "kriging_std": sigma_orig.reshape(grid_x.shape).tolist(),
            "kriging_msdr": msdr,
            "msdr": msdr,
            "loocv_variances": cv_variance.tolist(),
            "params": {
                "model": selected_model,
                "transform": ttype,
                "transform_shift": float(shift),
                "transform_lambda": float(lam) if lam != 0.0 else None,
                "small_n_safeguards": small_n,
                "variance_scale": "original",
                "bias_correction": ("lognormal_exact" if ttype == "log1p" or (ttype == "boxcox" and abs(lam) < 1e-7)
                                    else "boxcox_second_order_delta" if ttype == "boxcox" else "none"),
                "bias_correction_formula": ("exp(mu+sigma2/2)-1-shift" if ttype == "log1p" else
                                            "exp(mu+sigma2/2)-shift" if ttype == "boxcox" and abs(lam) < 1e-7 else
                                            "inverse_BoxCox(mu)+0.5*g_second(mu)*sigma2-shift" if ttype == "boxcox" else None),
            },
        }

    except Exception as e:
        z_idw, idw_metrics = idw_interpolate(coords, values, grid_x, grid_y, transform=transform)
        return z_idw, {
            **idw_metrics, "variogram": None,
            "error": f"Kriging falló ({selected_model}), se usó IDW: {str(e)[:120]}",
            "params": {
                **idw_metrics.get("params", {}),
                "model": "idw-fallback",
                "degenerate_fallback": True,
                "degenerate_reason": {
                    "check": "kriging_exception_fallback",
                    "failed_model": selected_model,
                    "exception": str(e)[:200],
                    "fallback": "idw",
                },
            },
        }


# ─── RBF con suavizado adaptativo ────────────────────────────────────────────

_RBF_KERNELS = ["thin_plate_spline", "multiquadric", "linear", "cubic", "gaussian"]


def rbf_interpolate(
    coords: np.ndarray, values: np.ndarray,
    grid_x: np.ndarray, grid_y: np.ndarray,
    kernel: str = "auto",
    transform: str = "auto",
    smoothing_override: Optional[float] = None,
) -> Tuple[np.ndarray, Dict]:
    """
    RBF with adaptive smoothing (5% of variance) to avoid oscillations in exact interpolation.
    Auto-selects kernel by LOOCV RMSE.
    smoothing_override: if provided and > 0, overrides the automatic 5%-of-variance smoothing.
    """
    v, ttype, shift, lam = _preprocess_values(values, force_transform=transform)
    coords_m = _deg_to_m(coords)
    grid_pts_m = _grid_coords_m(grid_x, grid_y, coords)
    n = len(v)

    # Smoothing: user override takes priority; otherwise 5% of variance
    if smoothing_override is not None and smoothing_override > 0:
        smoothing = float(smoothing_override)
    else:
        smoothing = max(1e-8, 0.05 * float(np.var(v)))

    def _loocv_rmse(kern: str) -> float:
        y_pred = np.zeros(n)
        for i in range(n):
            mask = np.arange(n) != i
            try:
                rbf_i = RBFInterpolator(
                    coords_m[mask], v[mask], kernel=kern, smoothing=smoothing,
                )
                y_pred[i] = float(rbf_i(coords_m[i:i + 1])[0])
            except Exception:
                y_pred[i] = float(np.mean(v[mask]))
        return float(compute_metrics(v, y_pred)["rmse"])

    auto_kernel = kernel in ("auto", None, "")
    if auto_kernel:
        best_kernel, best_rmse = "thin_plate_spline", float("inf")
        for kk in _RBF_KERNELS:
            try:
                r = _loocv_rmse(kk)
                if r < best_rmse:
                    best_rmse, best_kernel = r, kk
            except Exception:
                continue
        selected_kernel = best_kernel
    else:
        selected_kernel = kernel

    try:
        rbf = RBFInterpolator(coords_m, v, kernel=selected_kernel, smoothing=smoothing)
        z_t = rbf(grid_pts_m)
        # z_t is in transformed space — raster returned in transformed space

        y_cv_t = np.zeros(n)
        for i in range(n):
            mask = np.arange(n) != i
            rbf_i = RBFInterpolator(
                coords_m[mask], v[mask], kernel=selected_kernel, smoothing=smoothing,
            )
            y_cv_t[i] = float(rbf_i(coords_m[i:i + 1])[0])
        y_cv = _back_transform(y_cv_t, ttype, shift, lam)
        cv = compute_metrics(values, y_cv)

        return z_t.reshape(grid_x.shape), {
            **cv,
            "loocv_predictions": y_cv.tolist(),
            "params": {
                "kernel": selected_kernel,
                "auto_selected": auto_kernel,
                "smoothing": round(float(smoothing), 6),
                "transform": ttype,
                "transform_shift": float(shift),
                "transform_lambda": round(float(lam), 6) if lam != 0.0 else None,
            },
        }

    except Exception as e:
        z_idw, idw_metrics = idw_interpolate(coords, values, grid_x, grid_y, transform=transform)
        return z_idw, {
            **idw_metrics,
            "error": f"RBF falló ({selected_kernel}), se usó IDW: {str(e)[:120]}",
            "params": {
                "kernel": "idw-fallback",
                "degenerate_fallback": True,
                "degenerate_reason": {
                    "check": "rbf_exception_fallback",
                    "failed_kernel": selected_kernel,
                    "exception": str(e)[:200],
                    "fallback": "idw",
                },
            },
        }


# ─── GLM – Regression Kriging (Trend Surface + Kriging de residuos) ──────────

def _poly_design(coords_norm: np.ndarray, degree: int) -> np.ndarray:
    """Polynomial design matrix using pre-normalized coordinates.
    [1, x, y] (deg=1) or [1, x, y, x², y², xy] (deg=2).
    Caller must normalize coords for numerical stability before passing here.
    """
    x, y = coords_norm[:, 0], coords_norm[:, 1]
    cols = [np.ones(len(x)), x, y]
    if degree >= 2:
        cols += [x ** 2, y ** 2, x * y]
    return np.column_stack(cols)


def regression_kriging(
    coords: np.ndarray, values: np.ndarray,
    grid_x: np.ndarray, grid_y: np.ndarray,
    feature_source: str = "coords",
    external_covariates: Optional[List[dict]] = None,
    degree: int = 2,
    transform: str = "auto",
) -> Tuple[np.ndarray, Dict]:
    """Unified Regression Kriging (Hengl 2007 §4.3) — replaces glm_interpolate and cokriging_interpolate.

    Parameters
    ----------
    feature_source : "coords" | "external" | "both"
        - "coords"   → trend = polynomial of sample coordinates (ex-GLM).
        - "external" → trend = eligible external co-variables (ex-"cokriging").
        - "both"     → trend = coordinate polynomial + eligible external co-variables.
    external_covariates : list of {"code": str, "values": [float, ...]} | None
        Co-variable values at sampling points (ignored when feature_source="coords").
    degree : polynomial degree for coordinate features (1 or 2).
    """
    n = len(values)
    v, ttype, shift, lam = _preprocess_values(values, force_transform=transform)
    coords_m = _deg_to_m(coords)
    grid_pts_m = _grid_coords_m(grid_x, grid_y, coords)
    nlags = min(10, max(5, n // 3))

    # ── Coordinate normalisation ──────────────────────────────────────────────
    x_mean = float(np.mean(coords_m[:, 0]))
    y_mean = float(np.mean(coords_m[:, 1]))
    x_std = max(float(np.std(coords_m[:, 0])), 1.0)
    y_std = max(float(np.std(coords_m[:, 1])), 1.0)

    def _normalize(c: np.ndarray) -> np.ndarray:
        return np.column_stack([(c[:, 0] - x_mean) / x_std, (c[:, 1] - y_mean) / y_std])

    # ── Degree downgrade guard ────────────────────────────────────────────────
    p = degree if (degree == 1 or n >= 12) else 1

    # ── Screen external covariates with Pearson + p-value gate (F2-01) ───────
    selected_covs: List[Tuple[str, np.ndarray, float]] = []
    pearson_rs: Dict[str, float] = {}
    pearson_pvals: Dict[str, float] = {}
    covariate_fallback = False

    if feature_source in ("external", "both") and external_covariates:
        for cov in external_covariates:
            code = str(cov.get("code", ""))
            raw = cov.get("values", [])
            if not raw:
                continue
            cov_vals = np.array(raw, dtype=float)
            if len(cov_vals) != n or np.std(cov_vals) < 1e-12:
                continue
            try:
                r_val, p_val = pearsonr(values, cov_vals)
                if not np.isfinite(r_val):
                    continue
                pearson_rs[code] = round(float(r_val), 4)
                pearson_pvals[code] = round(float(p_val), 6)
                # F2-01 gate: |r| >= 0.4 AND p < 0.10
                if abs(r_val) >= 0.4 and p_val < 0.10:
                    selected_covs.append((code, cov_vals, float(r_val)))
            except Exception:
                continue

        if feature_source == "external" and len(selected_covs) == 0:
            covariate_fallback = True

    # ── Build design matrix ───────────────────────────────────────────────────
    feature_blocks_train: List[np.ndarray] = []
    feature_blocks_grid: List[np.ndarray] = []
    cond_num: float = 0.0
    degree_downgraded: bool = False

    if feature_source in ("coords", "both"):
        coords_norm = _normalize(coords_m)
        grid_norm = _normalize(grid_pts_m)
        X_coord_train = _poly_design(coords_norm, p)
        X_coord_grid = _poly_design(grid_norm, p)
        cond_num = float(np.linalg.cond(X_coord_train))
        if p == 2 and cond_num > 1000.0:
            p = 1
            X_coord_train = _poly_design(coords_norm, p)
            X_coord_grid = _poly_design(grid_norm, p)
            cond_num = float(np.linalg.cond(X_coord_train))
            degree_downgraded = True
        feature_blocks_train.append(X_coord_train)
        feature_blocks_grid.append(X_coord_grid)

    if feature_source in ("external", "both") and selected_covs:
        X_ext_train = np.column_stack([cv for _, cv, _ in selected_covs])
        X_ext_grid = np.column_stack([
            _idw_at_points(coords_m, cv, grid_pts_m) for _, cv, _ in selected_covs
        ])
        feature_blocks_train.append(X_ext_train)
        feature_blocks_grid.append(X_ext_grid)

    if not feature_blocks_train:
        # Pure external mode with no eligible covariates — fall back to Ordinary Kriging
        z_k, m_k = kriging_interpolate(coords, values, grid_x, grid_y, transform=transform)
        reason = "Ninguna co-variable pasó el gate (|r|≥0.4 y p<0.10)" if external_covariates else "No se enviaron co-variables"
        return z_k, {
            **m_k,
            "covariate_info": {
                "selected": [], "pearson_r": pearson_rs, "p_values": pearson_pvals,
                "fallback": True, "fallback_reason": reason,
            },
        }

    X_train = np.hstack(feature_blocks_train)
    X_grid = np.hstack(feature_blocks_grid)

    # ── OLS trend ────────────────────────────────────────────────────────────
    beta, _, _, _ = np.linalg.lstsq(X_train, v, rcond=None)
    trend_pts = X_train @ beta
    residuals = v - trend_pts

    ss_res = float(np.sum((v - trend_pts) ** 2))
    ss_tot = float(np.sum((v - np.mean(v)) ** 2))
    trend_r2 = float(1.0 - ss_res / ss_tot) if ss_tot > 1e-12 else 0.0
    residual_std_ratio = float(np.std(residuals)) / max(float(np.std(v)), 1e-12)

    trend_grid = X_grid @ beta

    # ── Variogram selection for residuals ─────────────────────────────────────
    selected_model = _select_best_variogram(coords_m, residuals)
    init_res = _compute_variogram_init_params(coords_m, residuals)
    model_vp = _model_init_params(selected_model, init_res)
    ok_kwargs: Dict = {}
    if model_vp is not None:
        ok_kwargs["variogram_parameters"] = model_vp

    # ── Krige residuals ───────────────────────────────────────────────────────
    vm_info: Dict = {"model": selected_model}
    residual_kriging_used = False
    trend_only_fallback = False

    try:
        with np.errstate(invalid="ignore", divide="ignore"):
            ok = OrdinaryKriging(
                coords_m[:, 0], coords_m[:, 1], residuals,
                variogram_model=selected_model,
                nlags=nlags, weight=True,
                verbose=False, enable_plotting=False,
                **ok_kwargs,
            )
        _enforce_range_floor(ok, coords_m, selected_model)
        res_grid, _ = ok.execute("points", grid_pts_m[:, 0], grid_pts_m[:, 1])
        z_t = trend_grid + np.array(res_grid)
        residual_kriging_used = True
        vp = ok.variogram_model_parameters
        vm_info.update({
            "psill": float(vp[0]) if len(vp) > 0 else None,
            "range": float(vp[1]) if len(vp) > 1 else None,
            "nugget": float(vp[2]) if len(vp) > 2 else None,
        })
    except Exception:
        z_t = trend_grid
        trend_only_fallback = True

    # ── Clamp in transformed space ────────────────────────────────────────────
    vt_min, vt_max = float(np.min(v)), float(np.max(v))
    vt_margin = max(0.1 * (vt_max - vt_min), 1e-6)
    z_t = np.clip(z_t, vt_min - vt_margin, vt_max + vt_margin)

    # ── Degeneracy guard ─────────────────────────────────────────────────────
    data_std = float(np.std(v))
    grid_std = float(np.nanstd(z_t))
    if data_std > 1e-9 and grid_std < 0.05 * data_std:
        z_idw, idw_m = idw_interpolate(coords, values, grid_x, grid_y, transform=transform)
        return z_idw, {
            **idw_m,
            "variogram": None,
            "params": {
                "method": "idw-fallback",
                "transform": ttype,
                "transform_shift": float(shift),
                "transform_lambda": round(float(lam), 6) if lam != 0.0 else None,
                "degenerate_fallback": True,
                "degenerate_reason": {
                    "check": "regression_kriging_grid_std_collapse",
                    "grid_std": round(float(grid_std), 8),
                    "data_std": round(float(data_std), 8),
                    "threshold": 0.05,
                    "fallback": "idw",
                },
            },
        }

    # ── LOOCV ─────────────────────────────────────────────────────────────────
    y_cv_t = np.zeros(n)
    for i in range(n):
        mask = np.arange(n) != i
        v_sub, c_sub = v[mask], coords_m[mask]
        X_sub_blocks: List[np.ndarray] = []
        X_test_blocks: List[np.ndarray] = []

        if feature_source in ("coords", "both"):
            c_sub_norm = _normalize(c_sub)
            X_sub_blocks.append(_poly_design(c_sub_norm, p))
            X_test_blocks.append(_poly_design(_normalize(coords_m[i:i + 1]), p))

        if feature_source in ("external", "both") and selected_covs:
            X_sub_blocks.append(np.column_stack([cv[mask] for _, cv, _ in selected_covs]))
            X_test_blocks.append(np.column_stack([cv[i:i + 1] for _, cv, _ in selected_covs]))

        X_sub = np.hstack(X_sub_blocks) if X_sub_blocks else X_train[mask]
        X_test = np.hstack(X_test_blocks) if X_test_blocks else X_train[i:i + 1]

        beta_i, _, _, _ = np.linalg.lstsq(X_sub, v_sub, rcond=None)
        trend_i = float(X_test @ beta_i)
        res_sub = v_sub - X_sub @ beta_i

        fold_base = _compute_variogram_init_params(c_sub, res_sub)
        fold_vp = _model_init_params(selected_model, fold_base)
        ok_i_kwargs: Dict = {}
        if fold_vp is not None:
            ok_i_kwargs["variogram_parameters"] = fold_vp

        try:
            with np.errstate(invalid="ignore", divide="ignore"):
                ok_i = OrdinaryKriging(
                    c_sub[:, 0], c_sub[:, 1], res_sub,
                    variogram_model=selected_model,
                    nlags=max(3, nlags - 1), weight=True,
                    verbose=False, enable_plotting=False,
                    **ok_i_kwargs,
                )
            _enforce_range_floor(ok_i, c_sub, selected_model)
            rk_i, _ = ok_i.execute("points", [coords_m[i, 0]], [coords_m[i, 1]])
            y_cv_t[i] = trend_i + float(rk_i[0])
        except Exception:
            y_cv_t[i] = trend_i

    y_cv = _back_transform(y_cv_t, ttype, shift, lam)
    v_min, v_max = float(np.min(values)), float(np.max(values))
    margin = max(0.1 * (v_max - v_min), 1e-6)
    y_cv = np.clip(y_cv, v_min - margin, v_max + margin)
    cv = compute_metrics(values, y_cv)

    # ── Build result dict ─────────────────────────────────────────────────────
    method_label = (
        "glm" if feature_source == "coords"
        else "cokriging" if feature_source == "external"
        else "regression_kriging_both"
    )
    params: Dict = {
        "method": method_label,
        "feature_source": feature_source,
        "variogram_model": selected_model,
        "transform": ttype,
        "transform_shift": float(shift),
        "transform_lambda": round(float(lam), 6) if lam != 0.0 else None,
        "residual_kriging_used": residual_kriging_used,
        "trend_only_fallback": trend_only_fallback,
        "trend_r2": round(trend_r2, 4),
        "residual_std_ratio": round(residual_std_ratio, 4),
    }
    if feature_source in ("coords", "both"):
        params["degree"] = p
        params["degree_downgraded"] = degree_downgraded
        params["condition_number"] = round(cond_num, 2)

    extra: Dict = {}
    if feature_source in ("external", "both"):
        extra["covariate_info"] = {
            "selected": [code for code, _, _ in selected_covs],
            "pearson_r": pearson_rs,
            "p_values": pearson_pvals,
            "fallback": covariate_fallback,
            "n_covariates": len(selected_covs),
        }
        if feature_source in ("external",):
            params["n_covariates"] = len(selected_covs)

    return z_t.reshape(grid_x.shape), {
        **cv,
        "loocv_predictions": y_cv.tolist(),
        "variogram": vm_info,
        "params": params,
        **extra,
    }


def glm_interpolate(
    coords: np.ndarray, values: np.ndarray,
    grid_x: np.ndarray, grid_y: np.ndarray,
    degree: int = 2,
    transform: str = "auto",
) -> Tuple[np.ndarray, Dict]:
    """Alias → regression_kriging(feature_source='coords'). Preserved for API compatibility."""
    return regression_kriging(
        coords, values, grid_x, grid_y,
        feature_source="coords", degree=degree, transform=transform,
    )


# ─── Co-Kriging (Regression Kriging con co-variables auxiliares) ─────────────

def _idw_at_points(
    coords_m: np.ndarray, values: np.ndarray, query_m: np.ndarray, power: float = 2.0
) -> np.ndarray:
    """IDW prediction of scalar field at arbitrary query points from known coords."""
    result = np.zeros(len(query_m))
    for i, q in enumerate(query_m):
        dx = q[0] - coords_m[:, 0]
        dy = q[1] - coords_m[:, 1]
        dist = np.sqrt(dx ** 2 + dy ** 2)
        dist = np.where(dist < 1e-6, 1e-6, dist)
        w = 1.0 / (dist ** power)
        result[i] = np.sum(w * values) / np.sum(w)
    return result


def cokriging_interpolate(
    coords: np.ndarray, values: np.ndarray,
    grid_x: np.ndarray, grid_y: np.ndarray,
    covariates: Optional[List[dict]] = None,
    transform: str = "auto",
) -> Tuple[np.ndarray, Dict]:
    """Alias → regression_kriging(feature_source='external'). Preserved for API compatibility."""
    return regression_kriging(
        coords, values, grid_x, grid_y,
        feature_source="external",
        external_covariates=covariates,
        transform=transform,
    )


# ─── Random Forest + Kriging de residuos ─────────────────────────────────────

def rfk_interpolate(
    coords: np.ndarray, values: np.ndarray,
    grid_x: np.ndarray, grid_y: np.ndarray,
    transform: str = "auto",
) -> Tuple[np.ndarray, Dict]:
    """
    Random Forest + Kriging of residuals. Requires ≥ 20 points.
    Uses auto-selected variogram for residuals (not fixed 'spherical').
    """
    n = len(values)
    if n < 20:
        z_idw, idw_metrics = idw_interpolate(coords, values, grid_x, grid_y, transform=transform)
        return z_idw, {
            **idw_metrics,
            "error": f"RF-Kriging requiere ≥ 20 puntos ({n} disponibles); se usó IDW.",
            "params": {
                **idw_metrics.get("params", {}),
                "method": "idw-fallback",
                "degenerate_fallback": True,
                "degenerate_reason": {
                    "check": "rfk_insufficient_points",
                    "required": 20,
                    "available": int(n),
                    "fallback": "idw",
                },
            },
        }

    v, ttype, shift, lam = _preprocess_values(values, force_transform=transform)
    coords_m = _deg_to_m(coords)
    grid_pts_m = _grid_coords_m(grid_x, grid_y, coords)
    nlags = min(10, max(5, n // 3))

    try:
        def make_features(c: np.ndarray) -> np.ndarray:
            x, y = c[:, 0], c[:, 1]
            return np.column_stack([x, y, x ** 2, y ** 2, x * y])

        scaler = StandardScaler()
        X = scaler.fit_transform(make_features(coords_m))
        X_grid = scaler.transform(make_features(grid_pts_m))

        rf = RandomForestRegressor(n_estimators=150, random_state=42, n_jobs=-1)
        rf.fit(X, v)
        residuals = v - rf.predict(X)

        # Auto-select variogram for residuals
        selected_model = _select_best_variogram(coords_m, residuals)

        # Build init_params from residual statistics (same fix as GLM)
        init_res = _compute_variogram_init_params(coords_m, residuals)
        model_vp = _model_init_params(selected_model, init_res)
        ok_kwargs: Dict = {}
        if model_vp is not None:
            ok_kwargs["variogram_parameters"] = model_vp

        with np.errstate(invalid="ignore", divide="ignore"):
            ok = OrdinaryKriging(
                coords_m[:, 0], coords_m[:, 1], residuals,
                variogram_model=selected_model,
                nlags=nlags, weight=True,
                verbose=False, enable_plotting=False,
                **ok_kwargs,
            )
        _enforce_range_floor(ok, coords_m, selected_model)
        res_grid, _ = ok.execute("points", grid_pts_m[:, 0], grid_pts_m[:, 1])
        z_t = rf.predict(X_grid) + np.array(res_grid)
        # z_t is in transformed space — raster returned in transformed space

        # Output clamp in transformed space: prevent wild extrapolation
        vt_min, vt_max = float(np.min(v)), float(np.max(v))  # v is transformed
        vt_margin = max(0.1 * (vt_max - vt_min), 1e-6)
        z_t = np.clip(z_t, vt_min - vt_margin, vt_max + vt_margin)

        v_min, v_max = float(np.min(values)), float(np.max(values))  # original scale for LOOCV
        margin = max(0.1 * (v_max - v_min), 1e-6)

        # LOOCV
        y_cv_t = np.zeros(n)
        for i in range(n):
            mask = np.arange(n) != i
            rf_i = RandomForestRegressor(n_estimators=50, random_state=42)
            rf_i.fit(X[mask], v[mask])
            res_i = v[mask] - rf_i.predict(X[mask])
            rf_pi = float(rf_i.predict(X[i:i + 1])[0])

            fold_base = _compute_variogram_init_params(coords_m[mask], res_i)
            fold_vp = _model_init_params(selected_model, fold_base)
            ok_kwargs_i: Dict = {}
            if fold_vp is not None:
                ok_kwargs_i["variogram_parameters"] = fold_vp

            try:
                with np.errstate(invalid="ignore", divide="ignore"):
                    ok_i = OrdinaryKriging(
                        coords_m[mask, 0], coords_m[mask, 1], res_i,
                        variogram_model=selected_model,
                        nlags=max(3, nlags - 1), weight=True,
                        verbose=False, enable_plotting=False,
                        **ok_kwargs_i,
                    )
                _enforce_range_floor(ok_i, coords_m[mask], selected_model)
                rk_i, _ = ok_i.execute("points", [coords_m[i, 0]], [coords_m[i, 1]])
                y_cv_t[i] = rf_pi + float(rk_i[0])
            except Exception:
                y_cv_t[i] = rf_pi

        y_cv = _back_transform(y_cv_t, ttype, shift, lam)
        y_cv = np.clip(y_cv, v_min - margin, v_max + margin)
        cv = compute_metrics(values, y_cv)

        return z_t.reshape(grid_x.shape), {
            **cv,
            "loocv_predictions": y_cv.tolist(),
            "params": {
                "method": "rfk",
                "n_estimators": 150,
                "variogram_model": selected_model,
                "transform": ttype,
                "transform_shift": float(shift),
                "transform_lambda": round(float(lam), 6) if lam != 0.0 else None,
            },
        }

    except Exception as e:
        z_idw, idw_metrics = idw_interpolate(coords, values, grid_x, grid_y, transform=transform)
        return z_idw, {
            **idw_metrics,
            "error": f"RFK falló, se usó IDW: {str(e)[:120]}",
            "params": {
                **idw_metrics.get("params", {}),
                "method": "idw-fallback",
                "degenerate_fallback": True,
                "degenerate_reason": {
                    "check": "rfk_exception_fallback",
                    "exception": str(e)[:200],
                    "fallback": "idw",
                },
            },
        }


# ─── SVR Spatial ─────────────────────────────────────────────────────────────

def svr_interpolate(
    coords: np.ndarray, values: np.ndarray,
    grid_x: np.ndarray, grid_y: np.ndarray,
    transform: str = "auto",
    kernel: str = "rbf",
    C: Optional[float] = None,
    epsilon: Optional[float] = None,
) -> Tuple[np.ndarray, Dict]:
    """
    SVR espacial con coordenadas y objetivo estandarizados dentro de cada partición.

    - kernel: "rbf" (default), "linear" o "poly".
    - C y gamma: rejilla logarítmica y CV de cinco particiones; una extensión si
      el óptimo está en un extremo. Después se calcula LOOCV con los elegidos.
    - epsilon: ancho del tubo en unidades estandarizadas; por defecto 0.05.
    - Requiere ≥ 5 puntos; fallback a IDW si no se cumple.
    """
    n = len(values)
    if n < 5:
        z_idw, idw_metrics = idw_interpolate(coords, values, grid_x, grid_y, transform=transform)
        return z_idw, {
            **idw_metrics,
            "error": f"SVR requiere ≥ 5 puntos ({n} disponibles); se usó IDW.",
            "params": {
                **idw_metrics.get("params", {}),
                "method": "idw-fallback",
                "degenerate_fallback": True,
                "degenerate_reason": {
                    "check": "svr_insufficient_points",
                    "required": 5,
                    "available": int(n),
                    "fallback": "idw",
                },
            },
        }

    v, ttype, shift, lam = _preprocess_values(values, force_transform=transform)
    coords_m = _deg_to_m(coords)
    grid_pts_m = _grid_coords_m(grid_x, grid_y, coords)

    X, X_grid = coords_m, grid_pts_m

    try:
        # Pipelines fit both coordinate and target scalers inside each fold.
        eps_auto = .05
        eps_val = float(epsilon) if epsilon is not None else eps_auto
        def estimator(c=1., gamma=1.):
            return TransformedTargetRegressor(
                regressor=make_pipeline(StandardScaler(), SVR(kernel=kernel, C=c, gamma=gamma, epsilon=eps_val)),
                transformer=StandardScaler(),
            )
        c_grid = np.logspace(-1, 3, 5) if C is None else np.array([float(C)])
        gamma_grid = np.logspace(-1, 1, 5)
        cv_split = KFold(n_splits=5, shuffle=True, random_state=2026)
        def search(cs, gs):
            tuning = GridSearchCV(estimator(), {
                "regressor__svr__C": cs, "regressor__svr__gamma": gs,
            }, cv=cv_split, scoring="neg_mean_squared_error", n_jobs=1)
            tuning.fit(X, v)
            return tuning
        tuning = search(c_grid, gamma_grid)
        C_val = float(tuning.best_params_["regressor__svr__C"])
        gamma_val = float(tuning.best_params_["regressor__svr__gamma"])
        extend_c = C is None and C_val in (c_grid[0], c_grid[-1])
        extend_gamma = gamma_val in (gamma_grid[0], gamma_grid[-1])
        extended = extend_c or extend_gamma
        if extended:
            if extend_c:
                c_grid = np.unique(np.r_[c_grid, c_grid[0] / 10 if C_val == c_grid[0] else c_grid[-1] * 10])
            if extend_gamma:
                gamma_grid = np.unique(np.r_[gamma_grid, gamma_grid[0] / 10 if gamma_val == gamma_grid[0] else gamma_grid[-1] * 10])
            tuning = search(c_grid, gamma_grid)
            C_val = float(tuning.best_params_["regressor__svr__C"])
            gamma_val = float(tuning.best_params_["regressor__svr__gamma"])
        svr = estimator(C_val, gamma_val)
        svr.fit(X, v)
        z_t = svr.predict(X_grid)

        # Clamp in transformed space to prevent wild extrapolation
        vt_min, vt_max = float(np.min(v)), float(np.max(v))
        vt_margin = max(0.1 * (vt_max - vt_min), 1e-6)
        z_t = np.clip(z_t, vt_min - vt_margin, vt_max + vt_margin)

        v_min, v_max = float(np.min(values)), float(np.max(values))
        margin = max(0.1 * (v_max - v_min), 1e-6)

        # LOOCV in original scale
        y_cv_t = np.zeros(n)
        for i in range(n):
            mask = np.arange(n) != i
            svr_i = estimator(C_val, gamma_val)
            svr_i.fit(X[mask], v[mask])
            y_cv_t[i] = float(svr_i.predict(X[i:i + 1])[0])

        y_cv = _back_transform(y_cv_t, ttype, shift, lam)
        y_cv = np.clip(y_cv, v_min - margin, v_max + margin)
        cv = compute_metrics(values, y_cv)

        # Guard: degenerate surface
        z_grid_bt = _back_transform(z_t, ttype, shift, lam)
        if (v_max - v_min) > 1e-9 and float(np.std(z_grid_bt)) < 0.05 * (v_max - v_min):
            z_idw, idw_m = idw_interpolate(coords, values, grid_x, grid_y, transform=transform)
            return z_idw, {
                **idw_m,
                "error": "SVR produjo superficie degenerada; se usó IDW.",
                "params": {
                    **idw_m.get("params", {}),
                    "method": "idw-fallback",
                    "degenerate_fallback": True,
                    "degenerate_reason": {"check": "svr_degenerate_surface", "fallback": "idw"},
                },
            }

        return z_t.reshape(grid_x.shape), {
            **cv,
            "loocv_predictions": y_cv.tolist(),
            "params": {
                "method": "svr",
                "kernel": kernel,
                "C": round(float(C_val), 4),
                "epsilon": round(float(eps_val), 6),
                "gamma": gamma_val,
                "grid_extended": extended,
                "selection_cv": "5-fold",
                "target_standardized": True,
                "n_support_vectors": int(len(svr.regressor_.named_steps["svr"].support_)),
                "transform": ttype,
                "transform_shift": float(shift),
                "transform_lambda": round(float(lam), 6) if lam != 0.0 else None,
            },
        }

    except Exception as e:
        z_idw, idw_metrics = idw_interpolate(coords, values, grid_x, grid_y, transform=transform)
        return z_idw, {
            **idw_metrics,
            "error": f"SVR falló, se usó IDW: {str(e)[:120]}",
            "params": {
                **idw_metrics.get("params", {}),
                "method": "idw-fallback",
                "degenerate_fallback": True,
                "degenerate_reason": {
                    "check": "svr_exception_fallback",
                    "exception": str(e)[:200],
                    "fallback": "idw",
                },
            },
        }


# ─── F2-08: Anisotropy detection ─────────────────────────────────────────────

def _detect_anisotropy(
    coords: np.ndarray,
    values: np.ndarray,
    directions: Tuple[float, ...] = (0.0, 45.0, 90.0, 135.0),
    tolerance_deg: float = 22.5,
    n_lags: int = 8,
) -> Dict:
    """Compute directional empirical variograms and detect anisotropy.

    F2-08 — Audit AgRegen MVZ v3.1.1 §H-11.
    Calculates the empirical semi-variogram in 4 directions.
    Reports an anisotropy_warning if the lag where the variogram plateaus
    (estimated as 60 % of max lag) differs by factor > 1.5 between directions.

    Returns dict with:
      'directional_sills': {direction: estimated_sill}
      'anisotropy_ratio': max_sill / min_sill
      'anisotropy_warning': bool
      'principal_direction': direction with largest range (proxy for principal axis)
      'warning_msg': human-readable string if warning is True
    """
    coords_m = _deg_to_m(coords)
    n = len(values)
    if n < 8:
        return {"anisotropy_warning": False, "reason": "n < 8"}

    max_dist = float(np.max(_cdist(coords_m, coords_m)))
    lag_size = max_dist / n_lags

    dir_sills: Dict[float, float] = {}

    for direction in directions:
        gammas: List[float] = []
        for lag_idx in range(1, n_lags + 1):
            h_lo = (lag_idx - 1) * lag_size
            h_hi = lag_idx * lag_size
            pairs_gamma: List[float] = []
            for i in range(n):
                for j in range(i + 1, n):
                    dx = coords_m[j, 0] - coords_m[i, 0]
                    dy = coords_m[j, 1] - coords_m[i, 1]
                    dist = float(np.sqrt(dx ** 2 + dy ** 2))
                    if not (h_lo <= dist < h_hi):
                        continue
                    # Check direction tolerance
                    pair_angle = float(np.degrees(np.arctan2(dy, dx))) % 180.0
                    angle_diff = min(
                        abs(pair_angle - direction),
                        180.0 - abs(pair_angle - direction),
                    )
                    if angle_diff <= tolerance_deg:
                        pairs_gamma.append((values[j] - values[i]) ** 2)
            if pairs_gamma:
                gammas.append(0.5 * float(np.mean(pairs_gamma)))

        if gammas:
            # Estimate sill as the mean of the upper 40 % of variogram values
            gammas_arr = np.array(gammas)
            sill_est = float(np.mean(gammas_arr[int(0.6 * len(gammas_arr)):]))
            dir_sills[direction] = max(sill_est, 1e-12)

    if len(dir_sills) < 2:
        return {"anisotropy_warning": False, "reason": "insufficient directional pairs"}

    max_sill = max(dir_sills.values())
    min_sill = max(min(dir_sills.values()), 1e-12)
    ratio = max_sill / min_sill
    principal_dir = max(dir_sills, key=lambda d: dir_sills[d])
    warning = ratio > 1.5

    result: Dict = {
        "directional_sills": {str(k): round(v, 6) for k, v in dir_sills.items()},
        "anisotropy_ratio": round(float(ratio), 3),
        "anisotropy_warning": warning,
        "principal_direction": float(principal_dir),
    }
    if warning:
        result["warning_msg"] = (
            f"Anisotropía detectada: ratio de rango {ratio:.2f} (> 1.5). "
            f"Dirección principal: {principal_dir}°. "
            "El mapa puede estar sesgado — considere incluir la dirección dominante del campo."
        )
    return result


# ─── Auto-selección del mejor método ─────────────────────────────────────────

def interpolate_auto_best(
    coords: np.ndarray, values: np.ndarray,
    grid_x: np.ndarray, grid_y: np.ndarray,
    transform: str = "auto",
    covariates: Optional[List[dict]] = None,
) -> Tuple[np.ndarray, Dict, str]:
    """
    Runs IDW, Kriging, RBF and GLM (always).
    F2-02: RFK only if n ≥ 30 AND at least one covariate with |r| ≥ 0.4 AND p < 0.10.
    Co-Kriging if n ≥ 8 and covariates pass the gate (|r| ≥ 0.4 AND p < 0.10).
    Picks the method with the lowest LOOCV RMSE (original scale).
    Returns (z, metrics, method_name).
    """
    n = len(values)
    candidates: Dict = {}

    _methods = [
        ("idw",     idw_interpolate,     {"power": None, "k": None, "transform": transform}),
        ("kriging", kriging_interpolate, {"variogram_model": "auto", "transform": transform}),
        ("rbf",     rbf_interpolate,     {"kernel": "auto", "transform": transform}),
        ("glm",     glm_interpolate,     {"degree": 2, "transform": transform}),
        ("svr",     svr_interpolate,     {"kernel": "rbf", "C": None, "transform": transform}),
    ]

    for name, fn, kwargs in _methods:
        try:
            z_, m_ = fn(coords, values, grid_x, grid_y, **kwargs)
            if m_.get("rmse") is not None:
                candidates[name] = (z_, m_)
        except Exception:
            pass

    # F2-02: RFK requires n ≥ 30 AND at least one covariate with |r| ≥ 0.4 AND p < 0.10
    if n >= 30 and covariates:
        has_useful_cov = False
        for cov in covariates:
            raw = cov.get("values", [])
            if not raw or len(raw) != n:
                continue
            cov_arr = np.array(raw, dtype=float)
            if np.std(cov_arr) < 1e-12:
                continue
            try:
                r_val, p_val = pearsonr(values, cov_arr)
                if np.isfinite(r_val) and abs(r_val) >= 0.4 and p_val < 0.10:
                    has_useful_cov = True
                    break
            except Exception:
                pass
        if has_useful_cov:
            try:
                z_rfk, m_rfk = rfk_interpolate(coords, values, grid_x, grid_y, transform=transform)
                if m_rfk.get("rmse") is not None and "idw-fallback" not in str(m_rfk.get("params", {})):
                    candidates["rfk"] = (z_rfk, m_rfk)
            except Exception:
                pass

    if n >= 8 and covariates:
        try:
            z_cok, m_cok = cokriging_interpolate(
                coords, values, grid_x, grid_y,
                covariates=covariates, transform=transform,
            )
            cov_info = m_cok.get("covariate_info", {})
            # Only include in candidates if at least one co-variable was used (no fallback)
            if m_cok.get("rmse") is not None and not cov_info.get("fallback", True):
                candidates["cokriging"] = (z_cok, m_cok)
        except Exception:
            pass

    if not candidates:
        z_fb, m_fb = idw_interpolate(coords, values, grid_x, grid_y, power=2.0, k=None, transform=transform)
        return z_fb, {
            **m_fb,
            "params": {
                **m_fb.get("params", {}),
                "method": "idw-absolute-fallback",
            },
        }, "idw"

    def _rmse(name: str) -> float:
        v = candidates[name][1].get("rmse")
        return float("inf") if v is None else float(v)

    best_method = min(candidates, key=_rmse)
    z_best, m_best = candidates[best_method]
    m_best["auto_selection"] = {
        nm: round(float(m["rmse"]), 4) if m.get("rmse") is not None else -1
        for nm, (_, m) in candidates.items()
    }
    m_best["selected_method"] = best_method
    return z_best, m_best, best_method

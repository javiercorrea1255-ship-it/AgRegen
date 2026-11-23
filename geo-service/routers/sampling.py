"""
F2-09: Sampling router — health, grid, sample-size, diagnose endpoints.
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any, Literal
from shapely.geometry import Polygon as ShapelyPolygon

from services.grid_generator import generate_grid, optimal_sample_size
from routers.shared import (
    SamplingPoint, HealthResponse, _safe_error,
)

router = APIRouter()


class GridRequest(BaseModel):
    polygon: List[List[float]] = Field(..., description="[[lon, lat], ...]")
    n_points: int = Field(default=25, ge=3, le=200)
    grid_type: str = Field(default="regular", description="regular | hexagonal | stratified")
    buffer_m: float = Field(default=5.0, ge=0.0, le=50.0, description="Interior buffer in metres (F1-01). Default 5 m prevents edge sampling.")


class SampleSizeRequest(BaseModel):
    purpose: Literal["mapping", "mean"] = "mapping"
    polygon: List[List[float]] = Field(..., description="[[lon, lat], ...]")
    cv_pct: float = Field(default=30.0, ge=5.0, le=100.0)
    precision_pct: float = Field(default=20.0, ge=5.0, le=50.0)
    range_m: float = Field(default=300.0, ge=10.0, le=5000.0)
    confidence_level: int = Field(default=90, description="90, 95 or 99")
    variable_code: Optional[str] = Field(default=None, description="Variable code (P, pH, MOS…) — uses agronomic priors (F1-03)")


class DiagnoseRequest(BaseModel):
    points: List[SamplingPoint] = Field(..., description="Puntos con valores medidos")
    polygon: Optional[List[List[float]]] = Field(
        default=None, description="[[lon, lat], ...] — usado para el NN-ratio espacial"
    )
    variable_code: Optional[str] = Field(
        default=None, description="Código de variable (P, K, pH, MOS, …) para priors agronómicos"
    )


class TransformDiagnostic(BaseModel):
    name: str
    skewness: float
    feasible: bool


class TransformRecommendation(BaseModel):
    suggested: str
    needs_transform: bool
    reason: str


class DiagnoseResponse(BaseModel):
    n: int
    mean: float
    std: float
    min: float
    max: float
    median: float
    q1: float
    q3: float
    iqr: float
    has_non_positive: bool
    cv_pct: float
    skewness: float
    skewness_level: str
    outlier_count: int
    outlier_pct: float
    nn_ratio: Optional[float]
    clustering_level: str
    zero_variance: bool
    duplicate_coords: bool
    duplicate_point_pairs: List[List[int]]
    recommended_transform: str
    recommended_method: str
    transform_recommendation: TransformRecommendation
    transform_diagnostics: List[TransformDiagnostic]
    warnings: List[str]
    ok_to_interpolate: bool
    n_submuestras_total: int = Field(default=0, description="F2-07: Total sub-samples across all GPS points")


@router.get("/health", response_model=HealthResponse)
def handle_health():
    return {"status": "ok", "version": "3.1.1"}


@router.post("/grid")
@router.post("/sampling-grid", include_in_schema=False)
def handle_grid(req: GridRequest):
    try:
        return generate_grid(req.polygon, req.n_points, req.grid_type, buffer_m=req.buffer_m)
    except Exception as e:
        raise HTTPException(status_code=500, detail=_safe_error(e, "grid"))


@router.post("/sample-size")
def handle_sample_size(req: SampleSizeRequest):
    try:
        return optimal_sample_size(
            polygon=req.polygon,
            cv_pct=req.cv_pct,
            precision_pct=req.precision_pct,
            range_m=req.range_m,
            confidence_level=req.confidence_level,
            variable_code=req.variable_code,
            purpose=req.purpose,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=_safe_error(e, "sample-size"))


@router.post("/diagnose", response_model=DiagnoseResponse)
async def handle_diagnose(req: DiagnoseRequest) -> DiagnoseResponse:
    from services.interpolation import _deg_to_m
    from scipy.stats import skew as scipy_skew

    def _try_transform_skew(vals: np.ndarray, transform: str) -> tuple:
        if transform == "none":
            return round(float(scipy_skew(vals)), 3), True
        has_non_pos = bool(np.any(vals <= 0))
        if transform in ("log1p", "boxcox") and has_non_pos:
            shift = abs(float(np.min(vals))) + 1.0
            shifted = vals + shift
        else:
            shifted = vals.copy()
        try:
            if transform == "sqrt":
                t = np.sqrt(np.maximum(shifted, 0))
            elif transform == "log1p":
                t = np.log1p(shifted)
            elif transform == "boxcox":
                from scipy.stats import boxcox as scipy_boxcox
                t, _ = scipy_boxcox(shifted + 1e-8)
            else:
                return float(scipy_skew(vals)), True
            return round(float(scipy_skew(t)), 3), True
        except Exception:
            return 0.0, False

    try:
        pts = req.points
        if len(pts) < 3:
            raise HTTPException(status_code=400, detail="Se necesitan al menos 3 puntos medidos")

        vals = np.array([p.value for p in pts], dtype=float)
        lons = np.array([p.lon for p in pts], dtype=float)
        lats = np.array([p.lat for p in pts], dtype=float)

        n = len(vals)
        mean = float(np.mean(vals))
        std = float(np.std(vals, ddof=1)) if n > 1 else 0.0
        cv_pct = (std / abs(mean) * 100) if abs(mean) > 1e-12 else 0.0

        vmin = float(np.min(vals))
        vmax = float(np.max(vals))
        median = float(np.median(vals))
        q1 = float(np.percentile(vals, 25))
        q3 = float(np.percentile(vals, 75))
        iqr = q3 - q1
        has_non_positive = bool(np.any(vals <= 0))

        zero_variance = bool(std < 1e-10)

        coords = np.column_stack([lons, lats])
        coords_m = _deg_to_m(coords)
        duplicate_coords = False
        duplicate_point_pairs: List[List[int]] = []
        for i in range(len(coords_m)):
            for j in range(i + 1, len(coords_m)):
                d = np.linalg.norm(coords_m[i] - coords_m[j])
                if d < 1.0:
                    duplicate_coords = True
                    duplicate_point_pairs.append([i, j])

        sk = float(scipy_skew(vals)) if n >= 3 else 0.0
        if abs(sk) > 1.0:
            skewness_level = "high"
        elif abs(sk) > 0.5:
            skewness_level = "moderate"
        else:
            skewness_level = "low"

        if iqr > 1e-12:
            lo = q1 - 3 * iqr
            hi = q3 + 3 * iqr
            outlier_count = int(np.sum((vals < lo) | (vals > hi)))
        else:
            outlier_count = int(np.sum(vals != q1))
        outlier_pct = outlier_count / n * 100

        nn_ratio: Optional[float] = None
        clustering_level = "good"
        if req.polygon and len(req.polygon) >= 3:
            try:
                poly = ShapelyPolygon(req.polygon)
                area_m2 = float(poly.area) * (111_320 ** 2)
                if area_m2 > 0 and n >= 2:
                    from sklearn.neighbors import BallTree
                    rad_lats = np.radians(lats)
                    rad_lons = np.radians(lons)
                    tree = BallTree(np.column_stack([rad_lats, rad_lons]), metric="haversine")
                    nn_dists, _ = tree.query(np.column_stack([rad_lats, rad_lons]), k=2)
                    observed_mean = float(np.mean(nn_dists[:, 1])) * 6_371_000
                    density = n / area_m2
                    expected_mean = 1 / (2 * np.sqrt(density))
                    nn_ratio = round(observed_mean / expected_mean, 3) if expected_mean > 0 else None
                    if nn_ratio is not None:
                        if nn_ratio < 0.5:
                            clustering_level = "clustered"
                        elif nn_ratio < 0.75:
                            clustering_level = "moderate"
                        else:
                            clustering_level = "good"
            except Exception:
                pass

        transform_diagnostics: List[TransformDiagnostic] = []
        for tname in ("none", "sqrt", "log1p", "boxcox"):
            t_sk, feasible = _try_transform_skew(vals, tname)
            transform_diagnostics.append(TransformDiagnostic(name=tname, skewness=t_sk, feasible=feasible))

        feasible_transforms = [(td.name, abs(td.skewness)) for td in transform_diagnostics if td.feasible]
        best_transform_name = min(feasible_transforms, key=lambda x: x[1])[0] if feasible_transforms else "none"
        best_transform_skew = min(feasible_transforms, key=lambda x: x[1])[1] if feasible_transforms else abs(sk)

        vc = (req.variable_code or "").upper()
        log_preferred_vars = {"P", "ZN", "CU", "B", "MN"}
        if vc in log_preferred_vars and any(td.name == "log1p" and td.feasible for td in transform_diagnostics):
            log1p_td = next(td for td in transform_diagnostics if td.name == "log1p")
            if abs(log1p_td.skewness) < abs(sk) * 1.2:
                best_transform_name = "log1p"
                best_transform_skew = abs(log1p_td.skewness)

        high_skew = abs(sk) >= 0.5
        high_outliers = outlier_pct >= 10.0
        transform_helps = best_transform_skew < abs(sk) * 0.8
        needs_transform = (high_skew or high_outliers) and transform_helps

        if not needs_transform:
            recommended_transform = "none"
            if high_skew or high_outliers:
                transform_reason = (
                    f"Se detectó sesgo moderado ({sk:+.2f})"
                    + (f" y {outlier_pct:.0f}% de valores atípicos" if high_outliers else "")
                    + ", pero ninguna transformación reduce el sesgo sustancialmente. Se interpolará con datos originales."
                )
            else:
                transform_reason = "Distribución aceptablemente simétrica (|sesgo| < 0.5, atípicos < 10%). No se requiere transformación."
        else:
            recommended_transform = best_transform_name
            outlier_note = f"; {outlier_pct:.0f}% de valores atípicos detectados" if high_outliers else ""
            transform_reason = (
                f"Sesgo {sk:+.2f}{outlier_note} → transformación '{best_transform_name}' reduce sesgo a {best_transform_skew:+.2f}."
            )

        transform_recommendation = TransformRecommendation(
            suggested=recommended_transform,
            needs_transform=needs_transform,
            reason=transform_reason,
        )

        if n >= 8:
            recommended_method = "kriging"
        else:
            recommended_method = "idw"

        warnings: List[str] = []
        if zero_variance:
            warnings.append("Todos los valores son idénticos: se generará una sola zona.")
        if duplicate_coords:
            warnings.append("Coordenadas duplicadas (< 1 m): se promediarán sus valores antes de interpolar.")
        if outlier_count > 0:
            warnings.append(f"{outlier_count} valor{'es' if outlier_count > 1 else ''} atípico{'s' if outlier_count > 1 else ''} (fuera de 3×IQR). Considera winsorización.")
        if clustering_level == "clustered":
            warnings.append(f"NN-Ratio={nn_ratio}: puntos muy agrupados. Redistribúyelos para mejorar la interpolación.")
        elif clustering_level == "moderate":
            warnings.append(f"NN-Ratio={nn_ratio}: agrupamiento moderado. Intenta distribuir mejor los puntos.")
        if cv_pct > 100:
            warnings.append(f"CV={cv_pct:.0f}%: variabilidad muy alta. Asegúrate de tener suficientes muestras.")
        if n < 10:
            warnings.append(f"Solo {n} puntos. Se recomiendan ≥ 10 para resultados confiables.")
        if has_non_positive and needs_transform and recommended_transform in ("log1p", "boxcox"):
            warnings.append("Valores ≤ 0 detectados. Se aplicará desplazamiento automático antes de la transformación logarítmica.")

        unique_coords = []
        for coord in coords_m:
            if not any(np.linalg.norm(coord - other) < 1 for other in unique_coords):
                unique_coords.append(coord)
        ok_to_interpolate = len(unique_coords) >= 3
        n_submuestras_total = sum(getattr(p, "composite_n", 1) for p in req.points)

        return DiagnoseResponse(
            n=n,
            mean=round(mean, 4),
            std=round(std, 4),
            min=round(vmin, 4),
            max=round(vmax, 4),
            median=round(median, 4),
            q1=round(q1, 4),
            q3=round(q3, 4),
            iqr=round(iqr, 4),
            has_non_positive=has_non_positive,
            cv_pct=round(cv_pct, 1),
            skewness=round(sk, 3),
            skewness_level=skewness_level,
            outlier_count=outlier_count,
            outlier_pct=round(outlier_pct, 1),
            nn_ratio=nn_ratio,
            clustering_level=clustering_level,
            zero_variance=zero_variance,
            duplicate_coords=duplicate_coords,
            duplicate_point_pairs=duplicate_point_pairs,
            recommended_transform=recommended_transform,
            recommended_method=recommended_method,
            transform_recommendation=transform_recommendation,
            transform_diagnostics=transform_diagnostics,
            warnings=warnings,
            ok_to_interpolate=ok_to_interpolate,
            n_submuestras_total=n_submuestras_total,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=_safe_error(e, "diagnose"))

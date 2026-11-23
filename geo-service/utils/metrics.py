import numpy as np
from typing import Dict


def compute_metrics(y_true: np.ndarray, y_pred: np.ndarray) -> Dict[str, float]:
    """RMSE, MAE, R², ME, MSDR entre valores verdaderos y predichos."""
    residuals = y_true - y_pred
    n = len(y_true)
    rmse = float(np.sqrt(np.mean(residuals ** 2)))
    mae = float(np.mean(np.abs(residuals)))
    me = float(np.mean(residuals))
    ss_res = np.sum(residuals ** 2)
    ss_tot = np.sum((y_true - np.mean(y_true)) ** 2)
    r2 = float(1 - ss_res / ss_tot) if ss_tot > 1e-12 else 0.0
    # Mean Squared Deviation Ratio — ratio of estimated variance to actual MSE
    # MSDR ≈ 1 when kriging variance matches actual error; >1 → over-smooth
    var_est = float(np.var(y_true)) if np.var(y_true) > 1e-12 else 1.0
    msdr = float(np.mean(residuals ** 2) / var_est)
    return {"rmse": rmse, "mae": mae, "r2": r2, "r2_loocv": r2, "me": me, "mse_ratio": msdr}


def loocv_idw(coords: np.ndarray, values: np.ndarray, power: float = 2.0) -> Dict[str, float]:
    """Leave-One-Out CV para IDW."""
    n = len(values)
    y_pred = np.zeros(n)
    for i in range(n):
        mask = np.arange(n) != i
        cx, cy = coords[mask, 0], coords[mask, 1]
        vx = values[mask]
        dx = coords[i, 0] - cx
        dy = coords[i, 1] - cy
        dist = np.sqrt(dx**2 + dy**2)
        dist = np.where(dist < 1e-12, 1e-12, dist)
        w = 1.0 / (dist ** power)
        y_pred[i] = np.sum(w * vx) / np.sum(w)
    return compute_metrics(values, y_pred)

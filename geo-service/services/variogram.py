"""Empirical variograms and bounded Cressie WLS (PyKrige effective ranges).

The objective is sum N(h) * [gamma_emp(h)/gamma_model(h) - 1]^2.
psill is the structural/partial sill; sill = psill + nugget.
"""
import numpy as np
from scipy.optimize import least_squares
from scipy.spatial.distance import pdist
from scipy.special import inv_boxcox

MODELS = ("spherical", "exponential", "gaussian")


def semivariance(model, h, psill, range_, nugget):
    t = np.asarray(h, dtype=float) / max(float(range_), 1e-12)
    if model == "spherical":
        structure = np.where(t < 1, 1.5 * t - 0.5 * t ** 3, 1.0)
    elif model == "exponential":
        structure = 1 - np.exp(-3 * t)
    elif model == "gaussian":
        structure = 1 - np.exp(-(t * 7 / 4) ** 2)
    else:
        raise ValueError(f"Unsupported fitted variogram: {model}")
    return nugget + psill * structure


def empirical_variogram(coords, values):
    distances = pdist(coords)
    differences = pdist(np.asarray(values).reshape(-1, 1), metric="sqeuclidean") / 2
    if not len(distances):
        return []
    cutoff = distances.max() / 2
    keep = (distances > 0) & (distances <= cutoff)
    d, g = distances[keep], differences[keep]
    # Quantile classes avoid empty short-distance classes in jittered grids.
    # At most 12 classes; every class includes at least 30 distinct pairs.
    bins = min(12, len(d) // 30)
    while bins >= 1:
        edges = np.unique(np.quantile(d, np.linspace(0, 1, bins + 1)))
        groups = np.digitize(d, edges[1:-1], right=True)
        counts = [int(np.sum(groups == i)) for i in range(len(edges) - 1)]
        if counts and min(counts) >= 30:
            return [{"distance": float(np.mean(d[groups == i])),
                     "semivariance": float(np.mean(g[groups == i])),
                     "n_pairs": count} for i, count in enumerate(counts)]
        bins -= 1
    return []


def fit_variogram(coords, values, model, range_init=None, sill_init=None):
    d = pdist(coords)
    positive = d[d > 0]
    maximum = max(float(d.max()) if len(d) else 1., 1e-6)
    minimum = max(float(positive.min()) if len(positive) else 1e-6, 1e-6)
    variance = max(float(np.var(values)), 1e-10)
    initial = {"psill": float(sill_init or variance),
               "range": float(range_init or maximum / 2),
               "nugget": max(variance * .1, 1e-10)}
    empirical = empirical_variogram(coords, values)
    info = {"model": model, "status": "fallback", "fit_status": "respaldo",
            "empirical": empirical, "range_convention": "PyKrige effective range (metres)",
            "fallback_reason": None}
    reason = ("fewer_than_15_points" if len(values) < 15 else
              "insufficient_lag_classes" if len(empirical) < 3 else
              "constant_values" if np.std(values) < 1e-10 else
              "unsupported_model" if model not in MODELS else None)
    params = dict(initial)
    if reason is None:
        h = np.array([b["distance"] for b in empirical])
        g = np.array([b["semivariance"] for b in empirical])
        weight = np.sqrt([b["n_pairs"] for b in empirical])
        lower = [max(variance * 1e-9, 1e-12), minimum, 0.]
        upper = [np.inf, max(maximum, minimum * 1.0001), np.inf]
        x0 = [max(initial["psill"], lower[0] * 2),
              np.clip(initial["range"], minimum, maximum), initial["nugget"]]
        def residual(p):
            modeled = semivariance(model, h, *p)
            return weight * (g / np.maximum(modeled, variance * 1e-9) - 1)
        try:
            result = least_squares(residual, x0, bounds=(lower, upper),
                                   x_scale=[variance, maximum, variance],
                                   max_nfev=160, ftol=1e-6, xtol=1e-6, gtol=1e-6)
            if not result.success or not np.all(np.isfinite(result.x)):
                raise ValueError("optimizer did not converge")
            params = dict(zip(("psill", "range", "nugget"), map(float, result.x)))
            info.update(status="fitted", fit_status="ajustado", weighted_sse=float(result.fun @ result.fun))
        except (ValueError, FloatingPointError, RuntimeError) as error:
            reason = str(error)
    info.update(params, sill=params["psill"] + params["nugget"], fallback_reason=reason)
    return params, info


def inverse_moments(mu, variance, transform, shift=0., lam=0.):
    """Mean/variance in original units; lognormal exact, Box-Cox delta order 2."""
    mu, variance = np.asarray(mu), np.maximum(np.asarray(variance), 0.)
    if transform == "log1p":
        return np.expm1(mu + variance / 2) - shift, np.expm1(variance) * np.exp(2 * mu + variance)
    if transform == "boxcox":
        if abs(lam) < 1e-7:
            return np.exp(mu + variance / 2) - shift, np.expm1(variance) * np.exp(2 * mu + variance)
        base = np.maximum(1 + lam * mu, 1e-10)
        mean = inv_boxcox((base - 1) / lam, lam) - shift
        mean += .5 * (1 - lam) * base ** (1 / lam - 2) * variance
        return mean, base ** (2 / lam - 2) * variance
    if transform == "sqrt":
        return np.maximum(mu, 0.) ** 2 - shift, 4 * np.maximum(mu, 0.) ** 2 * variance
    return mu.copy(), variance

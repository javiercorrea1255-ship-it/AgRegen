"""Use the same versioned NDVI table as the Node service."""
import json
from math import isfinite
from pathlib import Path

RULE_FILE = Path(__file__).resolve().parents[2] / "shared" / "ndvi-nitrogen-rules.json"
RULES = json.loads(RULE_FILE.read_text(encoding="utf-8"))


def ndvi_nitrogen_rule(mean: float) -> dict:
    """Select a band without rounding; the upper limit is exclusive."""
    if isinstance(mean, bool) or not isinstance(mean, (int, float)) or not isfinite(mean) or not -1 <= mean <= 1:
        raise ValueError("El NDVI debe estar entre -1 y 1.")
    for band in RULES["bands"]:
        if band["upperExclusive"] is None or mean < band["upperExclusive"]:
            return {**{key: band[key] for key in ("dose", "label")},
                    "unit": RULES["unit"], "version": RULES["version"]}
    raise ValueError("La tabla NDVI no cubre el valor.")

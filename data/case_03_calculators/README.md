# Case 03 — AgRegen 5.0 Calculators: Worked Examples

## Overview

This dataset contains two fully worked examples for the AgRegen 5.0 agronomic
calculators. All formulas, intermediate values, and results are shown explicitly
so reviewers can verify the calculations without running the platform.

## Calculator 1 — Soil Amendments (Enmiendas Químicas y Orgánicas)

**File:** `amendments_example.json`

**Scenario:** Strongly acidic soil (pH 4.43) typical of the San José field
(Case 02). Three amendments diagnosed: **liming, organic carbon, potassium**.

**Algorithm highlights:**

| Step | Formula | Result |
|---|---|---|
| Soil factor k | `profundidad_cm × DA (t/m³)` | `30 × 1.3 = 39` |
| Δ meq Ca | `(ΔCa% / 100) × CIC` | `(10/100) × 18.5 = 1.85 meq/100g` |
| Lime dose | `Δmeq × k × MW_CaCO₃/2` | `1.85 × 39 × 50.04 = 3,612 kg/ha` |
| K dose | `Δmeq × k × MW_K / eff_K₂SO₄` | `962 kg/ha K₂SO₄` |

**References:**
- Oseguera-Pérez et al. (2018). Manual de Enmiendas Químicas y Orgánicas.
- NOM-021-SEMARNAT-2000. Especificaciones de fertilidad, salinidad y clasificación de suelos.

---

## Calculator 2 — Nutrition & Biostimulation Program

**File:** `nutrition_example.json`

**Scenario:** Maize (*Zea mays* L.) under drip irrigation, 15 t/ha yield target.

**Algorithm (Oseguera y Sánchez, 2015):**

```
SUM_nutrient = ppm_soil × PS_kg_ha / 1,000,000
DEM_nutrient = yield_t_ha × removal_kg_t
resultado     = (SUM - DEM) × efficiency_factor
dosis         = max(0, resultado × adjustment_factor)
N_ajustado    = dosis_N - N_mineralizado - N_organic_amendments
```

| Nutrient | SUM (kg/ha) | DEM (kg/ha) | Dosis (kg/ha) |
|---|---|---|---|
| N | 729.0 | 330.0 | 119.7 → **6.1 kg/ha** (after Nm) |
| P₂O₅ | 789.2 | 120.0 | 250.95 |
| K₂O | 9,035 | 300.0 | 2,409 (K excess, credit) |

**References:**
- Oseguera, H. y Sánchez, J. (2015). Calculadora de Nutrición y Bioestimulación.
- NOM-021-SEMARNAT-2000.

---

## Quick Start

```bash
node demo/run_calculators.js
```

Runs both calculators in pure Node.js, verifies all intermediate values,
and writes `outputs/case_03_calculators/run_report.json`.

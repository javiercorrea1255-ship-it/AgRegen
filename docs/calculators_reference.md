# AgRegen 5.0 — Calculators Algorithm Reference

## Overview

AgRegen 5.0 includes two agronomic calculators implemented as pure-frontend
TypeScript engines (no server-side computation required):

1. **Amendments Calculator** (`client/src/lib/amendments/engine.ts`) — computes
   doses of agricultural lime, gypsum, dolomite, Mg, K, and organic matter
   based on soil cation exchange data.

2. **Nutrition & Biostimulation Calculator** (`client/src/lib/nutrition-calculator.ts`) —
   computes macronutrient and micronutrient fertiliser programs based on crop
   yield target, soil analysis, and irrigation water quality.

Both calculators are based on the methodology of Oseguera y Sánchez (2015) and
comply with NOM-021-SEMARNAT-2000.

---

## Calculator 1 — Soil Amendments

### Inputs

| Symbol | Variable | Unit |
|---|---|---|
| `pH` | Soil pH (1:2 water) | dimensionless |
| `CIC` | Cation exchange capacity | meq/100 g |
| `%Ca`, `%Mg`, `%K`, `%Na`, `%H`, `%Al` | Cation saturations | % |
| `%MO` | Organic matter | % |
| `d` | Sampling depth | cm |
| `DA` | Bulk density | t/m³ |
| `A` | Parcel area | ha |

### Conversion factor k

```
k = d × DA          [units: cm × t/m³ ≡ t soil / (ha · meq/100g)]
```

This factor converts from meq/100 g to kg/ha and is the foundation of every
amendment dose formula.

### Module formulas

#### Encalado (CaCO₃ — agricultural lime)
Activated when: `pH < 5.5`

```
Δ%Ca   = target_Ca% - observed_Ca%
Δmeq   = (Δ%Ca / 100) × CIC
dose   = Δmeq × k × 50.04        [kg/ha]
         ^^^^^^^^^^^^^^^^^^^^
         MW(CaCO₃)/2 = 50.04 g/meq
```

#### Magnesio (MgSO₄·7H₂O)
Activated when: `Ca/Mg > 6` OR `Mg/K < 2`

```
dose = Δmeq_Mg × k × 121.5      [kg/ha]
       ^^^^^^^^^^^^^^^^^^^^^^^^^^^
       MW(MgSO₄·7H₂O)/2 = 123.2 → adjusted to 121.5 for 10% Mg content
```

#### Potasio (K₂SO₄, 44% K)
Activated when: `%K < 5%`

```
kg_K = Δmeq_K × k × 39.1        [kg elemental K / ha]
dose = kg_K / 0.44               [kg K₂SO₄ / ha]
```

#### Sodio/Enyesado (CaSO₄·2H₂O — gypsum)
Sodio activated when `%Na > 5`; enyesado when `%Ca < 65% && %Na ≤ 5%`

```
dose = Δmeq × k × 86.09         [kg/ha]
       ^^^^^^^^^^^^^^^^^^^^
       MW(CaSO₄·2H₂O)/2 = 86.09 g/meq
```

#### Dolomita (CaCO₃ + MgCO₃)
Activated when: `%Ca < 65% && %Mg < 20%`

```
dose = Δmeq_Ca × k × 46.1       [kg/ha]
       ^^^^^^^^^^^^^^^^^^^^^^^^^^^
       average MW/2 of dolomite
```

#### Carbono (organic matter amendment)
Activated when: `%MO < 1.6%`

```
soil_mass = (d/100) × 10000 × DA             [t/ha]
dose = (Δ%MO × VAN_BEMMELEN × soil_mass) / %C_material   [t/ha]
                 ^^^^^^^^^^^
                 0.58  (Walkley-Black factor: %MO = %C × 1.724 → %C = %MO/1.724 ≈ %MO × 0.58)
```

### Diagnosis scoring

```
active_modules = count of triggered modules
status:
  0 active  → "óptimo"
  1–2       → "aceptable"
  3–4       → "deficiente"
  ≥5        → "crítico"
```

### Worked example (San José representative soil)

| Input | Value |
|---|---|
| pH | 4.43 |
| CIC | 18.5 meq/100 g |
| %Ca / %Mg / %K | 58% / 12% / 3.5% |
| %MO | 1.2% |
| Depth / Bulk density | 30 cm / 1.3 t/m³ |
| Area | 3.24 ha |

**k = 30 × 1.3 = 39**

| Amendment | Formula | Dose (kg/ha) | Total (kg) |
|---|---|---|---|
| CaCO₃ | 1.85 × 39 × 50.04 | 3,610 | 11,697 |
| K₂SO₄ | 0.2775 × 39 × 39.1 / 0.44 | 962 | 3,116 |
| Compost (30% C) | ΔMO=1.8% × 0.58 × 3900 / 30 | 135.7 t/ha | 439.7 t |

---

## Calculator 2 — Nutrition & Biostimulation Program

### Inputs

| Block | Variables |
|---|---|
| General | Yield target (t/ha), area (ha), production system, organic N inputs |
| Soil | Depth, bulk density, %MOS, pH, CE, ppm of N/P/K/Ca/Mg/S/Fe/Cu/Mn/Zn/B |
| Water (optional) | pH, CE, meq/L of Ca/Mg/K/Na/NH₄/NO₃/SO₄/H₂PO₄/CO₃/HCO₃/Cl |

### Step 1 — Soil weight (PS)

```
PS = DA × 1000 × (d_cm / 100) × 10000    [kg/ha]
```

> Note: units — DA (g/cm³) × 1000 → (kg/m³); depth (m); area 10000 m²/ha

For DA = 1.35 g/cm³, depth = 30 cm:
`PS = 1.35 × 1000 × 0.30 × 10000 = 4,050,000 kg/ha`

### Step 2 — SUM (soil nutrient supply)

```
SUM_macro = ppm_soil × PS / 1,000,000    [kg/ha]
```

For oxide forms (P₂O₅, K₂O, CaO, MgO), apply conversion factors:
`P₂O₅ = P_ppm × PS / 1e6 × 2.291`

### Step 3 — DEM (crop nutrient demand)

```
DEM = yield_t_ha × removal_coeff    [kg/ha]
```

| Nutrient | Removal coefficient (kg/t grain) |
|---|---|
| N | 22 |
| P₂O₅ | 8 |
| K₂O | 20 |
| CaO | 3 |
| MgO | 7 |
| S | 4 |

### Step 4 — Fertiliser dose

```
resultado = (SUM - DEM) × EF           [kg/ha]
factorAjuste = resultado < 0 ? -1.0 : 0.25
dosis = max(0, resultado × factorAjuste)    [kg/ha]
```

Efficiency factors (EF) by production system:

| Nutrient | Riego rodado | Fertirriego |
|---|---|---|
| N | 1.4 | 1.2 |
| P₂O₅ | 1.9 | 1.5 |
| K₂O | 1.3 | 1.1 |

### Step 5 — Adjusted N

```
Nm = PS × (MOS/100) × 0.55 × 0.10 × 0.02   [kg N/ha mineralised]
N_ajustado = max(0, dosis_N - Nm - MOO)
```

Constants: C_org = 0.55 (Van Bemmelen), RC_N = 0.10 (C:N mineralisation),
TM = 0.02 (annual mineralisation rate).

### Step 6 — Phenological distribution

```
N distribution %: [4%, 18%, 28%, 50%]   (stages 1–4)
P₂O₅:             [3%, 30%, 28%, 39%]
K₂O:              [4%, 65%, 10%, 21%]
```

### Worked example (Maize, fertirriego, 15 t/ha)

| Variable | Value |
|---|---|
| PS | 4,050,000 kg/ha |
| SUM_N | 72.9 kg/ha |
| DEM_N | 330 kg/ha |
| EF_N | 1.2 |
| resultado_N | (72.9 - 330) × 1.2 = **-308.52** |
| factorAjuste | -1.0 (deficit) |
| dosis_N | max(0, -308.52 × -1.0) = **308.52 kg/ha** |
| Nm | 4,050,000 × 0.021 × 0.55 × 0.10 × 0.02 = **93.6 kg/ha** |
| N_ajustado | 308.52 - 93.6 - 20 = **194.9 kg/ha** |

### Water analysis (optional)

```
SAR = Na / sqrt((Ca + Mg) / 2)             [mmol/L]^0.5
Hardness = (Ca + Mg) × 5                  [French degrees, °f]
H₂SO₄ = (HCO₃ × 49) / (1.83 × 0.98)     [mL/m³]
```

---

## References

- Oseguera-Pérez, H. & Sánchez-García, J. (2015). *Manual de calculadora de
  nutrición y bioestimulación para maíz*. Internal technical document.
- NOM-021-SEMARNAT-2000. *Especificaciones de fertilidad, salinidad y
  clasificación de suelos*. Diario Oficial de la Federación, México.
- Walkley, A. & Black, I.A. (1934). An examination of the Degtjareff method
  for determining soil organic matter, and a proposed modification of the
  chromic acid titration method. *Soil Science*, 37(1), 29–38.

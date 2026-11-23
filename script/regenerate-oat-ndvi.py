"""Regenerate the two public oat fixtures without changing zoning inputs."""
import csv
import json
import sys
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "geo-service"))
from services.ndvi_nitrogen import RULES, ndvi_nitrogen_rule  # noqa: E402

PUBLIC_NAME = "Parcela piloto avena, Miguel Auza"
PRICE = Decimal("0.75")
UNIFORM = Decimal(80)
FILES = ("README.md", "metadata.json", "provenance.json", "field_boundary.geojson",
         "zones.geojson", "zone_statistics.csv", "ndvi_timeseries.csv",
         "prescription_table.csv", "prescription.geojson")
RULE_PATH = "shared/ndvi-nitrogen-rules.json"


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def update_case(directory):
    legacy = directory / "legacy"
    if not legacy.exists():
        historical = read_json(directory / "metadata.json")
        if historical["dataset_version"] != "1.0.0":
            raise ValueError("El respaldo histórico debe partir de la versión original.")
        old_name = historical["field"]["name"]
        legacy.mkdir()
        for filename in FILES:
            text = (directory / filename).read_text(encoding="utf-8").replace(old_name, PUBLIC_NAME)
            (legacy / filename).write_text(text, encoding="utf-8")
        (legacy / "README.md").write_text(
            "> **Dosis generadas por GPT-4o, versión histórica.** Se preservaron las cifras "
            "originales; se omitió el identificador de la cuenta y se sustituyó el nombre.\n\n"
            + (legacy / "README.md").read_text(encoding="utf-8"), encoding="utf-8")
        provenance = read_json(legacy / "provenance.json")
        provenance["original_ids"].pop("user_id", None)
        provenance["queries_used"][0]["table"] = "parcels"
        provenance["data_anonymization"] = {
            "applied": True, "note": "Name replaced and account ID omitted; parcel geometry preserved.",
        }
        provenance["reproducibility_guarantee"] = "Numeric results preserved from the historical export; identifying fields were redacted."
        write_json(legacy / "provenance.json", provenance)
        historical["field"]["name"] = PUBLIC_NAME
        historical["historical_status"] = "Dosis generadas por GPT-4o, versión histórica"
        write_json(legacy / "metadata.json", historical)

    metadata = read_json(legacy / "metadata.json")
    provenance = read_json(legacy / "provenance.json")
    boundary = read_json(legacy / "field_boundary.geojson")
    prescription = read_json(legacy / "prescription.geojson")
    zone_properties = {f["properties"]["zone_id"]: f["properties"] for f in
                       read_json(directory / "zones.geojson")["features"]}
    with (legacy / "prescription_table.csv").open(encoding="utf-8", newline="") as source:
        rows = list(csv.DictReader(source))
    version = RULES["version"]
    total_area = total_kg = total_cost = Decimal(0)
    features = {f["properties"]["zone_id"]: f for f in prescription["features"]}
    markdown = []
    for row in rows:
        zone_id = int(row["zone_id"])
        props = zone_properties[zone_id]
        area = Decimal(row["area_ha"])
        mean = Decimal(row["ndvi_mean"])
        if (area, mean) != (Decimal(str(props["area_ha"])), Decimal(str(props["ndvi_mean"]))):
            raise ValueError(f"Entradas inconsistentes en la zona {zone_id}.")
        rule = ndvi_nitrogen_rule(float(mean))
        dose = rule["dose"]
        kg = area * dose
        cost = (kg * PRICE).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        rationale = (f"Motor determinista NDVI v{version}: media {mean:.4f}; banda {rule['label']}; "
                     f"{dose} {rule['unit']}. El NDVI no diagnostica deficiencia de N.")
        row.pop("ai_rationale", None)
        row.update(amendment="Nitrógeno (N)", dose_unit=rule["unit"], rate_kg_ha=str(dose),
                   total_kg=f"{kg:.4f}", cost_usd=f"{cost:.2f}", application_method="", timing="",
                   rationale=rationale)
        feature = features[zone_id]["properties"]
        feature.pop("ai_rationale", None)
        feature.update(amendment="Nitrógeno (N)", rate_kg_ha=dose, total_kg=float(kg),
                       cost_usd=float(cost), rationale=rationale, rule_version=version)
        total_area += area
        total_kg += kg
        total_cost += cost
        markdown.append(f"| {row['zone_label']} | {area:.4f} | {mean:.4f} | {dose} | {kg:.4f} | {cost:.2f} |")

    baseline = total_area * UNIFORM
    reduction = ((1 - total_kg / baseline) * 100).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    metadata.pop("historical_status", None)
    metadata.pop("ndvi_reference_optimal_range", None)
    metadata.update(dataset_version="2.0.0", pipeline_version="satellite_ndvi_vra_rules_v1",
                    description="Zonas y NDVI históricos; prescripción regenerada por reglas deterministas.",
                    prescription_model="Motor determinista por bandas de NDVI medio",
                    prescription_rule_version=version, prescription_rule_path=RULE_PATH,
                    amendment="Nitrógeno (N)", dose_unit=RULES["unit"],
                    total_fertilizer_kg=float(total_kg), total_cost_usd=float(total_cost),
                    cost_per_kg_usd=float(PRICE), uniform_rate_kg_n_ha=float(UNIFORM),
                    uniform_total_kg_n=float(baseline), reduction_vs_uniform_pct=float(reduction))
    metadata["pipeline_steps"][5] = f"6. Dosis por zona con motor determinista NDVI v{version}"
    prescription["metadata"].pop("created_at", None)
    prescription["metadata"].update(amendment="Nitrógeno (N)", unit=RULES["unit"],
                                    application_method=None, timing=None, total_kg=float(total_kg),
                                    total_cost_usd=float(total_cost), rule_version=version,
                                    reduction_vs_uniform_pct=float(reduction))
    provenance["provenance_version"] = "2.0"
    provenance["original_ids"]["historical_prescription_ids"] = provenance["original_ids"].pop("prescription_ids")
    provenance["transformations_applied"] = [
        "Original field and zone geometry, areas and NDVI retained.",
        f"Recomputed prescription from zonal mean NDVI using {RULE_PATH} v{version}.",
        "kg N = rate × zone area, no intermediate rounding. USD = kg N × 0.75, rounded to cents per zone.",
    ]
    provenance["notes_on_data_cleaning"] = [
        line for line in provenance["notes_on_data_cleaning"] if not line.startswith("Prescription amounts")
    ]
    provenance["reproducibility_guarantee"] = "Only the zoning inputs are historical exports. New prescriptions use deterministic rules without external services."
    provenance["historical_snapshot"] = "legacy/"
    provenance["prescription_rule"] = {"file": RULE_PATH, "version": version, "generator": "script/regenerate-oat-ndvi.py"}
    write_json(directory / "metadata.json", metadata)
    write_json(directory / "provenance.json", provenance)
    write_json(directory / "field_boundary.geojson", boundary)
    write_json(directory / "prescription.geojson", prescription)
    with (directory / "prescription_table.csv").open("w", encoding="utf-8", newline="") as out:
        writer = csv.DictWriter(out, fieldnames=list(rows[0]), lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    table = "\n".join(markdown)
    (directory / "README.md").write_text(f"""# Parcela piloto avena, Miguel Auza

Caso reproducible de AgRegen 5.0 para SoftwareX. Se conservaron las seis zonas, áreas
y valores NDVI del caso de avena bajo riego en Zacatecas (Sentinel-2 del 26 de abril
de 2026, malla de 10 m, zonificación k-means espacial). El nombre del productor
se sustituyó, sin modificar la geometría.

## Prescripción determinista

El [motor NDVI v{version}](../../{RULE_PATH}) asigna la dosis de nitrógeno según la
media de cada zona. No usa un modelo de lenguaje para producir las cifras. El NDVI
no diagnostica una deficiencia de N y estas cifras son un escenario metodológico,
no una validación agronómica en campo.

| Zona | Área (ha) | NDVI medio | Dosis (kg N/ha) | N (kg) | Costo (USD) |
|---|---:|---:|---:|---:|---:|
{table}
| **Total** | **{total_area:.4f}** | — | — | **{total_kg:.4f}** | **{total_cost:.2f}** |

La referencia uniforme de {UNIFORM} kg N/ha sobre las mismas zonas suma
**{baseline:.4f} kg N**. Reducción del escenario: **{reduction:.2f} %**.
Se multiplicó la dosis por el área sin redondeos intermedios; el costo de cada
zona se redondeó a centavos con el precio de **{PRICE} USD/kg N**.

## Datos y reproducción

- `field_boundary.geojson`, `zones.geojson`, `zone_statistics.csv` y `ndvi_timeseries.csv`: insumos históricos.
- `prescription_table.csv` y `prescription.geojson`: dosis, cantidades, costo y justificación determinista.
- `metadata.json` y `provenance.json`: parámetros, fuente de reglas y trazabilidad.
- [legacy/](legacy/README.md): versión histórica anonimizada; sus dosis se conservan sin recalcular.

Desde la raíz: `python script/regenerate-oat-ndvi.py`, `npm run test:oat`.
No se requieren credenciales, llamadas externas ni acceso a la base de datos.
""", encoding="utf-8")
    print(f"{directory.name}: {total_kg:.4f} kg N, USD {total_cost:.2f}, reducción {reduction:.2f}%")


if __name__ == "__main__":
    for case in ("case_01_oat_satellite", "sample_pilot_oat"):
        update_case(ROOT / "data" / case)

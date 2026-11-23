# Parcela piloto avena, Miguel Auza

Caso reproducible de AgRegen 5.0 para SoftwareX. Se conservaron las seis zonas, áreas
y valores NDVI del caso de avena bajo riego en Zacatecas (Sentinel-2 del 26 de abril
de 2026, malla de 10 m, zonificación k-means espacial). El nombre del productor
se sustituyó, sin modificar la geometría.

## Prescripción determinista

El [motor NDVI v1.0.0](../../shared/ndvi-nitrogen-rules.json) asigna la dosis de nitrógeno según la
media de cada zona. No usa un modelo de lenguaje para producir las cifras. El NDVI
no diagnostica una deficiencia de N y estas cifras son un escenario metodológico,
no una validación agronómica en campo.

| Zona | Área (ha) | NDVI medio | Dosis (kg N/ha) | N (kg) | Costo (USD) |
|---|---:|---:|---:|---:|---:|
| Zona 1 | 1.3775 | 0.1600 | 80 | 110.2000 | 82.65 |
| Zona 2 | 1.3932 | 0.1626 | 80 | 111.4560 | 83.59 |
| Zona 3 | 2.5285 | 0.4351 | 40 | 101.1400 | 75.86 |
| Zona 4 | 3.2430 | 0.4658 | 40 | 129.7200 | 97.29 |
| Zona 5 | 2.1091 | 0.4852 | 40 | 84.3640 | 63.27 |
| Zona 6 | 2.0750 | 0.5316 | 30 | 62.2500 | 46.69 |
| **Total** | **12.7263** | — | — | **599.1300** | **449.35** |

La referencia uniforme de 80 kg N/ha sobre las mismas zonas suma
**1018.1040 kg N**. Reducción del escenario: **41.15 %**.
Se multiplicó la dosis por el área sin redondeos intermedios; el costo de cada
zona se redondeó a centavos con el precio de **0.75 USD/kg N**.

## Datos y reproducción

- `field_boundary.geojson`, `zones.geojson`, `zone_statistics.csv` y `ndvi_timeseries.csv`: insumos históricos.
- `prescription_table.csv` y `prescription.geojson`: dosis, cantidades, costo y justificación determinista.
- `metadata.json` y `provenance.json`: parámetros, fuente de reglas y trazabilidad.
- [legacy/](legacy/README.md): versión histórica anonimizada; sus dosis se conservan sin recalcular.

Desde la raíz: `python script/regenerate-oat-ndvi.py`, `npm run test:oat`.
No se requieren credenciales, llamadas externas ni acceso a la base de datos.

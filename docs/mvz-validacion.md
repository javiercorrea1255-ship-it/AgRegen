# Corrección de mapas de variabilidad (MVZ)

## Alcance y publicación

Se corrigió la interpolación, su diagnóstico, la malla y zonificación, el tamaño de muestra y la pantalla MVZ. No se publicó el proyecto ni hubo migraciones o cambios de esquema.

Se conservan los métodos y rutas públicos. Las extensiones aditivas incluyen advertencias, índices originales, conteos de muestras, métricas/estado del variograma y propósito del muestreo. El cambio de nombre solicitado es `mse_ratio` para el cociente MSE/varianza de datos; `msdr` y su alias `kriging_msdr` corresponden a varianzas predictivas LOOCV de kriging. `r2_loocv` conserva el alias `r2`.

## Cambios implementados

1. Semivariograma empírico hasta la mitad de la distancia máxima, clases adaptativas con al menos 30 pares, ajuste acotado de pepita, meseta parcial y rango por mínimos cuadrados ponderados de Cressie. Auto compara esférico, exponencial y gaussiano por RMSE LOOCV; cada partición reajusta transformación y variograma solo con entrenamiento. Menos de 15 puntos o un ajuste no convergente usan la heurística documentada y estado `respaldo`.
2. Raster, malla, zonas, estadísticas y leyenda en unidades originales. Log1p usa esperanza lognormal exacta de kriging; Box-Cox usa corrección de segundo orden con varianza predictiva, o lognormal exacta en el límite lambda cero. Parámetros describen fórmula y escala. La rezonificación distingue mallas originales nuevas de transformadas históricas para no invertirlas dos veces.
3. Centros de celda explícitos para MVZ, máscara que incluye cobertura parcial, geometrías recortadas y áreas en UTM local. Las utilidades compartidas conservan su comportamiento histórico por defecto.
4. Exclusión advertida de valores inválidos y puntos fuera del polígono con tolerancia de 20 m; agrupación de duplicados a menos de 1 m. Residuos en orden de entrada con índice original, marca de excluido y grupo agregado. El grupo completo queda fuera de entrenamiento al validar su predicción.
5. Atípicos evaluados antes de recortes y transformaciones: CV superior a 100 % o límites de 3×IQR. Se separan de la condición de malla casi constante. Valores idénticos o malla casi constante producen una zona.
6. SVR estandariza coordenadas y objetivo dentro de las particiones; selecciona C/gamma con CV de cinco particiones y extiende la rejilla una vez cuando corresponde. Se devuelven los parámetros.
7. Recomendación de mapeo por defecto: al menos 30, Cochran y número de celdas de la rejilla espacial UTM con separación máxima igual a la mitad del rango. Se conserva propósito `mean`.
8. Cliente: GPS real antes de coordenadas planeadas, cuartiles lineales y 3×IQR coherente, residuos por identidad, métricas nuevas después de recalcular, protección frente a respuestas tardías, advertencias restaurables y semivariograma empírico junto al ajuste. La adaptación de zonas del recálculo conserva geometrías/estadísticas en el formato que usa el mapa.
9. El cálculo de muestra envía el rango del catálogo y credenciales. El avatar conserva una versión estable y la renueva solo al subir una imagen.

## Validación reproducible

Fixture independiente, semilla **2026**, fijada antes de evaluar los resultados: campo de 300×300 m, componente aleatorio con covarianza esférica de varianza 0.25 y rango 120 m, tendencia oeste-este 2.2–2.8, 36 muestras 6×6 con desplazamiento ±10 m y ruido 0.05, y 500 puntos de verdad conocida.

La verdad se genera por embedding circulante de una covarianza de soporte compacto, no mediante predicciones de los interpoladores evaluados. La generación del fixture no forma parte del tiempo de respuesta.

| Criterio | Resultado medido | Límite |
|---|---:|---:|
| RMSE kriging automático | 0.294687 | ≤0.39 |
| MSDR kriging LOOCV | 0.723608 | 0.7–1.4 |
| Estado automático | ajustado, gaussiano | ajustado |
| Rango esférico ajustado | 83.807 m | 60–250 m |
| RMSE IDW | 0.290625 | ≤0.40 |
| RMSE SVR | 0.309199 | ≤0.41 |
| Desviación de malla SVR 80×80 | 0.465804 | ≥0.2 |
| Parámetros SVR | C=100, gamma=1, epsilon=0.05 | seleccionados por CV |
| Sesgo de malla log1p | −0.022611 | magnitud ≤0.1 |
| Sesgo de malla Box-Cox | −0.020665 | magnitud ≤0.1 |
| Cálculo completo, 36 muestras, resolución 80 | 1.156 s | <6 s |
| Áreas de zonas e interiores sin huecos | aprobado | error de área ≤0.5 % |
| Polígono cóncavo y celdas parciales | aprobado, 6.76 ha | error de área ≤0.5 % |
| Punto exterior a 1 km | excluido; mismos residuos y métricas | sin contaminar LOOCV |
| Valor ×10 | advertencia; no casi constante | requerido |
| Valores iguales | una zona | requerido |
| Kriging con siete puntos | error 400 | requerido |
| Nulos, no numéricos y duplicados | exclusión/agrupación con trazabilidad | requerido |
| Rezonificación en escala original y respaldo por fallo | aprobado | sin doble inversión |

### Comandos y resultados

- `cd geo-service && python -m pytest tests -q -s --disable-warnings`: **244 aprobadas**, 235 advertencias de las bibliotecas/casos numéricos, 48.74 s.
- `npm test -- --reporter=dot`: **324 aprobadas, 1 omitida**; 28 archivos aprobados, 1 omitido; 17.59 s.
- `npx vitest run tests/mvz-results.test.ts --reporter=dot`: **8 aprobadas**.
- Refuerzo explícito de desviación de la malla SVR 80×80: prueba dirigida aprobada; desviación **0.465804**, además de **0.480066** en los 500 puntos de validación.
- `npm run check`: aprobado.
- `npm run build`: aprobado. Conserva advertencias de tamaño de los paquetes JavaScript; no son errores de compilación.
- `git diff --check`: aprobado.
- Ambos servicios de desarrollo arrancaron correctamente. Captura de la portada sin errores de renderizado; la petición de sesión sin autenticar devuelve 401, como corresponde.

**Limitación explícita:** la vista MVZ autenticada no se verificó en navegador. El comprobador especializado respondió que el tipo de prueba no está disponible en este entorno; no se desactivó autenticación ni se modificaron cuentas para sortearlo. La lógica del cliente sí tiene pruebas unitarias, comprobación de tipos y compilación.

## Archivos de implementación y pruebas

| Archivo | Resumen |
|---|---|
| `geo-service/services/variogram.py` | Empírico, ajustes Cressie acotados, estados y momentos inversos con corrección de sesgo. |
| `geo-service/services/interpolation_input.py` | Validación, tolerancia espacial, promedios y trazabilidad original. |
| `geo-service/services/interpolation.py` | Selección/LOOCV de kriging, MSDR predictivo, respaldo explícito y selección SVR normalizada. |
| `geo-service/routers/interpolation.py` | Integración de validación, escalas, cobertura, advertencias, residuos y conteos. |
| `geo-service/routers/sampling.py` | Propósito de muestreo; diagnóstico con 3×IQR y una zona para valores constantes. |
| `geo-service/routers/shared.py` | Máscara opcional con borde y cobertura parcial, preservando el modo anterior. |
| `geo-service/routers/zones.py` | Rezonificación con disposición de malla explícita y soporte de una zona. |
| `geo-service/services/raster.py` | Opción de centros de celda sin alterar el modo histórico por defecto. |
| `geo-service/services/zonify.py` | Dimensiones reales de celda, recorte y área UTM; atajo de zona única. |
| `geo-service/services/grid_generator.py` | Tamaño espacial para mapeo, separación por rango y propósito. |
| `geo-service/utils/metrics.py` | `mse_ratio`, `r2_loocv` y alias `r2`. |
| `geo-service/tests/test_metrics.py` | Expectativas actualizadas al nombre requerido, conservando las comprobaciones numéricas. |
| `geo-service/tests/test_mvz_acceptance.py` | Fixture independiente y aceptación numérica, cobertura, validación y respaldo. |
| `client/src/lib/mvz-results.ts` | Cuartiles, GPS preferente, asociación de residuos, curva y adaptación de zonas. |
| `client/src/pages/parcel-interpolation.tsx` | Integración de resultados, métricas actuales, advertencias, curva y controles contra respuestas tardías. |
| `client/src/components/layout/navbar.tsx` | Versión estable del avatar y actualización al subir imagen. |
| `shared/sample-size.ts` | Rango del catálogo, propósito, credenciales y respaldo local sin limitar la recomendación de mapeo a 80. |
| `server/routes.ts` | GPS preferente en MVZ, parámetros SVR, persistencia/transmisión de métricas y advertencias, y compatibilidad de rezonificación. |
| `tests/mvz-results.test.ts` | Ocho regresiones del cliente y del adaptador de tamaño de muestra. |
| `docs/mvz-validacion.md` | Este informe. |
| `.agents/memory/MEMORY.md` y `.agents/memory/mvz-validation-boundaries.md` | Restricción científica previamente validada y motivo de compatibilidad con resultados históricos. |

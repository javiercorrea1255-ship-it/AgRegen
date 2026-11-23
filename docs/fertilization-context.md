# Fertilización contextual y bitácora web

## Datos y límites de interpretación

- `soil_analysis.nitrogen_inorganic`: N inorgánico, mg/kg; independiente de `nitrogen_total`, que sigue en %. pH y textura conservan dos decimales.
- Un cero aislado/legado de N total se presenta al agente como no disponible, no como ausencia de N. Si las observaciones identifican explícitamente N inorgánico con su valor y unidad mg/kg o ppm, se utiliza ese dato con su procedencia sin reescribir el análisis.
- Para contexto y vista de análisis se deduplican fecha y mediciones normalizadas, conservando observaciones; las filas históricas no se eliminan.
- `soil_biology` incorpora folio, laboratorio, método, cinco conteos UFC/g y estados independientes de Metarhizium/Beauveria y fijadoras de N. Ausencia de dato, no detectado y cero medido no son equivalentes.
- La relación Trichoderma/Fusarium se calcula al leer, no se almacena. Sin ambos conteos o con Fusarium cero no se calcula. Los datos son organismos cultivables: no identifican patógenos, diversidad total, eficacia del insumo ni cantidad de N fijado.
- El formulario solo permite conteos de laboratorio. Las estimaciones satelitales existentes no se convierten en resultados de laboratorio.

## Contexto compartido

Los agentes web y WhatsApp reciben el análisis completo reciente y el anterior distinto: MO, C, N total/inorgánico, P/K/Ca/Mg/S/Fe/Zn/Mn/Cu/B, pH, CE, CIC, textura y observaciones. Se incluye la microbiología de laboratorio más reciente con conteos/estados, incluso si después se capturó una medición únicamente de biomasa. Se mantienen cultivo, etapa y fechas, ciclo, clima y pronóstico, alertas —incluida sequía—, satélite, aplicaciones, economía y precio SNIIM real cuando existe.

WhatsApp conserva la ficha única, sus siete bloques y una llamada al modelo; no se añadió clasificador de fertilización ni extracción aparte. El bloque de análisis tiene un límite de 12,500 caracteres; observaciones excepcionalmente extensas se acortan con aviso, sin retirar mediciones ni microbiología. Se mantienen la caché de clima y las excepciones ya existentes del mapa solicitado en lenguaje natural.

Las instrucciones y salvaguardas diferencian datos de hipótesis, impiden recomendar B cuando está muy alto y evitan dosis/fórmulas cerradas sin superficie y meta de rendimiento. Antes de una fórmula, el modelo debe confirmar que ambos datos aplican al área objetivo. Se favorece fraccionar en suelo arenoso y probar un insumo nuevo en franja con testigo. No se modifican las protecciones sobre plaguicidas.

La economía web y WhatsApp usa `projectParcelCosts` y `summarizeParcelEconomy`: módulo de costos más bitácora vigente, separando monedas, ciclo y ventas. No se copian costos a otra tabla.

## Guardado desde el chat web

El modo normal devuelve la respuesta y la decisión estructurada en una sola generación. Reportes, solicitudes de registrar labores realizadas y mensajes mixtos se guardan con `saveAutomaticFieldLog`, revisión auditable, origen `channel: web` y `registration: automatic`. Preguntar por una labor pasada no crea un hecho nuevo.

Un renderizador del servidor controla los estados guardado/sin registro/fallo/resultado incierto en todos los modos. Solo genera el acuse en español con cantidades/costo tras comprobar persistencia. Ante un fallo o resultado incierto descarta todo el texto del modelo. Si el modelo afirma un guardado no autorizado, rechaza la respuesta completa en lugar de mezclarla con un aviso contradictorio. Conserva consultas históricas y consejos sin acuses de escritura.

El cliente conserva un identificador por envío/reintento; el origen único `web:<conversación>:<solicitud>` impide duplicar la labor y el gasto. El servidor comprueba propietario y parcela y recupera el registro existente si se perdió el acuse. Las respuestas completadas se recuperan por solicitud. El historial y los costos se invalidan tras responder para mostrar el registro nuevo.

Los modos **Profundo** y **Diagnóstico fotográfico** mantienen sus flujos existentes: no generan altas automáticas y el servidor indica expresamente que no guardó nuevos registros. No se afirma falsamente que lo hicieron.

## Migración y publicación

`migrations/0013_soil_nitrogen_microbiology.sql` es una migración aditiva aplicada **solo en desarrollo**. Agrega una columna nullable en `soil_analysis` y once en `soil_biology`. No borra ni modifica análisis, usuarios, bitácoras ni gastos existentes.

Cuando el propietario autorice publicar, el flujo administrado de Replit compara el esquema de desarrollo y producción. Revisar estas adiciones y cualquier diferencia pendiente antes de aprobar el SQL generado. Por esta entrega no se requiere rellenar valores ni copiar la base de desarrollo. Mantener tablas de sesión ajenas al esquema y no aceptar propuestas de renombrado/borrado. No se añadió DDL al arranque, al build ni al proceso de producción. Referencia: https://docs.replit.com/features/data-and-storage/publish-database-changes

Un valor de N inorgánico se interpreta solo cuando existe explícitamente en su campo o en las observaciones del informe; nunca se deduce de un N total igual a cero.

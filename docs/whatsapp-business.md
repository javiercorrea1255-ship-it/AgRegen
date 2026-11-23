# Evaluación de campo: respuestas, registro y planeación

Las respuestas largas ya no se sustituyen por un aviso sin contenido; se conserva la respuesta y se divide mediante la entrega durable si hace falta. MÁS DETALLE amplía la consulta original vinculada.

La misma interpretación diferencia hechos ocurridos, consultas, supuestos y referencias de precio. Solo los hechos inequívocos se guardan automáticamente; la ambigüedad pide “¿Lo anoto en tu bitácora?” con Sí/No. Las fechas históricas imprecisas quedan pendientes, nunca se convierten en hoy. La fecha civil se interpreta en America/Mexico_City.

La ficha incorpora climatología histórica, precios pagados con procedencia y rentabilidad histórica. Los escenarios del próximo ciclo no heredan la etapa del cultivo actual. Todo plan de fertilización o insumo nuevo propone franja con testigo en cualquier cultivo. Véanse los procedimientos y límites en `docs/field-evaluation-sabino.md`.

# WhatsApp Business en AgRegen

AgRegen recibe mensajes mediante el webhook de Meta. WhatsApp usa un flujo único de interpretación y respuesta, con la agrobitácora como memoria operativa. El teléfono solo puede acceder a la parcela que su propietario vinculó desde AgRegen.

La ficha también incluye el suelo completo reciente/anterior distinto y microbiología cultivable de laboratorio, sin añadir llamadas al modelo ni clasificadores de nutrición. Reglas de fertilización, N inorgánico separado, límites de los conteos y migración: [fertilization-context.md](fertilization-context.md). La bitácora compartida distingue los reportes del chat web de los automáticos de WhatsApp; sus costos se suman una sola vez.

## Configuración requerida

Autoriza la integración **WhatsApp Business** de Replit o agrega estas variables mediante Secrets (nunca en el código):

- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_APP_SECRET`
- `WHATSAPP_GRAPH_VERSION` (opcional; por defecto `v21.0`)

En Meta Business configura como callback:

`https://<dominio-publicado>/api/whatsapp/webhook`

Suscribe el webhook al campo `messages`. El token de verificación debe coincidir con `WHATSAPP_VERIFY_TOKEN`.

## Vinculación del productor

1. El productor abre el Asistente IA de una parcela y despliega la sección **WhatsApp**.
2. Pulsa **Vincular esta parcela**.
3. Envía `VINCULAR 123456` al número de AgRegen antes de que el código expire.
4. El número queda vinculado al usuario y a esa parcela.

La parcela activa se puede cambiar desde cualquier Asistente IA del mismo usuario. Desvincular invalida el acceso del teléfono de inmediato.

## Mensajes soportados

- Texto
- Fotografías JPG, PNG o WebP de hasta 10 MB
- Fotografías con o sin texto/caption
- Notas de voz de hasta 16 MB en formatos OGG/Opus, MP3, MP4/M4A, AAC, AMR o WAV

Los documentos, videos, grupos, llamadas y campañas masivas no forman parte de esta versión.

## Seguridad y operación

- En producción se exige la firma `X-Hub-Signature-256` de Meta.
- Cada identificador de mensaje se procesa una sola vez.
- Si Meta reintenta un mensaje después de persistirlo, AgRegen reutiliza la transcripción y respuesta asociadas al mismo `providerMessageId` en vez de volver a invocar la IA o duplicar el historial.
- Los códigos duran 15 minutos y se guardan como hash.
- Los números se normalizan y se muestran enmascarados en la interfaz.
- Las fotografías se descargan con autorización de Meta, se validan y se envían al análisis visual como `data:`; no se guardan tokens ni URLs temporales.
- Las notas de voz se descargan con autorización, se validan y se transcriben en español. La transcripción conserva el `providerMessageId` del audio original y se trata como contexto conversacional, no como un hecho verificado de la parcela.
- Las respuestas se generan directamente en modo breve (objetivo máximo 600 caracteres), o ampliado cuando se solicita. No se genera una respuesta detallada para recortarla. Se conserva el validador de seguridad sobre plaguicidas.
- Los errores de procesamiento se registran sin imprimir mensajes, tokens o fotografías.

## Bitácora operativa

- Cada mensaje original y su transcripción quedan trazados en la conversación. El modelo distingue reporte, consulta o mensaje mixto, sin detector de palabras clave. Una consulta como «¿cuándo aplicamos fertilizante?» no se convierte en una labor.
- Una sola llamada generativa devuelve el registro estructurado y la respuesta. No hay extracción separada ni regeneración de `parcel_memory` para WhatsApp. La transcripción de audio y la síntesis de voz, si se solicitan, siguen siendo operaciones de audio independientes.
- Todos los mensajes usan el modelo primario (predeterminado `gpt-5.4`); las imágenes usan su variante configurada. No se decide el contexto ni el modelo textual por palabras clave. La llamada tiene reintentos del SDK desactivados y no encadena otro modelo como respaldo.
- El servidor compone el acuse factual desde el registro, separado del consejo que pasa por el validador de plaguicidas. Así una aplicación pasada de «50 kg de urea» no se interpreta como una instrucción nueva de tratamiento.
- Los hechos reportados se guardan inmediatamente, incluidas observaciones sin labor y observaciones visuales de campo. Una hipótesis visual no constituye diagnóstico confirmado.
- Sin fecha se usa la fecha del mensaje; sin moneda, MXN; una cantidad sin unidad conserva la cantidad y unidad nula. No se bloquea el registro por faltantes.
- Los registros automáticos usan `status=confirmed` como estado técnico vigente compatible con el esquema existente, `confirmed_at=NULL` y `structured_data.registration=automatic`. Esto NO es una confirmación expresa ni validación independiente. Los registros expresamente confirmados anteriores permanecen diferenciados por su origen. La web muestra «Vigente» y el origen.
- `CORREGIR <cambio>` mantiene vigente el registro y crea una revisión auditable con `lastAction=corrected`; `CANCELAR` lo anula (`rejected`) sin borrar el historial. Los botones se enlazan al mensaje original, no al último registro global.
- Fotos y audios asociados a una bitácora se guardan en Object Storage como evidencia privada del propietario. La ruta es durable y determinista por mensaje para que un reintento no duplique archivos.
- Cada moneda se totaliza por separado y nunca se suman cantidades con unidades incompatibles.
- La decisión estructurada, el mensaje y la intención de evidencia se persisten antes de guardar evidencia y aplicar el registro. Un reintento con una respuesta persistida reutiliza esa decisión sin llamar de nuevo al modelo.
- Los borradores antiguos de la parcela con actividad identificada se convierten al registro automático al acceder a la bitácora, costos o agente. Se conserva revisión, origen de la conversión y faltantes anteriores. Si no identifican actividad, permanecen borradores. No hay vencimiento ni eliminación automática.

## Ficha común y economía

Todas las consultas reciben los mismos siete bloques, en orden: (a) parcela/cultivo/etapa y ciclo con costo planeado, rendimiento y precio objetivo; (b) clima actual, cinco días de pronóstico y alertas sin acción resuelta; (c) análisis de suelo, agua y tejido; (d) seis observaciones satelitales con tendencia; (e) quince registros recientes y hasta cinco anteriores relevantes; (f) gastos por categoría, comparación con presupuesto y precio SNIIM disponible; (g) seis mensajes recientes.

Cada bloque tiene presupuesto de caracteres propio (1,500 / 2,400 / 1,500 / 1,500 / 6,500 / 2,000 / 3,200). Se limita detalle, no se seleccionan bloques por intención. Los datos ausentes se identifican como nulos/no disponibles. El clima se cachea por parcela y coordenadas durante 30 minutos.

`projectParcelCosts` es la proyección compartida de `production_costs` y los gastos vigentes de `field_log_entries`. Se limita al ciclo actual cuando existe, excluye ingresos por ventas y separa monedas. Los gastos de bitácora nunca se copian a otras tablas; aparecen en Costos como filas de solo lectura, corregibles o anulables desde la bitácora. Los indicadores de rentabilidad usan la misma proyección. No se convierten monedas sin tipo de cambio.

## Menos salidas y seguimiento

- El aviso de procesamiento se envía solo para fotos y audios, no para texto.
- Cuando caben en el límite de Meta, respuesta y botones salen en un único interactivo: Corregir/Cancelar para registros; Fue útil/No fue útil/Más detalle para recomendaciones.
- «MÁS DETALLE» genera una ampliación nueva únicamente al solicitarse y vinculada a la respuesta elegida, sin crear hechos de campo nuevos.
- Solo una recomendación con acción futura concreta en campo programa seguimiento a 24 horas. Un acuse, consulta informativa o aclaración no lo programa.
- Cola, firma, vinculación, comandos de menú/parcelas/alertas/voz/asesor, deduplicación de mensajes y cuarentena de envíos ambiguos conservan sus mecanismos.

## Mapas satelitales dentro del agente único

- El mismo intérprete devuelve `satelliteRequest` (índice `ndvi`/`ndmi`, fecha o nulo, comparación). No se añade clasificador por palabras clave. Reconoce texto o voz: «mándame el mapa», «cómo se ve desde el satélite», «dónde está débil» y `MAPA`. El botón **Ver mapa** equivale a `MAPA`; AYUDA lo enumera. Por el límite de tres botones de Meta, el clima continúa accesible escribiendo CLIMA.
- La ficha común conserva sus siete bloques e incorpora el último resumen satelital enviado y siete días completos de lluvia/temperatura estimadas por Open-Meteo, con fechas y origen. Clima y periodo reciente comparten caché de 30 minutos. Un dato histórico ausente no se convierte en cero.
- `MAPA` calcula primero el ráster y usa una sola generación con sus cifras reales y la ficha completa. Las solicitudes en lenguaje natural permiten únicamente una segunda generación, después de que la primera haya decidido pedir el mapa. Nunca se interpreta un ráster que el modelo todavía no recibió. No se explica una imagen histórica con lluvia futura o labores posteriores.
- Se reutiliza `getIndexRaster`, su expresión de índice y su máscara SCL (sombras, nubes, cirros y nieve), con escena Sentinel-2 identificada exactamente y malla geográfica explícita norte-arriba. El modo estricto del catálogo **nunca** usa sus respaldos simulados heredados. No se usan mosaicos decorativos ni superresolución.
- Para el mapa actual se consulta un catálogo de 30 días en **una evaluación** (fechas, nubosidad e identificadores juntos). Earth Engine elige la imagen más reciente con al menos nueve píxeles observables sobre la malla de la parcela; las nubes parciales siguen advirtiéndose. Las fechas solicitadas se buscan por proximidad dentro de ±30 días; se muestra siempre la fecha real.
- El ráster alineado utiliza **una evaluación** para área, rectángulo, malla muestreada, identidad, fecha y nubosidad. La selección entre candidatas y el descarte de imágenes totalmente ocultas ocurren en Earth Engine, sin un bucle de peticiones por imagen desde Node. Se conserva la máscara SCL y se convierten muestras ausentes en `null`, no en ceros.
- `MAPA` y solicitudes simples no calculan otra imagen: pueden citar el promedio del último antecedente anterior de bitácora, identificado como referencia, nunca como cambio por zonas. Solo una comparación explícita lanza los rásteres actual y anterior en paralelo. La imagen anterior tiene un presupuesto de 15 segundos; si falla, tarda demasiado o tiene poca superficie común, se entrega el mapa actual sin comparación.
- Se rechazan parcelas con menos de nueve píxeles nativos o anchura menor de dos píxeles: NDVI 10 m, NDMI 20 m. Es una protección operativa para no fingir localización fina, no una certificación de precisión espacial.
- Las clases orientativas son NDVI `<0.30`, `0.30–<0.60`, `≥0.60`; NDMI `<0.10`, `0.10–<0.30`, `≥0.30`. Su interpretación depende del cultivo y su etapa. **NDMI es humedad del follaje, no una medición del agua del suelo.**
- El promedio y porcentajes se ponderan por la fracción de cada celda dentro del polígono. Los porcentajes usan toda la superficie de la parcela como denominador e incluyen por separado el área sin lectura; nunca se pinta de verde lo oculto. Se indican sectores de una cuadrícula territorial 3 × 3 (noreste, orilla sur, centro, etc.), no una precisión por planta.
- El cambio usa solo celdas observadas en las dos imágenes y la misma malla: baja `<−0.05`, estable `±0.05`, mejora `>0.05`. Se informa la fracción comparada; con menos de 10 % de superficie común se omite el cambio, sin perder el mapa actual.
- El PNG de 1000 × 1100 incluye polígono, norte, parcela, fecha y leyenda de tres niveles. Lo genera Pillow usando los mismos píxeles que las estadísticas; usa las dependencias Python ya declaradas del servicio geográfico, sin requerir que su proceso HTTP esté iniciado.
- Se envía una imagen con el análisis en su pie, sin texto ni botones duplicados. Si supera 1024 caracteres, se envían imagen y texto completo después. Con preferencia de voz, imagen y audio del análisis; se congela esa preferencia en la respuesta persistida para reintentos.
- Se avisa si la imagen supera diez días y se ubica la superficie sin lectura por nubes/sombras o cobertura insuficiente. Falta de polígono, imagen, resolución suficiente o servicio produce una explicación clara sin cifras inventadas.
- Se persiste intención de objeto antes de subir el PNG privado; resultado, estadísticas e identidad de escenas quedan en la respuesta guardada. La caché está acotada por propietario/parcela, contorno, índice, fecha/escenas y versión de representación; sirve el PNG ya guardado al repetir la selección. Nunca se necesita un enlace público para Meta: se sube el archivo privado.
- La entrega usa `incomingId:answer-map:0`, hash del contenido y los mismos estados de salida: un resultado ambiguo se pone en cuarentena, no se reenvía a ciegas. Solo tras confirmación de entrega de la imagen se inserta, idempotentemente, una observación satelital en la bitácora (`incomingId:satellite`), con fecha de imagen, promedio, porcentajes, hectáreas bajas, sectores, comparación y evidencia. La web/exportación identifican su origen **Satélite**.
- La métrica `map` registra duración y éxito sin contenido del productor. «Estoy preparando tu mapa» sale solo después de cuatro segundos de preparación real, una vez conocida la solicitud; no por cada texto.
- Mapa y actualización en segundo plano comparten cachés de promesas de catálogo y ráster (30 minutos, acotadas y separadas por propietario, parcela y contorno). No se inicia la actualización mientras se prepara un mapa; el agente difiere decidirla hasta saber si la respuesta pedirá mapa. Los resultados reales ya calculados se reutilizan en la siguiente actualización.
- Cada solicitud registra `requestId` opaco y duración/éxito de `catalogue`, `raster`, `previous`, `png`, `model` y `send`; se señalan caché y etapas omitidas. `mapRequestId` en el cierre del worker permite correlacionarlos sin registrar texto ni teléfono. Se mantiene el límite defensivo acumulado de 45 segundos para consultas obligatorias; el objetivo de latencia es menos de 25 segundos de catálogo, ráster y PNG, no una garantía sobre el proveedor ni sobre modelo/envío.

## Pruebas

La configuración microbiológica, comparación entre fechas, control de superficie
de costos y estabilidad de planes se detallan en

`npm run check`, `npm test` y `npm run build`.

Evaluación optativa contra el modelo real: `npx tsx scripts/verify-whatsapp-map-semantics.ts`. Usa solo una ficha ficticia y consume nueve llamadas; no escribe en la base ni envía WhatsApp. Comprueba las cuatro expresiones naturales, MAPA, NDMI, fecha relativa, comparación y una consulta de riego que no debe pedir mapa, además de la extensión breve. No forma parte de las pruebas automáticas sin red.

También se verificó el ráster norte-arriba y el PNG con Sentinel-2 real para un polígono de coordenadas de prueba, sin modificar parcelas ni enviar mensajes. Las pruebas de entrega de Meta usan respuestas simuladas del proveedor; no sustituyen una recepción física en un teléfono vinculado.

Las pruebas de agente, contexto, inteligencia, bitácora, rutas y economía cubren reporte en primera persona, observación, pregunta sin registro, mensaje mixto, riego con clima y bitácora, suma de gastos de ambos orígenes, medios privados, autorización, reintentos y seguimiento selectivo. Las pruebas del proveedor usan respuestas simuladas: no envían mensajes reales a productores ni certifican la calidad semántica de un modelo remoto.

Además, el 17 de noviembre de 2026 se ejecutaron seis consultas sintéticas contra el modelo real `gpt-5.4`, sin enviar WhatsApp ni escribir datos operativos: reporte de urea sin costo inventado, observación de plaga, pregunta sobre fertilización sin crear hecho, riego reportado más pregunta, consulta de riego que usa lluvia y riego anterior, y suma de costos 800 + 250 = 1,050 MXN. Los seis casos devolvieron la clasificación y el registro esperados. Es una comprobación puntual, no una garantía estadística de precisión para cualquier mensaje.
/**
 * Crop-specific NDVI/EVI index profiles for AgRegen satellite interpretation.
 * Each profile provides per-stage thresholds and regenerative agronomic context.
 */

// ── NDVI expected ranges [low, high] keyed by normalized crop → stage ─────────
export const NDVI_BY_CROP_STAGE: Record<string, Record<string, [number, number]>> = {
  // ── Original 4 grains ────────────────────────────────────────────────────────
  maiz:    { germinacion:[0.05,0.20], vegetativo:[0.35,0.62], floracion:[0.60,0.85], llenado:[0.50,0.75], maduracion:[0.20,0.45], cosecha:[0.05,0.25] },
  soja:    { germinacion:[0.05,0.20], vegetativo:[0.35,0.60], floracion:[0.55,0.80], llenado:[0.50,0.75], maduracion:[0.20,0.40], cosecha:[0.05,0.22] },
  trigo:   { germinacion:[0.05,0.20], macollaje:[0.30,0.55], encañado:[0.50,0.70], espigado:[0.60,0.80], llenado:[0.40,0.65], maduracion:[0.15,0.35] },
  girasol: { germinacion:[0.05,0.20], vegetativo:[0.40,0.65], floracion:[0.55,0.75], llenado:[0.35,0.55], maduracion:[0.15,0.35] },

  // ── 12 new crops ─────────────────────────────────────────────────────────────
  tomate:    { trasplante:[0.05,0.18], vegetativo:[0.30,0.55], floracion:[0.50,0.70], fructificacion:[0.45,0.65], maduracion:[0.25,0.45] },
  papa:      { germinacion:[0.05,0.18], vegetativo:[0.35,0.60], tuberizacion:[0.55,0.78], llenado:[0.45,0.70], maduracion:[0.18,0.40] },
  cebolla:   { siembra:[0.05,0.15], establecimiento:[0.10,0.28], vegetativo:[0.30,0.55], bulbificacion:[0.28,0.50], maduracion:[0.10,0.28] },
  lechuga:   { trasplante:[0.05,0.18], crecimiento:[0.25,0.50], engrose:[0.42,0.62], cosecha:[0.38,0.58] },
  ajo:       { siembra:[0.05,0.15], vegetativo:[0.28,0.55], bulbificacion:[0.28,0.50], maduracion:[0.10,0.28] },
  vid:       { brotacion:[0.10,0.28], vegetativo:[0.38,0.65], floracion:[0.52,0.72], cuajado:[0.55,0.78], maduracion:[0.30,0.52], postcosecha:[0.12,0.30] },
  manzano:   { brotacion:[0.10,0.28], vegetativo:[0.42,0.68], floracion:[0.52,0.72], fructificacion:[0.58,0.78], maduracion:[0.35,0.58], postcosecha:[0.15,0.35] },
  citrus:    { vegetativo:[0.48,0.72], floracion:[0.55,0.75], cuajado:[0.52,0.72], engrosamiento:[0.50,0.70], maduracion:[0.48,0.68] },
  cana:      { germinacion:[0.10,0.28], macollamiento:[0.32,0.58], elongacion:[0.60,0.82], maduracion:[0.38,0.65] },
  alfalfa:   { establecimiento:[0.10,0.32], vegetativo:[0.52,0.78], prefloracion:[0.65,0.82], postcorte:[0.10,0.32], rebrote:[0.35,0.60] },
  sorgo:     { germinacion:[0.05,0.20], vegetativo:[0.35,0.60], espigado:[0.55,0.78], llenado:[0.40,0.62], maduracion:[0.15,0.38] },
  algodon:   { germinacion:[0.05,0.20], vegetativo:[0.30,0.55], floracion:[0.50,0.72], capsulas:[0.42,0.62], maduracion:[0.15,0.40] },
};

// ── Crop name aliases → normalized key ───────────────────────────────────────
export const CROP_ALIASES: [RegExp, string][] = [
  // Original
  [/ma[ií]z|corn|maize/i, "maiz"],
  [/soy[ab]ean|soja/i, "soja"],
  [/wheat|trigo/i, "trigo"],
  [/sunflower|girasol/i, "girasol"],
  // New
  [/tomat[eo]|tomato/i, "tomate"],
  [/papa|potato|patata/i, "papa"],
  [/cebolla|onion/i, "cebolla"],
  [/lechuga|lettuce/i, "lechuga"],
  [/ajo|garlic/i, "ajo"],
  [/vid\b|uva\b|grapevine|vino/i, "vid"],
  [/manzano|manzana|apple/i, "manzano"],
  [/c[íi]tricos|citrus|naranja|lim[oó]n|limon|orange/i, "citrus"],
  [/ca[ñn]a.*az[uú]car|sugarcane/i, "cana"],
  [/alfalfa|alfalfar/i, "alfalfa"],
  [/sorgo|sorghum/i, "sorgo"],
  [/algod[oó]n|cotton/i, "algodon"],
];

// ── Regenerative agronomic context paragraph per crop ─────────────────────────
// Injected into the AI system prompt to give crop-specific regenerative guidance.
export const CROP_REGEN_CONTEXT: Record<string, string> = {
  maiz: `El maíz en sistemas regenerativos se beneficia de cobertura permanente con rastrojo o calabaza intercalada, inoculación con micorrizas arbusculares (MA) y rotación con leguminosas (frijol, soja) para fijar N. Reducir labranza en barbecho preserva los agregados formados por las raíces profundas. Los principales problemas satelitales son estrés hídrico en VT/R1 (floracion) y deficiencias de Zn/Fe detectables por caídas de NDRE.`,

  soja: `La soja es fijadora de N (Bradyrhizobium): inocular semilla con cepa SEMIA 5079/587 es la práctica regenerativa más rentable. Cubrir el suelo con rastrojo >30% reduce evaporación y mejora la biota. Evitar herbicidas pre-emergentes repetitivos que degradan micorrizas. NDVI bajo en R3 (llenado) suele indicar estrés hídrico o soja clorosis ferropénica en suelos alcalinos.`,

  trigo: `El trigo se favorece con siembra directa sobre rastrojo de cultivo previo para retener humedad en encañado. Biofertilizantes con Azospirillum brasilense mejoran el macollaje en 15-20%. El sistema radical superficial hace al trigo muy sensible a compactación >1 cm debajo de la siembra. NDVI bajo en espigado suele indicar roya o deficiencia de N en la hoja bandera.`,

  girasol: `El girasol tiene raíz pivotante que descompacta capas medias. Rotarlo con gramíneas rompe ciclos de Sclerotinia. En suelos con pH >7.5 es común la clorosis por déficit de Fe/Mn. Las abejas y polinizadores son críticos en floración: dejar márgenes floridas aumenta rendimiento 10-15%. NDVI bajo en R5 (formación de aquenios) indica estrés hídrico severo.`,

  tomate: `El tomate en regenerativo se maneja con mulch vivo o plástico degradable para suprimir malezas y conservar humedad. La inoculación con Trichoderma y micorrizas en trasplante reduce marchitez por Fusarium. Evitar monocultivo más de 2 ciclos en el mismo lote. NDVI <0.35 en plena fructificación puede indicar virus (TYLCV), deficiencia de Ca (pudrición apical) o estrés hídrico.`,

  papa: `La papa es muy sensible a compactación: preparación mínima con cincel en vez de vertedera. Incorporar compost maduro (>20 t/ha) mejora la retención de humedad y reduce sarna común. Rotarla con cebolla o cereales corta el ciclo de Phytophthora. En satélite, el peak NDVI en tuberización (0.65-0.78) indica buen desarrollo; valores <0.50 en ese estado señalan estrés hídrico o enfermedad foliar.`,

  cebolla: `La cebolla requiere suelo suelto con alta materia orgánica para bulbificación uniforme. Aplicar compost de lombriz antes de trasplante; evitar estiércol fresco que favorece Botrytis. En regenerativo, intercalar con zanahoria o rábano reduce plagas. La cebolla tiene dosel delgado (NDVI máximo ~0.55) por lo que interpretar con MSAVI2 en etapas tempranas mejora la precisión.`,

  lechuga: `La lechuga tiene ciclo muy corto (45-75 días). En sistemas regenerativos se siembra en camas elevadas con compost maduro y cubierta de paja para evitar salpicado y enfermedades foliares. Riego por goteo subterráneo reduce Botritis. Al ser cultivo de hojas, el NDVI satura antes del óptimo (máx ~0.60): usar GNDVI para detectar estrés nitrogenado más preciso. Rotarla con crucíferas y solanáceas en bloque de 3 ciclos.`,

  ajo: `El ajo requiere suelos bien drenados con pH 6.0-7.5. La siembra directa de dientes en doble hilera mejora el aprovechamiento espacial. Biofertilización con Azospirillum + micorrizas reduce el N mineral en 30%. Es alelopático y puede suprimir hongos del suelo si se intercala en rotaciones. NDVI <0.25 a los 60 días de siembra indica marchitez, virosis (LYSV) o deficiencia de N.`,

  vid: `La vid en regenerativo se maneja con cubiertas vegetales en calles (vicia, trébol) para aumentar MO y controlar erosión. Poda mínima y sin herbicidas en filas restaura la microbiota rizosférica. La vid es cultivo perenne: el satélite la monitorea mejor con índices sensibles a clorofila (NDRE, GNDVI) durante la temporada vegetativa. NDVI <0.40 en envero (cuajado) indica estrés hídrico severo que afecta calidad de uva.`,

  manzano: `El manzano en sistemas regenerativos se beneficia de manejo agroforestal con pastoreo rotacional de aves o bovinos bajo la copa (controlan plagas del suelo). Cubiertas florales en calles atraen polinizadores y enemigos naturales. El período crítico satelital es cuajado-engrosamiento (junio-agosto): NDVI <0.55 puede indicar deficiencia de Ca/K o monilia. NDRE es mejor que NDVI para detectar estrés nitrogenado en árboles.`,

  citrus: `Los cítricos son perennes con dosel denso (NDVI estable 0.50-0.72 todo el año). La variación estacional es menor que en cultivos anuales: descensos >15% del NDVI basal son señal de alarma (Huanglongbing, sequía, carencia de Fe). En regenerativo: biofertilización con Azospirillum + Bacillus, mulch permanente de cáscara o paja bajo copa, corrección de pH con azufre elemental si >7.5. El N se aplica en tres fracciones según fenología.`,

  cana: `La caña de azúcar tiene el mayor NDVI de cultivos agroindustriales en elongación (0.60-0.82). En regenerativo: incorporar vinaza compostada con bagazo (relación 3:1) en vez de quema; corte en verde conserva MO y microbiota. La aplicación de Gluconacetobacter diazotrophicus reduce el N mineral hasta 40%. Una caída sostenida de NDVI en elongación indica déficit hídrico, carencia de N o mosca del cogollo.`,

  alfalfa: `La alfalfa es fijadora de N (Sinorhizobium meliloti): inoculación en siembra es indispensable. Pastoreo rotacional de bovinos después de postcorte es la práctica más regenerativa — acelera el rebrote y fertiga el suelo. El NDVI cae drásticamente a 0.10-0.30 inmediatamente después de cada corte: esto es normal y no debe interpretarse como alerta. Las series temporales deben analizarse por ciclo de corte, no de forma continua.`,

  sorgo: `El sorgo tiene alta tolerancia a sequía por raíces profundas y mecanismo C4. En regenerativo: sorgo-soja en intercalado reduce plagas y aprovecha el N fijado. El rastrojo de sorgo tiene alta relación C:N (80:1): mezclarlo con leguminosa en composta acelera la descomposición. NDVI bajo en espigado (0.55-0.78 esperado) puede indicar contaminación por ergot o deficiencia de Zn común en suelos arenosos.`,

  algodon: `El algodón en regenerativo reduce la dependencia de pesticidas con control biológico de picudo y gusano bellotero (Trichogramma, Bacillus thuringiensis). La labranza mínima post-cosecha y rastrojos enterrados en superficie mejoran la MO. En satélite, el período crítico es floración-formación de cápsulas (NDVI 0.50-0.72): descensos indican estrés hídrico, deficiencia de K o virosis. Rotar con maíz o sorgo cada 2 ciclos.`,
};

// ── EVI expected ranges [low, high] keyed by normalized crop → stage ──────────
// EVI is more accurate than NDVI in dense canopy; ranges slightly lower than NDVI.
export const EVI_BY_CROP_STAGE: Record<string, Record<string, [number, number]>> = {
  // Original 4 grains
  maiz:    { germinacion:[0.04,0.16], vegetativo:[0.28,0.55], floracion:[0.52,0.75], llenado:[0.42,0.68], maduracion:[0.15,0.38], cosecha:[0.04,0.20] },
  soja:    { germinacion:[0.04,0.16], vegetativo:[0.28,0.52], floracion:[0.45,0.70], llenado:[0.42,0.65], maduracion:[0.15,0.35], cosecha:[0.04,0.18] },
  trigo:   { germinacion:[0.04,0.16], macollaje:[0.22,0.45], encañado:[0.40,0.60], espigado:[0.50,0.70], llenado:[0.32,0.55], maduracion:[0.12,0.30] },
  girasol: { germinacion:[0.04,0.16], vegetativo:[0.32,0.55], floracion:[0.45,0.65], llenado:[0.28,0.48], maduracion:[0.12,0.30] },
  // New crops
  tomate:    { trasplante:[0.04,0.14], vegetativo:[0.22,0.46], floracion:[0.40,0.58], fructificacion:[0.36,0.55], maduracion:[0.18,0.38] },
  papa:      { germinacion:[0.04,0.14], vegetativo:[0.26,0.50], tuberizacion:[0.44,0.65], llenado:[0.36,0.58], maduracion:[0.14,0.33] },
  cebolla:   { siembra:[0.04,0.12], establecimiento:[0.08,0.22], vegetativo:[0.22,0.44], bulbificacion:[0.20,0.40], maduracion:[0.08,0.22] },
  lechuga:   { trasplante:[0.04,0.14], crecimiento:[0.18,0.40], engrose:[0.32,0.50], cosecha:[0.28,0.46] },
  ajo:       { siembra:[0.04,0.12], vegetativo:[0.22,0.44], bulbificacion:[0.20,0.40], maduracion:[0.08,0.22] },
  vid:       { brotacion:[0.08,0.22], vegetativo:[0.30,0.55], floracion:[0.40,0.58], cuajado:[0.42,0.62], maduracion:[0.22,0.42], postcosecha:[0.10,0.24] },
  manzano:   { brotacion:[0.08,0.22], vegetativo:[0.32,0.58], floracion:[0.40,0.58], fructificacion:[0.46,0.65], maduracion:[0.26,0.46], postcosecha:[0.12,0.28] },
  citrus:    { vegetativo:[0.38,0.60], floracion:[0.44,0.62], cuajado:[0.42,0.58], engrosamiento:[0.40,0.56], maduracion:[0.38,0.54] },
  cana:      { germinacion:[0.08,0.22], macollamiento:[0.25,0.48], elongacion:[0.48,0.70], maduracion:[0.30,0.55] },
  alfalfa:   { establecimiento:[0.08,0.26], vegetativo:[0.40,0.65], prefloracion:[0.52,0.68], postcorte:[0.08,0.26], rebrote:[0.28,0.50] },
  sorgo:     { germinacion:[0.04,0.16], vegetativo:[0.28,0.52], espigado:[0.44,0.65], llenado:[0.32,0.52], maduracion:[0.12,0.32] },
  algodon:   { germinacion:[0.04,0.16], vegetativo:[0.22,0.46], floracion:[0.40,0.58], capsulas:[0.32,0.50], maduracion:[0.12,0.33] },
};

// ── Crops with full satellite interpretation support ──────────────────────────
// Used by the UI to show a satellite badge next to supported crops.
export const SATELLITE_SUPPORTED_CROPS = new Set([
  "Maíz", "Soja", "Trigo", "Girasol",
  "Tomate", "Papa", "Cebolla", "Lechuga", "Ajo",
  "Vid", "Manzano", "Cítricos", "Limón", "Caña de Azúcar",
  "Alfalfa", "Sorgo", "Algodón",
]);

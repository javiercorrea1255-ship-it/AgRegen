/**
 * Optional live-provider evaluation. Synthetic context only: no DB or WhatsApp sends.
 * Run explicitly: npx tsx scripts/verify-whatsapp-map-semantics.ts
 * Consumes nine model calls; never runs as part of npm test.
 */
import { generateWhatsappTurn } from "../server/services/whatsapp-turn";

const card = `(a) Parcela de prueba, maíz, 9 ha, V6.
(b) Últimos 7 días: 3 mm de lluvia y 29 C de media; mañana se pronostican 20 mm.
(c) Suelo: materia orgánica 1.2 %, pH 6.5.
(d) NDVI previo 0.62, fecha 2026-11-10. No hay mapa actual leído.
(e) Riego el 16 de noviembre, 2 horas; 50 kg de urea el 12 de noviembre.
(f) Costo 1050 MXN. (g) Sin mensajes previos.`;
const cases = [
  { text: "mándame el mapa de mi parcela", index: "ndvi" },
  { text: "cómo se ve mi cultivo desde el satélite", index: "ndvi" },
  { text: "mapa NDVI", index: "ndvi" },
  { text: "dónde está más débil la milpa", index: "ndvi" },
  { text: "MAPA", index: "ndvi" },
  { text: "mándame un mapa de humedad", index: "ndmi" },
  { text: "el mapa de hace un mes", index: "ndvi", date: "2026-10-17" },
  { text: "compara el mapa más reciente con el anterior", index: "ndvi", compare: true },
  { text: "¿Debo regar mañana?", index: null },
];

async function main() {
  let failed = 0;
  for (const sample of cases) {
    try {
      const turn = await generateWhatsappTurn({
        text: sample.text, card, messageAt: new Date("2026-11-17T12:00:00Z"), mode: "brief",
        parcelContext: { parcel: { crop: "maíz", phenologicalStage: "V6" } } as any,
      });
      const pass = (sample.index ? turn.satelliteRequest?.index === sample.index : turn.satelliteRequest === null) &&
        (!sample.date || turn.satelliteRequest?.date === sample.date) &&
        (!sample.compare || turn.satelliteRequest?.compare === true) &&
        turn.record === null && (!sample.index || turn.response.length <= 220);
      console.log(JSON.stringify({ input: sample.text, request: turn.satelliteRequest,
        characters: turn.response.length, response: turn.response, model: turn.modelUsed, pass }));
      if (!pass) failed++;
    } catch (error) {
      console.error(JSON.stringify({ input: sample.text, pass: false,
        error: error instanceof Error ? error.message : "Provider failure" }));
      failed++;
    }
  }
  console.log(`Semantic map checks: ${cases.length - failed}/${cases.length} passed`);
  if (failed) process.exitCode = 1;
}
void main();

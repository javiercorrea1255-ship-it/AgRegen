type DetailMessage = { content: string; contextSnapshot?: any };
/** Repeated detail requests stay bound to the original query, not a format notice. */
export function whatsappDetailQuery(message: DetailMessage, fallbackQuestion?: string) {
  const snapshot = message.contextSnapshot || {};
  const previous = snapshot.fullResponse || message.content;
  const raw = snapshot.userText || fallbackQuestion || "Consulta anterior de esta conversación";
  const original = raw.match(/CONSULTA ORIGINAL:\s*([\s\S]*?)\nRESPUESTA ANTERIOR:/)?.[1] || raw;
  return `MÁS DETALLE. Consulta de ampliación, sin reportar hechos nuevos.
CONSULTA ORIGINAL: ${original}
RESPUESTA ANTERIOR: ${previous}
Amplía la recomendación técnica: qué hacer, cuánto si está sustentado, cuándo y por qué. No expliques avisos de formato.`;
}

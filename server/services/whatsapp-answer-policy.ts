/** Model decides relevance in the same call; this only enforces its structured decision. */
export function rainfedResponse(response: string, irrigationSystem: string | null | undefined,
  irrigationRequested: boolean) {
  if (!response.trim() || irrigationSystem !== "temporal" || irrigationRequested) return response;
  return response.split(/\n|(?<=[.!?])\s+/).filter(sentence =>
    !/\b(?:riego|rieg[au]\w*|regar|irrigaci[oó]n)\b/i.test(sentence)).join("\n").trim() ||
    "En temporal, revisa la humedad y el estado del cultivo en campo antes de decidir el manejo.";
}

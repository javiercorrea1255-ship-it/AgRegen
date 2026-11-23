import OpenAI from "openai";
import { z } from "zod";

export type NdviExplanationInput = {
  zoneIndex: number;
  meanNdvi: number;
  dose: number;
  unit: string;
  label: string;
};

const explanationSchema = z.object({
  explanations: z.array(z.object({
    zoneIndex: z.number().int(),
    explanation: z.string().trim().min(1).max(320),
  })),
});

/** Only prose is read back. No model-generated value can flow into a dose. */
export async function explainNdviNitrogen(zones: NdviExplanationInput[]): Promise<Map<number, string>> {
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return new Map();
  const client = new OpenAI({ apiKey, maxRetries: 0,
    ...(process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ? { baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL } : {}),
  });
  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    max_completion_tokens: 1000,
    messages: [
      { role: "system", content: 'Las dosis ya están fijadas. Explica brevemente en español el criterio relativo de vigor para cada zona. No incluyas cifras, dosis, ajustes, productos ni recomendaciones de aplicación. NDVI no diagnostica deficiencia de N. Devuelve solo {"explanations":[{"zoneIndex":0,"explanation":"texto"}]}.' },
      { role: "user", content: JSON.stringify(zones) },
    ],
  }, { timeout: 6000 });
  const { explanations } = explanationSchema.parse(JSON.parse(completion.choices[0]?.message.content ?? "{}"));
  return new Map(explanations.map(({ zoneIndex, explanation }) => [zoneIndex, explanation]));
}

import type { AnalysisProvider, ReportPayload } from "./types";
import { reportSchema } from "./types";

const SYSTEM_PROMPT = `Eres un asistente clínico que analiza transcripciones de sesiones de
psicoterapia en español (Colombia) para apoyar al profesional. NO emites diagnósticos.

Devuelve EXCLUSIVAMENTE un JSON con esta forma exacta (sin texto adicional):
{
  "summary": string (máx. 200 palabras, resumen ejecutivo de la sesión),
  "sentiment": {
    "score": number (-1 a 1, sentimiento global),
    "label": "negativo" | "neutral" | "positivo",
    "timeline": [{ "position": number (0 a 1), "score": number (-1 a 1) }, ...] (5 puntos)
  },
  "keywords": [{ "term": string, "weight": number (0 a 1) }, ...] (hasta 15, top palabras/temas),
  "topics": [string, ...] (3-5 temas recurrentes),
  "patterns": { "primera_persona": number, "negaciones": number, "dudas": number, "intensidad_emocional": number } (proporciones 0-1),
  "suggestion": string (sugerencia preliminar para el profesional; SIEMPRE aclara que no es diagnóstico)
}`;

/** Análisis real con OpenAI GPT-4o (JSON mode), validado con el mismo schema que el mock. */
export class OpenAIAnalysisProvider implements AnalysisProvider {
  readonly mode = "openai" as const;

  async analyze(transcript: string): Promise<ReportPayload> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY no está configurada");

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        response_format: { type: "json_object" },
        temperature: 0.3,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Transcripción:\n\n${transcript}` },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenAI respondió ${res.status}: ${body.slice(0, 300)}`);
    }

    const data = (await res.json()) as {
      choices: { message: { content: string } }[];
    };
    const raw = data.choices[0]?.message?.content;
    if (!raw) throw new Error("OpenAI no devolvió contenido");

    const parsed: unknown = JSON.parse(raw);
    return reportSchema.parse(parsed);
  }
}

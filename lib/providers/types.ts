import { z } from "zod";

/**
 * Esquema del reporte de análisis IA (validado con Zod 4).
 * Alimenta las secciones 2-6 del reporte clínico (ver spec §6).
 */
export const reportSchema = z.object({
  summary: z.string().min(1), // §2 Resumen ejecutivo
  sentiment: z.object({
    score: z.number().min(-1).max(1), // global −1..+1
    label: z.enum(["negativo", "neutral", "positivo"]),
    timeline: z.array(
      z.object({ position: z.number().min(0).max(1), score: z.number().min(-1).max(1) }),
    ),
  }),
  keywords: z.array(z.object({ term: z.string(), weight: z.number().min(0).max(1) })), // §4
  topics: z.array(z.string()),
  patterns: z.record(z.string(), z.number()), // §5: 1ª persona, negaciones, dudas, intensidad...
  suggestion: z.string().min(1), // §6 (editable, no es diagnóstico)
});

export type ReportPayload = z.infer<typeof reportSchema>;

export type ProviderMode = "mock" | "deepgram" | "openai";

/** Sesión efímera para transcripción en vivo (token nunca persiste). */
export interface TranscriptionSession {
  sessionToken: string;
  mode: ProviderMode;
  /** ms de validez del token. */
  expiresInMs: number;
}

export interface TranscriptionProvider {
  readonly mode: ProviderMode;
  createSession(consultationId: string): Promise<TranscriptionSession>;
}

export interface AnalysisProvider {
  readonly mode: ProviderMode;
  analyze(transcript: string): Promise<ReportPayload>;
}

import { z } from "zod";
import { riskLevelSchema } from "@/lib/risk-levels";
import type { AnalysisContext, ClinicalStateDelta } from "@/lib/clinical-state";

const riskFlag = z.object({
  level: riskLevelSchema,
  // Frase o paráfrasis del paciente que sustenta el nivel asignado (vacío si "ninguno").
  evidence: z.string(),
});

/** Alertas de riesgo detectadas en las palabras del paciente — apoyo a la decisión clínica,
 * nunca un diagnóstico ni un protocolo de crisis automatizado. */
export const riskFlagsSchema = z.object({
  suicidal_ideation: riskFlag,
  self_harm: riskFlag,
  substance_use: riskFlag,
  risk_to_others: riskFlag,
});

export type RiskFlags = z.infer<typeof riskFlagsSchema>;
export type { RiskLevel, RiskCategory } from "@/lib/risk-levels";

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
  // Opcional: reportes generados antes de esta versión no lo tienen.
  riskFlags: riskFlagsSchema.optional(),
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

/**
 * Procedencia de un output clínico generado por IA. Se persiste junto al
 * reporte: sin esto no se puede reproducir ni auditar una conclusión clínica
 * pasada, ni comparar la calidad de dos proveedores sobre los mismos casos.
 *
 * `promptVersion` DEBE incrementarse cada vez que cambia el prompt del
 * proveedor — si no, dos reportes con la misma versión declarada habrán sido
 * generados por prompts distintos y la trazabilidad miente.
 */
export interface AnalysisProvenance {
  /** Identificador exacto del modelo, p. ej. "gpt-4o". */
  model: string;
  /** Versión del prompt del proveedor, p. ej. "openai-clinical-v1". */
  promptVersion: string;
  /** Momento en que el proveedor devolvió el análisis (ISO 8601). */
  generatedAt: string;
}

export interface AnalysisResult {
  payload: ReportPayload;
  provenance: AnalysisProvenance;
  /** Observaciones de ESTA sesión para el estado clínico longitudinal — ver lib/clinical-state.ts. */
  stateDelta: ClinicalStateDelta;
}

export interface AnalysisProvider {
  readonly mode: ProviderMode;
  analyze(context: AnalysisContext): Promise<AnalysisResult>;
}

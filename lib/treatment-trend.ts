import type { AssessmentType, AssessmentResult } from "@/lib/psychometrics";

/**
 * Cambio mínimo clínicamente importante (MCID) por escala — el umbral bajo
 * el cual una diferencia de puntaje se considera ruido de medición propio
 * del instrumento, no una mejora o empeoramiento real. Valores ampliamente
 * citados en la literatura (PHQ-9: Löwe et al.; GAD-7: consenso similar en
 * la validación del instrumento), NO calibrados con datos propios de
 * E-Irene ni revisados todavía por un profesional de salud mental — son un
 * punto de partida defendible (no inventado), no una verdad ya validada.
 * Esto es un pendiente de revisión clínica DISTINTO del de
 * docs/revision-clinica-riesgo.md (ese documento es específico de los 16
 * casos de detección de riesgo, no de estos umbrales) — antes de mostrar
 * este resultado como respaldado, alguien con criterio clínico real debe
 * confirmar que 5/4 puntos son el umbral correcto para esta población y este
 * contexto de uso.
 */
export const MCID: Record<AssessmentType, number> = {
  phq9: 5,
  gad7: 4,
};

/**
 * Mínimo de mediciones antes de evaluar una tendencia. Con menos, cualquier
 * lectura es una fotografía aislada, no una tendencia — y sugerir "sin
 * mejora" a partir de 1-2 mediciones sería inventar precisión que los datos
 * no sostienen.
 */
const MIN_ASSESSMENTS = 3;

export type TreatmentTrendStatus = "insufficient_data" | "improving" | "stable" | "worsening";

export interface TreatmentTrendPoint {
  score: number;
  administeredAt: string;
}

export interface TreatmentTrend {
  type: AssessmentType;
  status: TreatmentTrendStatus;
  assessmentCount: number;
  baseline: TreatmentTrendPoint | null;
  latest: TreatmentTrendPoint | null;
  /** Positivo = mejora (el puntaje bajó desde la línea base). `null` si no hay suficientes datos. */
  change: number | null;
}

interface AssessmentLike {
  type: AssessmentType;
  result: AssessmentResult;
  administeredAt: string;
}

/**
 * Compara la medición más reciente contra la PRIMERA registrada (línea base
 * del tratamiento) — deliberadamente NO contra la medición inmediatamente
 * anterior. El ruido de un instrumento de autorreporte entre dos mediciones
 * consecutivas es demasiado alto para una conclusión confiable por sí solo;
 * comparar contra la línea base, con un umbral de cambio mínimo clínicamente
 * importante, es lo que hace defendible la comparación.
 *
 * Deliberadamente NO atribuye el cambio a ninguna técnica ni intervención
 * específica — con 2-5 sesiones por paciente no hay forma honesta de aislar
 * la causa de un cambio de puntaje (regresión a la media, otros factores de
 * vida, error de medición). Esto solo dice si el tratamiento, en conjunto,
 * muestra la mejora esperada; el porqué queda enteramente al criterio del
 * profesional.
 */
export function computeTreatmentTrend(
  assessments: AssessmentLike[],
  type: AssessmentType,
): TreatmentTrend {
  const sorted = assessments
    .filter((a) => a.type === type)
    .sort((a, b) => a.administeredAt.localeCompare(b.administeredAt));

  const baseline = sorted[0]
    ? { score: sorted[0].result.totalScore, administeredAt: sorted[0].administeredAt }
    : null;
  const latest = sorted[sorted.length - 1]
    ? { score: sorted[sorted.length - 1].result.totalScore, administeredAt: sorted[sorted.length - 1].administeredAt }
    : null;

  if (sorted.length < MIN_ASSESSMENTS) {
    return { type, status: "insufficient_data", assessmentCount: sorted.length, baseline, latest, change: null };
  }

  const change = baseline!.score - latest!.score;
  const threshold = MCID[type];
  const status: TreatmentTrendStatus =
    change >= threshold ? "improving" : change <= -threshold ? "worsening" : "stable";

  return { type, status, assessmentCount: sorted.length, baseline, latest, change };
}

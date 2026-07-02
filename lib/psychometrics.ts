/**
 * Escalas psicométricas estandarizadas (PHQ-9, GAD-7), versión validada en
 * español. Apoyo a la decisión clínica — NO reemplazan el juicio del
 * profesional ni constituyen un diagnóstico por sí solas.
 */

export type AssessmentType = "phq9" | "gad7";

export const RESPONSE_OPTIONS = [
  { value: 0, label: "Nunca" },
  { value: 1, label: "Varios días" },
  { value: 2, label: "Más de la mitad de los días" },
  { value: 3, label: "Casi todos los días" },
] as const;

export const PHQ9_QUESTIONS = [
  "Poco interés o placer en hacer las cosas",
  "Se ha sentido decaído(a), deprimido(a) o sin esperanzas",
  "Dificultad para quedarse o permanecer dormido(a), o ha dormido demasiado",
  "Se ha sentido cansado(a) o con poca energía",
  "Falta de apetito o ha comido en exceso",
  "Se ha sentido mal con usted mismo(a) — o que es un fracaso o que ha quedado mal con usted mismo(a) o con su familia",
  "Dificultad para concentrarse en cosas tales como leer el periódico o ver la televisión",
  "Se ha movido o hablado tan lento que otras personas podrían haberlo notado, o lo contrario: ha estado tan inquieto(a) o agitado(a) que ha estado moviéndose mucho más de lo normal",
  "Pensamientos de que estaría mejor muerto(a) o de lastimarse de alguna manera",
] as const;

export const GAD7_QUESTIONS = [
  "Sentirse nervioso(a), ansioso(a) o con los nervios de punta",
  "No poder dejar de preocuparse o controlar la preocupación",
  "Preocuparse demasiado por diferentes cosas",
  "Dificultad para relajarse",
  "Estar tan inquieto(a) que es difícil quedarse quieto(a)",
  "Molestarse o irritarse fácilmente",
  "Sentir miedo como si algo terrible pudiera pasar",
] as const;

export const ASSESSMENT_LABEL: Record<AssessmentType, string> = {
  phq9: "PHQ-9 (depresión)",
  gad7: "GAD-7 (ansiedad)",
};

export const ASSESSMENT_MAX_SCORE: Record<AssessmentType, number> = {
  phq9: 27,
  gad7: 21,
};

export function questionsFor(type: AssessmentType): readonly string[] {
  return type === "phq9" ? PHQ9_QUESTIONS : GAD7_QUESTIONS;
}

/** Índice (0-based) del ítem de ideación suicida/autolesión en el PHQ-9. */
export const PHQ9_SELF_HARM_ITEM_INDEX = 8;

export function severityFor(type: AssessmentType, total: number): string {
  if (type === "phq9") {
    if (total <= 4) return "Mínima";
    if (total <= 9) return "Leve";
    if (total <= 14) return "Moderada";
    if (total <= 19) return "Moderadamente severa";
    return "Severa";
  }
  // gad7
  if (total <= 4) return "Mínima";
  if (total <= 9) return "Leve";
  if (total <= 14) return "Moderada";
  return "Severa";
}

export interface AssessmentResult {
  answers: number[];
  totalScore: number;
  severity: string;
}

/** Valida y puntúa las respuestas (cada una 0-3) para el tipo de escala dado. */
export function scoreAssessment(type: AssessmentType, answers: number[]): AssessmentResult {
  const expected = questionsFor(type).length;
  if (answers.length !== expected) {
    throw new Error(`Se esperaban ${expected} respuestas para ${type}, llegaron ${answers.length}`);
  }
  for (const a of answers) {
    if (!Number.isInteger(a) || a < 0 || a > 3) {
      throw new Error("Cada respuesta debe ser un entero entre 0 y 3");
    }
  }
  const totalScore = answers.reduce((sum, a) => sum + a, 0);
  return { answers, totalScore, severity: severityFor(type, totalScore) };
}

/**
 * Enfoques terapéuticos reconocidos — lista curada, no texto libre.
 *
 * Dos razones para que sea cerrada: (1) un valor libre rompería el
 * emparejamiento por texto exacto que el resto del sistema usa para
 * continuidad (ver lib/clinical-state.ts), y (2) le da al prompt del
 * proveedor de IA (lib/providers/openai.ts) un vocabulario cerrado sobre el
 * que razonar, en vez de que el doctor escriba algo distinto cada vez.
 */
export type TherapeuticApproach =
  | "tcc"
  | "act"
  | "dbt"
  | "psicodinamico"
  | "sistemico"
  | "humanista"
  | "emdr"
  | "integrador";

export const THERAPEUTIC_APPROACHES: TherapeuticApproach[] = [
  "tcc",
  "act",
  "dbt",
  "psicodinamico",
  "sistemico",
  "humanista",
  "emdr",
  "integrador",
];

export const APPROACH_LABEL: Record<TherapeuticApproach, string> = {
  tcc: "Terapia Cognitivo-Conductual (TCC)",
  act: "Terapia de Aceptación y Compromiso (ACT)",
  dbt: "Terapia Dialéctico-Conductual (DBT)",
  psicodinamico: "Psicodinámico",
  sistemico: "Sistémico / terapia familiar",
  humanista: "Humanista",
  emdr: "EMDR",
  integrador: "Integrador / ecléctico",
};

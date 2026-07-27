import { z } from "zod";

export const riskLevelSchema = z.enum(["ninguno", "bajo", "moderado", "alto"]);
export type RiskLevel = z.infer<typeof riskLevelSchema>;

/**
 * Las 4 categorías de riesgo del prompt clínico (ver lib/providers/openai.ts).
 * Vive en un archivo sin dependencias propias porque tanto
 * `lib/providers/types.ts` (RiskFlags) como `lib/clinical-state.ts`
 * (ClinicalStateRiesgo) lo necesitan — ponerlo en cualquiera de los dos
 * crearía un import circular entre ambos.
 */
export type RiskCategory = "suicidal_ideation" | "self_harm" | "substance_use" | "risk_to_others";

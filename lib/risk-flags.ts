import type { ReportPayload, RiskFlags, RiskLevel } from "@/lib/providers/types";

export interface RiskAlertCategory {
  key: keyof RiskFlags;
  level: RiskLevel;
  /** Cita textual o paráfrasis del paciente que sustenta el nivel. Nunca vacía aquí. */
  evidence: string;
}

/**
 * Niveles que ameritan alertar al doctor tratante — ver spec §5. Exportado
 * (no solo de uso interno) porque `tests/risk-eval/scoring.ts` lo reutiliza:
 * el harness de evaluación mide exactamente esta pregunta operacional —
 * "¿un caso que debería alertar efectivamente cruza este umbral?" — y debe
 * compartir la misma definición de umbral que el código de producción, no
 * una copia que pueda desincronizarse.
 */
export const ALERT_LEVELS = new Set<RiskLevel>(["moderado", "alto"]);

/**
 * A partir del `riskFlags` de un análisis, extrae las categorías que ameritan
 * alerta. Vacío si no hay ninguna en nivel moderado/alto — nunca se genera
 * una alerta sin evidencia adjunta, porque ninguna categoría en "ninguno" o
 * "bajo" produce una entrada aquí, y las que sí producen entrada siempre
 * traen `evidence` no vacía (garantizado por el prompt del proveedor, ver
 * lib/providers/openai.ts).
 */
export function extractRiskAlertCategories(
  riskFlags: ReportPayload["riskFlags"] | undefined,
): RiskAlertCategory[] {
  if (!riskFlags) return [];
  return (Object.entries(riskFlags) as [keyof RiskFlags, RiskFlags[keyof RiskFlags]][])
    .filter(([, v]) => ALERT_LEVELS.has(v.level))
    .map(([key, v]) => ({ key, level: v.level, evidence: v.evidence }));
}

export const RISK_CATEGORY_LABEL: Record<keyof RiskFlags, string> = {
  suicidal_ideation: "Ideación suicida",
  self_harm: "Autolesión",
  substance_use: "Consumo de sustancias",
  risk_to_others: "Riesgo a terceros",
};

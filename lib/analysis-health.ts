/**
 * Salud del análisis con IA de las consultas, para /admin/canales.
 *
 * Existe porque el panel de canales solo mira si hay credencial. Con la clave de
 * OpenAI puesta y la cuenta sin créditos mostraba "activo" mientras cada análisis
 * fallaba (septiembre de 2026). De ese análisis salen el reporte y las alertas de
 * riesgo de la transcripción: un fallo sostenido no puede pasar desapercibido.
 *
 * Lógica pura; la lectura de audit_logs está en lib/db/analysis-health.ts.
 *
 * Nunca devuelve el texto del error, solo su causa: el mensaje puede traer
 * fragmentos de lo que respondió el modelo, es decir, contenido clínico.
 */

export type AnalysisFailureCause =
  | "quota"
  | "rate_limit"
  | "credentials"
  | "provider_error"
  | "not_configured"
  | "other";

export const ANALYSIS_FAILURE_CAUSE_LABELS: Record<AnalysisFailureCause, string> = {
  quota: "OpenAI sin créditos o con la cuota agotada",
  rate_limit: "Límite de uso por minuto de OpenAI",
  credentials: "OpenAI rechazó la clave",
  provider_error: "OpenAI no respondió o devolvió un error",
  not_configured: "OPENAI_API_KEY sin configurar",
  other: "Otro error del análisis",
};

/**
 * Causa de un fallo a partir del mensaje que guarda runConsultationAnalysis.
 * Los formatos salen de lib/providers/openai.ts: "OpenAI respondió <status>:
 * <cuerpo>", "OPENAI_API_KEY no está configurada", "OpenAI no devolvió contenido".
 */
export function classifyAnalysisError(message: string | null | undefined): AnalysisFailureCause {
  const m = (message ?? "").toLowerCase();

  // Antes que el 429 genérico: la cuota agotada también llega como 429, pero no
  // se arregla esperando, sino recargando la cuenta.
  if (/insufficient_quota|credit_balance_exhausted|exceeded your current quota|billing_hard_limit/.test(m)) {
    return "quota";
  }
  if (m.includes("openai_api_key no está configurada")) return "not_configured";

  const status = /openai respondió (\d{3})/.exec(m)?.[1];
  if (status === "429") return "rate_limit";
  if (status === "401" || status === "403") return "credentials";
  if (
    status?.startsWith("5") ||
    m.includes("openai no devolvió contenido") ||
    /fetch failed|etimedout|econnreset/.test(m)
  ) {
    return "provider_error";
  }
  return "other";
}

export type AnalysisHealthState =
  /** Sin fallos en los últimos 7 días. */
  | "ok"
  /** Hubo fallos, pero después un análisis salió bien. */
  | "recovered"
  /** El último intento falló y ninguno ha salido bien desde entonces. */
  | "failing";

export interface AnalysisHealth {
  state: AnalysisHealthState;
  failedLast24h: number;
  failedLast7d: number;
  lastFailureAt: string | null;
  lastSuccessAt: string | null;
  /** Causas de los fallos de los últimos 7 días, de la más a la menos frecuente. */
  causes: { cause: AnalysisFailureCause; count: number }[];
  /** Las causas salen de una muestra: hubo más fallos de los que se leyeron. */
  causesSampled: boolean;
}

export function summarizeAnalysisHealth(input: {
  failedLast24h: number;
  failedLast7d: number;
  /** Mensajes de los fallos leídos de la ventana de 7 días (puede ser una muestra). */
  recentErrors: (string | null | undefined)[];
  lastFailureAt: string | null;
  lastSuccessAt: string | null;
}): AnalysisHealth {
  const counts = new Map<AnalysisFailureCause, number>();
  for (const error of input.recentErrors) {
    const cause = classifyAnalysisError(error);
    counts.set(cause, (counts.get(cause) ?? 0) + 1);
  }
  const causes = [...counts]
    .map(([cause, count]) => ({ cause, count }))
    .sort((a, b) => b.count - a.count);

  // Mira el último fallo de siempre, no solo los de la ventana: si el último
  // intento falló hace 10 días y no hubo otro, el análisis sigue sin funcionar.
  const failing =
    input.lastFailureAt !== null &&
    (input.lastSuccessAt === null ||
      Date.parse(input.lastFailureAt) > Date.parse(input.lastSuccessAt));

  return {
    state: failing ? "failing" : input.failedLast7d > 0 ? "recovered" : "ok",
    failedLast24h: input.failedLast24h,
    failedLast7d: input.failedLast7d,
    lastFailureAt: input.lastFailureAt,
    lastSuccessAt: input.lastSuccessAt,
    causes,
    causesSampled: input.recentErrors.length < input.failedLast7d,
  };
}

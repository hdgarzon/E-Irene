/**
 * Logging estructurado (JSON, una línea por evento) para Server Actions y
 * route handlers. Sin dependencias externas ni proveedor de error tracking:
 * escribe a stdout/stderr, que Vercel (y `supabase`/`next dev` en local)
 * recolecta como logs. Pensado para poder conectar un proveedor externo
 * (Sentry u otro) después sin tocar los call sites — solo el transporte
 * de esta función cambiaría.
 *
 * Uso: logger.error("consultation.end_failed", { clinicId, actorId, error });
 * El primer argumento es un código de evento estable (para poder buscar/
 * agrupar en los logs), no una frase libre.
 */

type LogContext = Record<string, unknown> & { error?: unknown };

function serializeError(error: unknown): { message: string; stack?: string } | undefined {
  if (error === undefined) return undefined;
  if (error instanceof Error) return { message: error.message, stack: error.stack };
  return { message: String(error) };
}

function emit(level: "info" | "warn" | "error", event: string, context: LogContext = {}) {
  const { error, ...rest } = context;
  const line = {
    level,
    event,
    timestamp: new Date().toISOString(),
    ...rest,
    ...(error !== undefined ? { error: serializeError(error) } : {}),
  };
  const out = JSON.stringify(line);
  if (level === "error") console.error(out);
  else if (level === "warn") console.warn(out);
  else console.info(out);
}

export const logger = {
  info: (event: string, context?: LogContext) => emit("info", event, context),
  warn: (event: string, context?: LogContext) => emit("warn", event, context),
  error: (event: string, context?: LogContext) => emit("error", event, context),
};

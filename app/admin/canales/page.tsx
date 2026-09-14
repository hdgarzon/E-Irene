import { CheckCircle2, ShieldAlert, TriangleAlert } from "lucide-react";
import { getChannelStatuses } from "@/lib/channel-status";
import { getAnalysisHealth } from "@/lib/db/analysis-health";
import { ANALYSIS_FAILURE_CAUSE_LABELS, type AnalysisHealth } from "@/lib/analysis-health";
import { formatFullDate, formatTime } from "@/lib/dates";
import { logger } from "@/lib/logger";

function when(iso: string): string {
  return `${formatFullDate(iso)}, ${formatTime(iso)}`;
}

/** Historial del análisis con IA, debajo de su canal. */
function AnalysisHealthDetail({ health }: { health: AnalysisHealth }) {
  if (health.state === "ok") {
    return (
      <p className="mt-1 text-sm text-muted-foreground">
        Sin análisis fallidos en los últimos 7 días.
        {health.lastSuccessAt && ` Último análisis exitoso: ${when(health.lastSuccessAt)}.`}
      </p>
    );
  }

  return (
    <div className="mt-2 space-y-1 text-sm">
      <p className={health.state === "failing" ? "text-red-900" : "text-amber-900"}>
        Fallidos: {health.failedLast24h} en 24 horas · {health.failedLast7d} en 7 días.
      </p>
      <p className="text-muted-foreground">
        {health.lastFailureAt && `Último fallo: ${when(health.lastFailureAt)}. `}
        {health.lastSuccessAt
          ? `Último análisis exitoso: ${when(health.lastSuccessAt)}.`
          : "Ningún análisis ha salido bien."}
      </p>
      {health.causes.length > 0 && (
        <ul className="list-inside list-disc text-muted-foreground">
          {health.causes.map((c) => (
            <li key={c.cause}>
              {ANALYSIS_FAILURE_CAUSE_LABELS[c.cause]}: {c.count}
            </li>
          ))}
        </ul>
      )}
      {health.causesSampled && (
        <p className="text-xs text-muted-foreground">
          Causas calculadas sobre los fallos más recientes; los conteos incluyen todos.
        </p>
      )}
    </div>
  );
}

/**
 * Estado de los proveedores externos.
 *
 * Existe porque la ausencia de una credencial no produce ningún error: el
 * proveedor degrada a un modo simulado y la aplicación sigue como si nada.
 * Sin esta pantalla, la única forma de enterarse era leer el código o
 * descubrirlo cuando un paciente no recibía su enlace.
 *
 * Tener la credencial tampoco basta: una cuenta sin créditos la conserva y falla
 * igual. Para el análisis con IA se muestra además lo que de verdad pasó con los
 * últimos intentos.
 */
export default async function AdminCanalesPage() {
  const channels = getChannelStatuses();
  const simulados = channels.filter((c) => c.mode === "simulated");

  let health: AnalysisHealth | null = null;
  try {
    health = await getAnalysisHealth();
  } catch (error) {
    // Se muestra el fallo de lectura en la página: callar aquí sería volver a
    // no enterarse.
    logger.error("admin_canales.analysis_health_failed", { error });
  }
  const analysisFailing = health?.state === "failing";
  const mainCause = health?.causes[0]?.cause;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy">Estado de los canales</h1>
        <p className="text-sm text-muted-foreground">
          Un canal sin credenciales no falla: se simula. Esta pantalla existe para que eso no pase
          desapercibido.
        </p>
      </div>

      {analysisFailing && health && (
        <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-5">
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-red-700" />
          <div className="space-y-1">
            <p className="font-medium text-red-900">El análisis con IA está fallando</p>
            <p className="text-sm text-red-900/80">
              {health.lastFailureAt && `El último intento falló el ${when(health.lastFailureAt)}. `}
              {health.lastSuccessAt
                ? `El último análisis exitoso fue el ${when(health.lastSuccessAt)}.`
                : "Ningún análisis ha salido bien."}
              {mainCause && ` Causa más frecuente: ${ANALYSIS_FAILURE_CAUSE_LABELS[mainCause]}.`}
            </p>
            <p className="text-sm text-red-900/80">
              Mientras siga así, las consultas finalizadas no generan reporte ni alertas de riesgo a
              partir de la transcripción.
            </p>
          </div>
        </div>
      )}

      {!health && (
        <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-5">
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-red-700" />
          <div>
            <p className="font-medium text-red-900">No se pudo leer el historial del análisis con IA</p>
            <p className="text-sm text-red-900/80">
              No es posible saber si los análisis están funcionando. El detalle quedó en los logs
              como admin_canales.analysis_health_failed.
            </p>
          </div>
        </div>
      )}

      {simulados.length > 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-amber-700" />
          <div>
            <p className="font-medium text-amber-900">
              {simulados.length} {simulados.length === 1 ? "canal" : "canales"} en modo simulado
            </p>
            <p className="text-sm text-amber-900/80">
              Configura las variables que faltan y vuelve a desplegar para que tomen efecto.
            </p>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-gray-line bg-card">
        <ul className="divide-y divide-gray-line">
          {channels.map((c) => {
            const failing = c.key === "analysis" && c.mode === "live" && analysisFailing;
            return (
              <li key={c.key} className="flex flex-wrap items-start gap-3 p-5">
                {failing ? (
                  <ShieldAlert className="mt-0.5 size-5 shrink-0 text-red-600" />
                ) : c.mode === "live" ? (
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" />
                ) : (
                  <TriangleAlert className="mt-0.5 size-5 shrink-0 text-amber-600" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-navy">{c.label}</p>
                  {c.mode === "live" ? (
                    <p className="text-sm text-muted-foreground">
                      {failing ? "Configurado, pero los análisis están fallando." : "Configurado y activo."}
                    </p>
                  ) : (
                    <>
                      <p className="text-sm text-amber-900">{c.impact}</p>
                      {c.missing.length > 0 && (
                        <p className="mt-1 font-mono text-xs text-muted-foreground">
                          Falta: {c.missing.join(", ")}
                        </p>
                      )}
                    </>
                  )}
                  {c.key === "analysis" && health && <AnalysisHealthDetail health={health} />}
                </div>
                <span
                  className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
                    failing
                      ? "bg-red-100 text-red-900"
                      : c.mode === "live"
                        ? "bg-emerald-100 text-emerald-900"
                        : "bg-amber-100 text-amber-900"
                  }`}
                >
                  {failing ? "Fallando" : c.mode === "live" ? "Activo" : "Simulado"}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

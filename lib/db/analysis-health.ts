import { createAdminClient } from "@/lib/supabase/admin";
import { summarizeAnalysisHealth, type AnalysisHealth } from "@/lib/analysis-health";

const FAILED = "report.generation_failed";
const GENERATED = "report.generated";

/** Fallos que se leen para clasificar la causa. Los conteos son exactos igual. */
const CAUSE_SAMPLE = 500;

function errorOf(metadata: unknown): string | null {
  const error = (metadata as { error?: unknown } | null)?.error;
  return typeof error === "string" ? error : null;
}

/**
 * Análisis fallidos y exitosos de todas las clínicas, leídos de audit_logs.
 *
 * audit_logs y no consultations.analysis_status: el estado de la consulta se
 * sobrescribe en cada reintento y su updated_at cambia con cualquier edición. El
 * audit trail guarda cada intento con su hora.
 *
 * Service-role: el admin de plataforma no pertenece a las clínicas y la política
 * audit_select es por clínica. La autorización la hace el layout de /admin
 * (requirePlatformAdmin).
 *
 * Lanza si alguna lectura falla: el panel tiene que decir que no pudo leer el
 * historial, no mostrar un "sin fallos" que no comprobó.
 *
 * @param options.now       fin de la ventana; por defecto, ahora.
 * @param options.clinicId  limita la lectura a una clínica. Lo usan las pruebas,
 *   que corren en paralelo con otras suites que escriben en audit_logs.
 */
export async function getAnalysisHealth(
  options: { now?: Date; clinicId?: string } = {},
): Promise<AnalysisHealth> {
  const admin = createAdminClient();
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const since24h = new Date(now.getTime() - 86400000).toISOString();
  const since7d = new Date(now.getTime() - 7 * 86400000).toISOString();

  let recent = admin
    .from("audit_logs")
    .select("created_at, metadata", { count: "exact" })
    .eq("action", FAILED)
    .gte("created_at", since7d)
    .lte("created_at", nowIso);
  let lastDay = admin
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("action", FAILED)
    .gte("created_at", since24h)
    .lte("created_at", nowIso);
  let lastFailure = admin
    .from("audit_logs")
    .select("created_at")
    .eq("action", FAILED)
    .lte("created_at", nowIso);
  let lastSuccess = admin
    .from("audit_logs")
    .select("created_at")
    .eq("action", GENERATED)
    .lte("created_at", nowIso);

  if (options.clinicId) {
    recent = recent.eq("clinic_id", options.clinicId);
    lastDay = lastDay.eq("clinic_id", options.clinicId);
    lastFailure = lastFailure.eq("clinic_id", options.clinicId);
    lastSuccess = lastSuccess.eq("clinic_id", options.clinicId);
  }

  const [recentRes, lastDayRes, lastFailureRes, lastSuccessRes] = await Promise.all([
    recent.order("created_at", { ascending: false }).limit(CAUSE_SAMPLE),
    lastDay,
    lastFailure.order("created_at", { ascending: false }).limit(1).maybeSingle(),
    lastSuccess.order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  for (const res of [recentRes, lastDayRes, lastFailureRes, lastSuccessRes]) {
    if (res.error) throw res.error;
  }

  const rows = recentRes.data ?? [];
  return summarizeAnalysisHealth({
    failedLast24h: lastDayRes.count ?? 0,
    failedLast7d: recentRes.count ?? rows.length,
    recentErrors: rows.map((row) => errorOf(row.metadata)),
    lastFailureAt: lastFailureRes.data?.created_at ?? null,
    lastSuccessAt: lastSuccessRes.data?.created_at ?? null,
  });
}

import { createClient } from "@/lib/supabase/server";
import { transcriptionLimitSeconds, type Plan } from "@/lib/plans";

/**
 * Medición y cuota de transcripción (ver migración 0039_transcription_usage):
 * la cuota mide la duración de la consulta con sesión de transcripción
 * otorgada, UNA vez por consulta — aunque el modo video abra 2 conexiones
 * Deepgram. La tabla está bloqueada (RLS sin políticas); todo pasa por RPCs
 * SECURITY DEFINER que fijan el tenant con auth_clinic_id().
 */

export interface TranscriptionQuota {
  /** false = cuota mensual agotada: NO acuñar token de Deepgram. */
  allowed: boolean;
  usedSeconds: number;
  /** Límite del plan más las bolsas vigentes; null = ilimitado (enterprise). */
  limitSeconds: number | null;
}

/**
 * Abre (o retoma) la sesión de transcripción de la consulta contra la cuota
 * mensual del plan de la clínica. Idempotente por consulta: recargar la
 * página live no duplica el consumo. El límite sale de lib/plans.ts.
 *
 * `clinicId` se recibe explícito (de `requireUser()`) en vez de dejar que RLS
 * acote un `.single()` sin filtro: para un platform admin (migración 0014,
 * `clinic_select` añade `or is_platform_admin()`) esa consulta devolvería
 * TODAS las clínicas y `.single()` fallaría con PGRST116 en cuanto ese admin
 * también fuera miembro de una clínica.
 */
export async function beginTranscriptionSession(
  consultationId: string,
  clinicId: string,
): Promise<TranscriptionQuota> {
  const supabase = await createClient();
  const { data: clinic, error: clinicError } = await supabase
    .from("clinics")
    .select("plan")
    .eq("id", clinicId)
    .single();
  if (clinicError) throw clinicError;
  const limitSeconds = transcriptionLimitSeconds((clinic?.plan ?? "free") as Plan);

  const { data, error } = await supabase.rpc("begin_transcription_session", {
    p_consultation_id: consultationId,
    p_limit_seconds: limitSeconds,
  });
  if (error) throw error;
  // Las horas de bolsas vigentes (migración 0057) las resuelve la base: no se
  // pasan por parámetro, así que no se pueden inflar desde aquí.
  const result = data as { allowed: boolean; used_seconds: number; extra_seconds?: number };
  const extraSeconds = Number(result.extra_seconds ?? 0);
  return {
    allowed: Boolean(result.allowed),
    usedSeconds: Number(result.used_seconds ?? 0),
    limitSeconds: limitSeconds === null ? null : limitSeconds + extraSeconds,
  };
}

/**
 * Registra la duración real (ended_at − inicio de sesión) al terminar la
 * consulta. Idempotente; sin efecto si la sesión fue negada por cuota (no
 * hay fila) o si la consulta sigue en curso.
 */
export async function finalizeTranscriptionSession(consultationId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("finalize_transcription_session", {
    p_consultation_id: consultationId,
  });
  if (error) throw error;
}

export interface TranscriptionUsage {
  usedSeconds: number;
  sessions: number;
  /** Segundos de bolsas vigentes que se suman al límite del plan (migración 0057). */
  extraSeconds: number;
  /** Cuándo vence la última bolsa vigente, o null si no hay. */
  extraValidUntil: string | null;
}

/** Consumo del ciclo vigente de la clínica del usuario, con sus horas adicionales. */
export async function getTranscriptionUsage(): Promise<TranscriptionUsage> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_transcription_usage");
  if (error) throw error;
  const r = data as {
    used_seconds: number;
    sessions: number;
    extra_seconds?: number;
    extra_valid_until?: string | null;
  };
  return {
    usedSeconds: Number(r?.used_seconds ?? 0),
    sessions: Number(r?.sessions ?? 0),
    extraSeconds: Number(r?.extra_seconds ?? 0),
    extraValidUntil: r?.extra_valid_until ?? null,
  };
}

// El consumo por clínica de la consola de plataforma viene de
// get_platform_clinic_stats (lib/db/platform-console.ts), acotado a la página
// mostrada: get_platform_transcription_usage devolvía todas y PostgREST las
// cortaba en 1000.

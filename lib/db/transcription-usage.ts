import { createClient } from "@/lib/supabase/server";
import { transcriptionLimitSeconds, type Plan } from "@/lib/plans";

/**
 * Medición y cuota de transcripción (ver migración 0038_transcription_usage):
 * la cuota mide la duración de la consulta con sesión de transcripción
 * otorgada, UNA vez por consulta — aunque el modo video abra 2 conexiones
 * Deepgram. La tabla está bloqueada (RLS sin políticas); todo pasa por RPCs
 * SECURITY DEFINER que fijan el tenant con auth_clinic_id().
 */

export interface TranscriptionQuota {
  /** false = cuota mensual agotada: NO acuñar token de Deepgram. */
  allowed: boolean;
  usedSeconds: number;
  /** null = ilimitado (enterprise). */
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
  const result = data as { allowed: boolean; used_seconds: number };
  return {
    allowed: Boolean(result.allowed),
    usedSeconds: Number(result.used_seconds ?? 0),
    limitSeconds,
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
}

/** Consumo del mes en curso (zona Bogotá) de la clínica del usuario. */
export async function getTranscriptionUsage(): Promise<TranscriptionUsage> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_transcription_usage");
  if (error) throw error;
  const r = data as { used_seconds: number; sessions: number };
  return { usedSeconds: Number(r?.used_seconds ?? 0), sessions: Number(r?.sessions ?? 0) };
}

export interface PlatformTranscriptionUsage {
  clinicId: string;
  usedSeconds: number;
  sessions: number;
}

/** Consumo del mes de TODAS las clínicas — solo platform admin (consola). */
export async function getPlatformTranscriptionUsage(): Promise<PlatformTranscriptionUsage[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_platform_transcription_usage");
  if (error) throw error;
  return (data ?? []).map((r) => ({
    clinicId: r.clinic_id,
    usedSeconds: Number(r.used_seconds),
    sessions: Number(r.sessions),
  }));
}

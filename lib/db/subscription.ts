import { createClient } from "@/lib/supabase/server";

/**
 * Cancelación de la suscripción desde la sesión del admin de la clínica.
 *
 * Las reglas y el registro en audit_logs viven en la base
 * (request_subscription_cancellation / revert_subscription_cancellation,
 * migración 0041): exigen rol admin y fijan la clínica con auth_clinic_id(), así
 * que una llamada directa a la API tampoco puede cancelar otra clínica ni
 * saltarse el rol.
 */

export type CancellationStatus = "scheduled" | "already_scheduled" | "ended";

export interface CancellationResult {
  status: CancellationStatus;
  /** Desde cuándo rige: el fin del período pagado, o ahora si terminó de inmediato. */
  effectiveAt: string;
}

export async function requestSubscriptionCancellation(): Promise<CancellationResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_subscription_cancellation");
  if (error) throw error;
  const r = data as { status: CancellationStatus; effective_at: string };
  return { status: r.status, effectiveAt: r.effective_at };
}

export type RevertStatus = "reverted" | "not_scheduled" | "too_late";

export async function revertSubscriptionCancellation(): Promise<RevertStatus> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("revert_subscription_cancellation");
  if (error) throw error;
  return (data as { status: RevertStatus }).status;
}

import { createClient } from "@/lib/supabase/server";
import type { Plan } from "@/lib/plans";

/**
 * Cancelación y cambios programados de la suscripción, desde la sesión del admin
 * de la clínica.
 *
 * Las reglas y el registro en audit_logs viven en la base
 * (request_subscription_cancellation / revert_subscription_cancellation, 0041;
 * schedule_plan_downgrade / cancel_scheduled_plan_change, 0056): exigen rol admin
 * y fijan la clínica con auth_clinic_id(), así que una llamada directa a la API
 * tampoco puede tocar otra clínica ni saltarse el rol.
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

export type DowngradeStatus =
  | "scheduled"
  | "already_scheduled"
  | "invalid_plan"
  | "not_a_downgrade"
  | "canceling"
  | "no_active_period";

export interface DowngradeResult {
  status: DowngradeStatus;
  /** Desde cuándo rige el plan menor: el fin del período pagado. */
  effectiveAt: string | null;
}

/** Programa bajar a un plan pago menor desde la próxima renovación. */
export async function schedulePlanDowngrade(plan: Plan): Promise<DowngradeResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("schedule_plan_downgrade", { p_plan: plan });
  if (error) throw error;
  const r = data as { status: DowngradeStatus; effective_at?: string | null };
  return { status: r.status, effectiveAt: r.effective_at ?? null };
}

export type ScheduledChangeCancelStatus = "canceled" | "not_scheduled";

/** Anula el downgrade programado: la clínica conserva su plan en la renovación. */
export async function cancelScheduledPlanChange(): Promise<ScheduledChangeCancelStatus> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cancel_scheduled_plan_change");
  if (error) throw error;
  return (data as { status: ScheduledChangeCancelStatus }).status;
}

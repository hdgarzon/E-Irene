import { createAdminClient } from "@/lib/supabase/admin";
import { encrypt, decrypt } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import { PLANS, type Plan } from "@/lib/plans";

export type BillingStatus = "sin_configurar" | "activo" | "pendiente" | "vencido" | "suspendido";

/** true si la clínica existe — usado por el webhook para no aceptar referencias con un clinicId inventado. */
export async function clinicExists(clinicId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("clinics").select("id").eq("id", clinicId).maybeSingle();
  if (error) throw error;
  return data !== null;
}

/**
 * Registra un evento de transacción de Wompi. Idempotente por
 * (wompi_transaction_id, status) — ver migración 0027: un reintento de
 * entrega del mismo evento (Wompi reintenta si no respondemos 2xx a tiempo)
 * no debe duplicar el registro. `isNew: false` le indica al caller que el
 * evento ya se procesó antes y no debe repetir efectos secundarios (activar
 * el plan, etc).
 */
export async function recordBillingEvent(input: {
  clinicId: string;
  wompiTransactionId: string;
  wompiEvent: string;
  status: string;
  amountInCents: number;
  rawPayload: unknown;
}): Promise<{ isNew: boolean }> {
  const admin = createAdminClient();
  const { error } = await admin.from("billing_events").insert({
    clinic_id: input.clinicId,
    wompi_transaction_id: input.wompiTransactionId,
    wompi_event: input.wompiEvent,
    status: input.status,
    amount_in_cents: input.amountInCents,
    raw_payload_enc: encrypt(JSON.stringify(input.rawPayload)),
  });
  if (!error) return { isNew: true };
  // 23505 = unique_violation → mismo (transaction_id, status) ya registrado.
  if (error.code === "23505") return { isNew: false };
  throw error;
}

/**
 * Activa la facturación de la clínica tras un pago aprobado. `periodDays`
 * es fijo en 30 por ahora (no hay ciclos mensuales reales de calendario
 * todavía — eso lo resuelve el cron de la Fase 3, que además decide qué
 * pasa si el cobro del mes siguiente falla).
 */
export async function activateBilling(
  clinicId: string,
  plan: Plan,
  paymentSourceId: string | null,
  periodDays = 30,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("clinics")
    .update({
      plan,
      billing_status: "activo",
      current_period_end: new Date(Date.now() + periodDays * 24 * 60 * 60 * 1000).toISOString(),
      wompi_payment_source_id_enc: paymentSourceId ? encrypt(paymentSourceId) : undefined,
    })
    .eq("id", clinicId);
  if (error) throw error;
  logger.info("billing.activated", { clinicId, plan, periodDays });
}

export interface ClinicDueForCharge {
  id: string;
  plan: Plan;
  currentPeriodEnd: string | null;
  wompiPaymentSourceId: string | null;
}

/**
 * Clínicas que necesitan ser cobradas: plan de pago, billing_status activo (o
 * vencido, para reprocesar), y current_period_end vencido o a punto de vencer
 * en los próximos 3 días.
 */
export async function getClinicsDueForCharge(): Promise<ClinicDueForCharge[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("clinics")
    .select("id, plan, current_period_end, wompi_payment_source_id_enc")
    .in("plan", ["pro", "clinica", "enterprise"] as Plan[])
    .in("billing_status", ["activo", "vencido"])
    .lte("current_period_end", new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString());
  if (error) throw error;

  return (data ?? []).map((r) => ({
    id: r.id,
    plan: r.plan as Plan,
    currentPeriodEnd: r.current_period_end,
    wompiPaymentSourceId: r.wompi_payment_source_id_enc
      ? decrypt(r.wompi_payment_source_id_enc)
      : null,
  }));
}

/**
 * Descifra el payment_source_id tokenizado de una clínica. Si no existe,
 * retorna null.
 */
export async function getClinicPaymentSource(clinicId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("clinics")
    .select("wompi_payment_source_id_enc")
    .eq("id", clinicId)
    .maybeSingle();
  if (error) throw error;
  return data?.wompi_payment_source_id_enc ? decrypt(data.wompi_payment_source_id_enc) : null;
}

export interface ScheduledChargeInput {
  clinicId: string;
  plan: Plan;
  amountInCents: number;
  dueAt: string;
}

export async function createScheduledCharge(input: ScheduledChargeInput): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("billing_scheduled_charges")
    .insert({
      clinic_id: input.clinicId,
      plan: input.plan,
      amount_in_cents: input.amountInCents,
      due_at: input.dueAt,
      status: "processing",
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function markScheduledChargeSuccess(
  chargeId: string,
  wompiTransactionId: string,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("billing_scheduled_charges")
    .update({
      status: "success",
      charged_at: new Date().toISOString(),
      wompi_transaction_id: wompiTransactionId,
    })
    .eq("id", chargeId);
  if (error) throw error;
}

export async function markScheduledChargeFailed(
  chargeId: string,
  reason: string,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("billing_scheduled_charges")
    .update({
      status: "failed",
      charged_at: new Date().toISOString(),
      failure_reason: reason,
    })
    .eq("id", chargeId);
  if (error) throw error;
}

/**
 * Extiende el periodo pagado de la clínica tras un cobro recurrente exitoso.
 */
export async function renewBilling(clinicId: string, periodDays = 30): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("clinics")
    .update({
      billing_status: "activo",
      current_period_end: new Date(Date.now() + periodDays * 24 * 60 * 60 * 1000).toISOString(),
    })
    .eq("id", clinicId);
  if (error) throw error;
  logger.info("billing.renewed", { clinicId, periodDays });
}

/**
 * Marca la facturación como fallida. Después de varios intentos fallidos el
 * status podría pasar a 'suspendido', pero por ahora se deja en 'vencido'.
 */
export async function markBillingFailed(clinicId: string, reason: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("clinics")
    .update({ billing_status: "vencido" })
    .eq("id", clinicId);
  if (error) throw error;
  logger.warn("billing.failed", { clinicId, reason });
}

/**
 * Suspende la clínica por falta de pago. billing_status pasa a 'suspendido'.
 */
export async function suspendClinicForBilling(clinicId: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("clinics").update({ billing_status: "suspendido" }).eq("id", clinicId);
  if (error) throw error;
  logger.warn("billing.suspended", { clinicId });
}

/** true si el plan requiere pago recurrente. */
export function isPaidPlan(plan: Plan): boolean {
  return PLANS[plan].priceInCents > 0;
}

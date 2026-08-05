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
  /** Período que cubre el cobro (YYYY-MM-DD). Ver `periodKeyFor`. */
  periodKey: string;
}

/**
 * Reserva el intento de cobro de un período ANTES de llamar a Wompi.
 *
 * Devuelve `null` si ya existe un cobro en curso o exitoso para ese período
 * (índice único parcial de la migración 0030) — en ese caso el llamador NO
 * debe cobrar. Esta es la defensa real contra el doble cobro: vive en la base
 * de datos, así que sobrevive a un bug de lógica, a dos invocaciones
 * concurrentes del cron, o a una entrega duplicada de Vercel Cron (su
 * entrega es best-effort y puede repetirse).
 */
export async function createScheduledCharge(input: ScheduledChargeInput): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("billing_scheduled_charges")
    .insert({
      clinic_id: input.clinicId,
      plan: input.plan,
      amount_in_cents: input.amountInCents,
      due_at: input.dueAt,
      period_key: input.periodKey,
      status: "processing",
    })
    .select("id")
    .single();

  if (!error) return data.id;
  // 23505 = unique_violation → ya hay un cobro vivo/exitoso de este período.
  if (error.code === "23505") {
    logger.info("billing.charge_already_exists_for_period", {
      clinicId: input.clinicId,
      periodKey: input.periodKey,
    });
    return null;
  }
  throw error;
}

/**
 * Período de facturación que se está cobrando, como clave estable. Se deriva
 * del fin del período vigente (lo que se está renovando), NO de la fecha de
 * ejecución del cron: así, si el cron corre dos veces el mismo día o se
 * atrasa, sigue apuntando al mismo período y el índice único lo detecta.
 */
export function periodKeyFor(currentPeriodEnd: string | null): string {
  const d = currentPeriodEnd ? new Date(currentPeriodEnd) : new Date();
  return d.toISOString().slice(0, 10);
}

/**
 * Cierra intentos que quedaron colgados en 'processing' (p. ej. el proceso
 * murió justo después de llamar a Wompi). Sin esto, el índice único dejaría
 * ese período bloqueado para siempre y la clínica nunca se renovaría.
 *
 * El umbral es deliberadamente amplio (24 h): un cobro que sigue 'processing'
 * podría ser un PSE aún en curso, y prefiero demorar una renovación un día
 * antes que arriesgar un segundo cobro sobre una transacción viva.
 */
export async function expireStaleProcessingCharges(olderThanHours = 24): Promise<number> {
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from("billing_scheduled_charges")
    .update({
      status: "failed",
      charged_at: new Date().toISOString(),
      failure_reason: "sin_confirmacion_de_wompi_tras_24h",
    })
    .eq("status", "processing")
    .lt("created_at", cutoff)
    .select("id");
  if (error) throw error;
  const count = data?.length ?? 0;
  if (count > 0) logger.warn("billing.stale_processing_charges_expired", { count });
  return count;
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
 * Marca la facturación como vencida tras un cobro fallido. NO corta el acceso
 * — `billing_status` es informativo; el bloqueo real de la app depende de
 * `clinics.suspended_at` (ver lib/auth.ts), que solo cambia un platform admin
 * de forma manual y deliberada.
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
 * Señala una clínica con cobros fallidos repetidos para que una persona la
 * revise. Deliberadamente NO suspende nada de forma automática.
 *
 * Razón: en E-Irene, perder acceso significa que un profesional no puede
 * abrir la historia clínica ni las alertas de riesgo (incl. ideación
 * suicida) de sus pacientes. Un fallo de cobro —que puede originarse en un
 * token vencido, un problema del banco, o un bug nuestro— nunca es
 * justificación suficiente para eso. La decisión de cortar el servicio a una
 * clínica es de una persona, con contexto, no de un cron a las 6 AM.
 */
export async function flagClinicForBillingReview(
  clinicId: string,
  failureCount: number,
): Promise<void> {
  logger.error("billing.needs_manual_review", {
    clinicId,
    failureCount,
    action: "revisar manualmente; NO se suspendió el acceso automáticamente",
  });
}

/** true si el plan requiere pago recurrente. */
export function isPaidPlan(plan: Plan): boolean {
  return PLANS[plan].priceInCents > 0;
}

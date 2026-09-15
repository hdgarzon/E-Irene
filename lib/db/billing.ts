import { createAdminClient } from "@/lib/supabase/admin";
import { assertEncryptionKey, encrypt, decrypt } from "@/lib/crypto";
import { graceEndsAt } from "@/lib/billing/subscription-state";
import { logger } from "@/lib/logger";
import { PAID_PLANS, PLANS, type Plan } from "@/lib/plans";

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
 * Pago aprobado de un plan (checkout): empieza una suscripción. El ciclo se
 * ancla al momento del pago y el período pagado termina un ciclo después
 * (activate_subscription, migración 0041).
 *
 * NO es idempotente —reinicia el ciclo—: solo debe llamarse cuando
 * recordBillingEvent confirmó que el evento es nuevo. Los cobros recurrentes
 * nunca pasan por aquí; usan renewBilling.
 */
export async function activateBilling(
  clinicId: string,
  plan: Plan,
  paymentSourceId: string | null,
): Promise<void> {
  const admin = createAdminClient();
  const { data: periodEnd, error } = await admin.rpc("activate_subscription", {
    p_clinic: clinicId,
    p_plan: plan,
    p_payment_source_enc: paymentSourceId ? encrypt(paymentSourceId) : undefined,
  });
  if (error) throw error;
  logger.info("billing.activated", { clinicId, plan, periodEnd });
}

export interface ClinicDueForCharge {
  id: string;
  plan: Plan;
  /** Fin del período que se va a renovar. De él salen la clave y la renovación del cobro. */
  currentPeriodEnd: string;
  wompiPaymentSourceId: string | null;
  /**
   * Hay token de cobro pero no se pudo descifrar (clave rotada, dato corrupto):
   * wompiPaymentSourceId es null y a la clínica no se le cobra.
   */
  paymentSourceUnreadable: boolean;
}

/**
 * Clínicas que necesitan ser cobradas: plan de pago, billing_status activo (o
 * vencido, para reprocesar), sin cancelación pedida, y current_period_end
 * vencido o a punto de vencer en los próximos 3 días.
 *
 * Un token que no descifra afecta solo a su clínica: vuelve marcada con
 * paymentSourceUnreadable y las demás se listan igual. Sin ENCRYPTION_KEY no se
 * descifra ninguno, y eso sí lanza.
 */
export async function getClinicsDueForCharge(): Promise<ClinicDueForCharge[]> {
  assertEncryptionKey();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("clinics")
    .select("id, plan, current_period_end, wompi_payment_source_id_enc")
    // Solo los planes con precio fijo: Free no se cobra y Enterprise se factura por contrato.
    .in("plan", PAID_PLANS)
    .in("billing_status", ["activo", "vencido"])
    // Quien canceló conserva el plan hasta el fin del período, pero no se le
    // vuelve a cobrar: al vencer, end_canceled_subscriptions() lo pasa a Free.
    .eq("cancel_at_period_end", false)
    .lte("current_period_end", new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString());
  if (error) throw error;

  // El filtro `lte` ya deja fuera los períodos null; el flatMap solo lo hace
  // explícito para el tipo.
  return (data ?? []).flatMap((r) =>
    r.current_period_end
      ? [
          {
            id: r.id,
            plan: r.plan as Plan,
            currentPeriodEnd: r.current_period_end,
            ...readPaymentSource(r.id, r.wompi_payment_source_id_enc),
          },
        ]
      : [],
  );
}

function readPaymentSource(
  clinicId: string,
  encrypted: string | null,
): Pick<ClinicDueForCharge, "wompiPaymentSourceId" | "paymentSourceUnreadable"> {
  if (!encrypted) return { wompiPaymentSourceId: null, paymentSourceUnreadable: false };
  try {
    return { wompiPaymentSourceId: decrypt(encrypted), paymentSourceUnreadable: false };
  } catch (error) {
    // El id y el error, nunca el token: ni cifrado ni descifrado.
    logger.error("billing.payment_source_unreadable", {
      clinicId,
      error,
      action:
        "no se le cobra. Revisar ENCRYPTION_KEY; si el dato está corrupto, la clínica tiene que pagar desde Plan y facturación antes de que termine la gracia. NO se marca como morosa.",
    });
    return { wompiPaymentSourceId: null, paymentSourceUnreadable: true };
  }
}

/**
 * Deja constancia en audit_logs de que a la clínica no se le pudo cobrar porque
 * su token de cobro no descifra. Una vez por período, porque el cron la reintenta
 * a diario. Devuelve true si esta llamada dejó la constancia.
 *
 * No toca billing_status: igual que con una clínica sin token, el problema es
 * nuestro y no un pago rechazado. La gracia corre igual (end_overdue_subscriptions)
 * y, vencido el período, la app le muestra el aviso para pagar desde Plan y
 * facturación; si ese pago tokeniza un medio, queda cifrado con la clave vigente.
 */
export async function recordUnreadablePaymentSource(clinic: ClinicDueForCharge): Promise<boolean> {
  const admin = createAdminClient();
  const { data: existing, error: readError } = await admin
    .from("audit_logs")
    .select("id")
    .eq("clinic_id", clinic.id)
    .eq("action", "subscription.payment_source_unreadable")
    .eq("metadata->>period_end", clinic.currentPeriodEnd)
    .limit(1);
  if (readError) throw readError;
  if (existing && existing.length > 0) return false;

  const { error } = await admin.from("audit_logs").insert({
    clinic_id: clinic.id,
    action: "subscription.payment_source_unreadable",
    entity_type: "clinic",
    entity_id: clinic.id,
    metadata: {
      plan: clinic.plan,
      period_end: clinic.currentPeriodEnd,
      grace_ends_at: graceEndsAt(clinic.currentPeriodEnd),
    },
  });
  if (error) throw error;
  return true;
}

/**
 * Relee la clínica justo antes de cobrarla. Entre la consulta de clínicas por
 * cobrar y el cobro, el admin puede haber cancelado o cambiado de plan: cobrar
 * con el estado viejo sería cobrar algo que ya no se debe.
 */
export async function isStillDueForCharge(clinic: ClinicDueForCharge): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("clinics")
    .select("plan, billing_status, current_period_end, cancel_at_period_end")
    .eq("id", clinic.id)
    .maybeSingle();
  if (error) throw error;
  if (!data?.current_period_end) return false;
  return (
    !data.cancel_at_period_end &&
    data.plan === clinic.plan &&
    (data.billing_status === "activo" || data.billing_status === "vencido") &&
    new Date(data.current_period_end).getTime() === new Date(clinic.currentPeriodEnd).getTime()
  );
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

export interface ScheduledChargeRecord {
  id: string;
  plan: Plan;
  status: "pending" | "processing" | "success" | "failed";
  amountInCents: number;
  /** Fin del período que cubre el cobro: el que se renueva. */
  dueAt: string;
}

/**
 * Intento de cobro de un período, para resolver su desenlace por webhook.
 * Prefiere el intento vivo o exitoso —hay uno solo, por el índice único de
 * 0030— y si no lo hay, el último fallido.
 */
export async function findScheduledChargeForPeriod(
  clinicId: string,
  periodKey: string,
): Promise<ScheduledChargeRecord | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("billing_scheduled_charges")
    .select("id, plan, status, amount_in_cents, due_at")
    .eq("clinic_id", clinicId)
    .eq("period_key", periodKey)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const rows = data ?? [];
  const row = rows.find((r) => r.status !== "failed") ?? rows[0];
  if (!row) return null;
  return {
    id: row.id,
    plan: row.plan as Plan,
    status: row.status as ScheduledChargeRecord["status"],
    amountInCents: Number(row.amount_in_cents),
    dueAt: row.due_at,
  };
}

/**
 * Cobro recurrente aprobado: el período pagado avanza exactamente un ciclo
 * desde `chargedPeriodEnd` (renew_subscription_period, migración 0041).
 *
 * Idempotente: si ese período ya se había renovado —el cron y el webhook del
 * mismo cobro llegan los dos— no cambia nada y devuelve null.
 */
export async function renewBilling(
  clinicId: string,
  chargedPeriodEnd: string,
): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("renew_subscription_period", {
    p_clinic: clinicId,
    p_charged_period_end: chargedPeriodEnd,
  });
  if (error) throw error;
  if (data) {
    logger.info("billing.renewed", { clinicId, chargedPeriodEnd, periodEnd: data });
  } else {
    logger.info("billing.renewal_already_applied", { clinicId, chargedPeriodEnd });
  }
  return data ?? null;
}

/**
 * Plan y fin de período vigentes. Sirve para distinguir una renovación que ya se
 * había aplicado de una suscripción que terminó antes de que el cobro se aprobara.
 */
export async function getSubscriptionPeriod(
  clinicId: string,
): Promise<{ plan: Plan; currentPeriodEnd: string | null } | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("clinics")
    .select("plan, current_period_end")
    .eq("id", clinicId)
    .maybeSingle();
  if (error) throw error;
  return data ? { plan: data.plan as Plan, currentPeriodEnd: data.current_period_end } : null;
}

/**
 * Cobro recurrente fallido: marca la suscripción como vencida y, la primera vez
 * en el período, deja constancia en audit_logs con la fecha límite de la gracia
 * (mark_subscription_payment_failed, migración 0042).
 *
 * NO corta el acceso ni suspende. La clínica conserva el plan durante la gracia
 * (BILLING_GRACE_DAYS desde el fin del período pagado) mientras el cron
 * reintenta; si no se paga, end_overdue_subscriptions() la pasa a Free. La
 * suspensión (`clinics.suspended_at`, ver lib/auth.ts) sigue siendo una decisión
 * manual y deliberada de un platform admin.
 */
export async function markBillingFailed(clinicId: string, reason: string): Promise<void> {
  const admin = createAdminClient();
  const { data: firstFailureOfPeriod, error } = await admin.rpc(
    "mark_subscription_payment_failed",
    { p_clinic: clinicId, p_reason: reason },
  );
  if (error) throw error;
  logger.warn("billing.failed", { clinicId, reason, firstFailureOfPeriod });
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
 *
 * Pasar a Free al vencer la gracia (end_overdue_subscriptions, migración 0042)
 * no es cortar el servicio: Free conserva el acceso a todas las historias
 * clínicas y alertas de riesgo, y solo limita lo nuevo que se puede crear.
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
  // null = a convenir: se factura por contrato, no por la app.
  return (PLANS[plan].priceInCents ?? 0) > 0;
}

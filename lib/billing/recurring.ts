import { PLANS } from "@/lib/plans";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getClinicsDueForCharge,
  createScheduledCharge,
  markScheduledChargeSuccess,
  markScheduledChargeFailed,
  renewBilling,
  markBillingFailed,
  flagClinicForBillingReview,
  expireStaleProcessingCharges,
  periodKeyFor,
  type ClinicDueForCharge,
} from "@/lib/db/billing";
import { buildBillingReference } from "./wompi";

const WOMPI_BASE = {
  sandbox: "https://sandbox.wompi.co/v1",
  production: "https://production.wompi.co/v1",
};

function getBaseUrl(): string {
  const env = process.env.WOMPI_ENVIRONMENT ?? "sandbox";
  return env === "production" ? WOMPI_BASE.production : WOMPI_BASE.sandbox;
}

function getPrivateKey(): string {
  const key = process.env.WOMPI_PRIVATE_KEY;
  if (!key) throw new Error("WOMPI_PRIVATE_KEY no está configurada");
  return key;
}

export interface ChargeResult {
  success: boolean;
  transactionId?: string;
  status?: string;
  error?: string;
  /**
   * Wompi aceptó la transacción pero todavía no hay desenlace (típico de PSE
   * o Nequi, que dependen de que la persona confirme en su banco/app). NO es
   * un fallo: el cobro puede aprobarse minutos después y el webhook lo
   * resolverá. Tratarlo como fallo llevaría a cobrar de nuevo encima de una
   * transacción viva.
   */
  pending?: boolean;
}

/**
 * Cobra a una clínica usando el payment_source_id tokenizado guardado. Wompi
 * no maneja suscripciones: nosotros decidimos cuándo cobrar y con qué medio
 * de pago.
 */
export async function chargeClinic(
  clinic: ClinicDueForCharge,
): Promise<ChargeResult> {
  if (!clinic.wompiPaymentSourceId) {
    return { success: false, error: "clinic_has_no_payment_source" };
  }

  const reference = buildBillingReference(clinic.id, clinic.plan);
  const amountInCents = PLANS[clinic.plan].priceInCents;

  const body = {
    amount_in_cents: amountInCents,
    currency: "COP",
    reference,
    payment_source_id: clinic.wompiPaymentSourceId,
  };

  const res = await fetch(`${getBaseUrl()}/transactions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getPrivateKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const responseText = await res.text();
  let responseData: unknown;
  try {
    responseData = JSON.parse(responseText);
  } catch {
    responseData = null;
  }

  const data = responseData as {
    data?: { id?: string; status?: string };
    error?: { messages?: string[]; reason?: string };
  } | null;

  if (!res.ok) {
    const reason = data?.error?.reason ?? responseText.slice(0, 200);
    logger.error("wompi.recurring_charge_failed", {
      clinicId: clinic.id,
      plan: clinic.plan,
      status: res.status,
      reason,
    });
    return { success: false, error: `wompi_${res.status}: ${reason}` };
  }

  const transactionId = data?.data?.id;
  const status = data?.data?.status ?? "UNKNOWN";

  if (!transactionId) {
    return { success: false, error: "missing_transaction_id" };
  }

  // PENDING (y cualquier estado no terminal) se reporta como pendiente, no
  // como fallo: la transacción está viva del lado de Wompi.
  const isPending = status === "PENDING";
  return { success: status === "APPROVED", pending: isPending, transactionId, status };
}

export interface ProcessRecurringChargesResult {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  /** Cobros que Wompi dejó en curso (PSE/Nequi); los resuelve el webhook. */
  pending: number;
  /** Clínicas en plan pago sin medio de pago tokenizado — requieren acción nuestra, no del cliente. */
  missingPaymentSource: number;
}

const FAILURES_BEFORE_REVIEW = 3;

/**
 * Procesa los cobros recurrentes de las clínicas con el período por vencer.
 *
 * Principio rector: ante cualquier duda, NO cobrar. Un cobro de más a una
 * clínica es un daño real e inmediato; una renovación que se demora un día
 * es recuperable. Todas las salvaguardas están sesgadas en esa dirección.
 *
 * Secuencia por clínica:
 *  1. Reserva el período en la BD (índice único) — si ya hay un cobro vivo o
 *     exitoso para ese mismo período, NO se cobra.
 *  2. Cobra en Wompi.
 *  3. Registra el desenlace y, solo si fue aprobado, renueva el período.
 *
 * Nunca suspende una clínica automáticamente (ver flagClinicForBillingReview).
 */
export async function processRecurringCharges(): Promise<ProcessRecurringChargesResult> {
  // Libera períodos que quedaron colgados en 'processing' de corridas
  // anteriores; si no, su índice único los bloquearía para siempre.
  try {
    await expireStaleProcessingCharges();
  } catch (error) {
    logger.error("billing.expire_stale_failed", { error });
  }

  const dueClinics = await getClinicsDueForCharge();
  const result: ProcessRecurringChargesResult = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    pending: 0,
    missingPaymentSource: 0,
  };

  for (const clinic of dueClinics) {
    result.processed++;
    const amountInCents = PLANS[clinic.plan].priceInCents;
    if (amountInCents <= 0) {
      result.skipped++;
      continue;
    }

    // Sin medio de pago tokenizado no hay nada que cobrar. Esto NO es un
    // fallo de pago del cliente (no se le puede reprochar ni contarle un
    // intento fallido): significa que nunca guardamos su token, que es un
    // problema nuestro. Se registra para intervención manual y se sigue.
    if (!clinic.wompiPaymentSourceId) {
      result.missingPaymentSource++;
      logger.error("billing.clinic_has_no_payment_source", {
        clinicId: clinic.id,
        plan: clinic.plan,
        action:
          "la clínica está en plan pago sin token de cobro; contactar para re-registrar el medio de pago. NO se marca como morosa.",
      });
      continue;
    }

    const periodKey = periodKeyFor(clinic.currentPeriodEnd);
    const dueAt = clinic.currentPeriodEnd ?? new Date().toISOString();

    let chargeId: string | null;
    try {
      chargeId = await createScheduledCharge({
        clinicId: clinic.id,
        plan: clinic.plan,
        amountInCents,
        dueAt,
        periodKey,
      });
    } catch (error) {
      logger.error("billing.create_scheduled_charge_failed", { clinicId: clinic.id, error });
      result.failed++;
      continue;
    }

    // null = ya existe un cobro vivo o exitoso para este período. Es el
    // camino esperado si el cron se ejecuta dos veces el mismo día.
    if (chargeId === null) {
      result.skipped++;
      continue;
    }

    const chargeResult = await chargeClinic(clinic);

    // Pendiente (PSE/Nequi): se deja el intento en 'processing'. El período
    // queda reservado, así que no se cobrará de nuevo mientras siga vivo, y
    // expireStaleProcessingCharges lo liberará si nunca se confirma.
    if (chargeResult.pending) {
      result.pending++;
      logger.info("billing.charge_pending", {
        clinicId: clinic.id,
        transactionId: chargeResult.transactionId,
        periodKey,
      });
      continue;
    }

    if (chargeResult.success && chargeResult.transactionId) {
      // El dinero YA salió de la tarjeta del cliente. A partir de acá, un
      // fallo nuestro no debe poder provocar un segundo cobro: por eso el
      // período sigue reservado por el registro 'success' (índice único)
      // aunque renewBilling falle.
      try {
        await markScheduledChargeSuccess(chargeId, chargeResult.transactionId);
      } catch (error) {
        logger.error("billing.mark_success_failed_after_real_charge", {
          clinicId: clinic.id,
          transactionId: chargeResult.transactionId,
          periodKey,
          error,
          action: "COBRO REALIZADO en Wompi pero no registrado — revisar y conciliar manualmente",
        });
      }
      try {
        await renewBilling(clinic.id);
        result.succeeded++;
      } catch (error) {
        logger.error("billing.renew_after_charge_failed", {
          clinicId: clinic.id,
          transactionId: chargeResult.transactionId,
          error,
          action: "COBRO REALIZADO pero el período no se extendió — conciliar manualmente",
        });
        result.failed++;
      }
      continue;
    }

    try {
      await markScheduledChargeFailed(chargeId, chargeResult.error ?? "unknown");
      await markBillingFailed(clinic.id, chargeResult.error ?? "unknown");
      result.failed++;
    } catch (error) {
      logger.error("billing.mark_failed_failed", { clinicId: clinic.id, error });
      result.failed++;
    }
  }

  await flagClinicsWithRepeatedFailures();

  logger.info("billing.recurring_charges_processed", { ...result });
  return result;
}

/**
 * Señala (no suspende) clínicas con cobros fallidos repetidos, para revisión
 * humana. Ver flagClinicForBillingReview sobre por qué esto nunca corta el
 * acceso automáticamente.
 */
async function flagClinicsWithRepeatedFailures(): Promise<void> {
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await admin
    .from("billing_scheduled_charges")
    .select("clinic_id")
    .eq("status", "failed")
    .gte("created_at", cutoff);

  if (error) {
    logger.error("billing.review_query_failed", { error });
    return;
  }

  const failureCounts = new Map<string, number>();
  for (const row of data ?? []) {
    failureCounts.set(row.clinic_id, (failureCounts.get(row.clinic_id) ?? 0) + 1);
  }

  for (const [clinicId, count] of failureCounts) {
    if (count >= FAILURES_BEFORE_REVIEW) {
      await flagClinicForBillingReview(clinicId, count);
    }
  }
}

import { PLANS } from "@/lib/plans";
import { logger } from "@/lib/logger";
import {
  getClinicsDueForCharge,
  createScheduledCharge,
  markScheduledChargeSuccess,
  markScheduledChargeFailed,
  renewBilling,
  markBillingFailed,
  suspendClinicForBilling,
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

  return { success: status === "APPROVED", transactionId, status };
}

export interface ProcessRecurringChargesResult {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
}

const MAX_RETRIES_BEFORE_SUSPEND = 3;
const DAYS_BEFORE_DUE = 3;

/**
 * Procesa los cobros recurrentes de todas las clínicas que estén por vencer.
 * - Crea una fila `billing_scheduled_charges` con status `processing`.
 * - Intenta el cobro con Wompi.
 * - Si es exitoso: renueva `current_period_end`.
 * - Si falla: marca `billing_status` como `vencido`; si acumula demasiados
 *   intentos fallidos, suspende la clínica.
 */
export async function processRecurringCharges(): Promise<ProcessRecurringChargesResult> {
  const dueClinics = await getClinicsDueForCharge();
  const result: ProcessRecurringChargesResult = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
  };

  for (const clinic of dueClinics) {
    result.processed++;
    const amountInCents = PLANS[clinic.plan].priceInCents;
    if (amountInCents <= 0) {
      result.skipped++;
      continue;
    }

    const dueAt =
      clinic.currentPeriodEnd ?? new Date(Date.now() + DAYS_BEFORE_DUE * 24 * 60 * 60 * 1000).toISOString();

    let chargeId: string;
    try {
      chargeId = await createScheduledCharge({
        clinicId: clinic.id,
        plan: clinic.plan,
        amountInCents,
        dueAt,
      });
    } catch (error) {
      logger.error("billing.create_scheduled_charge_failed", { clinicId: clinic.id, error });
      result.failed++;
      continue;
    }

    const chargeResult = await chargeClinic(clinic);

    if (chargeResult.success && chargeResult.transactionId) {
      try {
        await markScheduledChargeSuccess(chargeId, chargeResult.transactionId);
        await renewBilling(clinic.id);
        result.succeeded++;
      } catch (error) {
        logger.error("billing.renew_after_charge_failed", {
          clinicId: clinic.id,
          transactionId: chargeResult.transactionId,
          error,
        });
        result.failed++;
      }
    } else {
      try {
        await markScheduledChargeFailed(chargeId, chargeResult.error ?? "unknown");
        await markBillingFailed(clinic.id, chargeResult.error ?? "unknown");
        result.failed++;
      } catch (error) {
        logger.error("billing.mark_failed_failed", { clinicId: clinic.id, error });
        result.failed++;
      }
    }
  }

  // Suspende clínicas con demasiados intentos fallidos recientes. Se hace
  // después del loop para no depender de conteos en memoria.
  await suspendClinicsWithTooManyFailures();

  logger.info("billing.recurring_charges_processed", { ...result });
  return result;
}

async function suspendClinicsWithTooManyFailures(): Promise<void> {
  const admin = (await import("@/lib/supabase/admin")).createAdminClient();
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await admin
    .from("billing_scheduled_charges")
    .select("clinic_id")
    .eq("status", "failed")
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false });

  if (error) {
    logger.error("billing.suspend_query_failed", { error });
    return;
  }

  const failureCounts = new Map<string, number>();
  for (const row of data ?? []) {
    failureCounts.set(row.clinic_id, (failureCounts.get(row.clinic_id) ?? 0) + 1);
  }

  for (const [clinicId, count] of failureCounts) {
    if (count >= MAX_RETRIES_BEFORE_SUSPEND) {
      try {
        await suspendClinicForBilling(clinicId);
      } catch (error) {
        logger.error("billing.suspend_failed", { clinicId, error });
      }
    }
  }
}

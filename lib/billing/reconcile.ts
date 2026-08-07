import { PLANS } from "@/lib/plans";
import { logger } from "@/lib/logger";
import { recordBillingEvent, activateBilling, clinicExists } from "@/lib/db/billing";
import { resolveTransactionOwner } from "@/lib/db/billing-checkouts";

/**
 * Reconciliación de un pago al volver del checkout.
 *
 * El webhook de Wompi es el camino principal para activar un plan, pero es
 * un único punto de falla fuera de nuestro control: si Wompi no entrega el
 * evento (webhook mal configurado, caída momentánea, entrega perdida), la
 * clínica paga y no recibe nada, en silencio. Eso ya pasó en producción
 * (2026-08-06: pago aprobado en Wompi, cero eventos recibidos).
 *
 * Por eso, al regresar del checkout Wompi agrega `?id=<transaction_id>` a la
 * URL de retorno y acá consultamos esa transacción directamente. Ambos
 * caminos convergen en `recordBillingEvent`, que es idempotente por
 * (transaction_id, status) — si el webhook ya la procesó, esto es un no-op.
 */

const WOMPI_API = {
  sandbox: "https://sandbox.wompi.co/v1",
  production: "https://production.wompi.co/v1",
};

function apiBaseUrl(): string {
  return process.env.WOMPI_ENVIRONMENT === "production" ? WOMPI_API.production : WOMPI_API.sandbox;
}

export interface WompiTransaction {
  id: string;
  status: string;
  amount_in_cents: number;
  reference: string;
  payment_method_type?: string;
  /** No está documentado que la consulta lo devuelva; se usa si aparece. */
  payment_source_id?: number | string | null;
}

/**
 * Consulta una transacción por id. Usa la llave PÚBLICA: es la que Wompi
 * documenta para verificar estado, y así este camino no necesita la llave
 * privada (que solo debe usarse para crear cobros).
 */
export async function fetchWompiTransaction(
  transactionId: string,
): Promise<WompiTransaction | null> {
  const publicKey = process.env.WOMPI_PUBLIC_KEY;
  if (!publicKey) {
    logger.error("wompi.reconcile_missing_public_key");
    return null;
  }

  const res = await fetch(`${apiBaseUrl()}/transactions/${encodeURIComponent(transactionId)}`, {
    headers: { Authorization: `Bearer ${publicKey}` },
    cache: "no-store",
  });

  if (!res.ok) {
    logger.warn("wompi.reconcile_fetch_failed", { transactionId, status: res.status });
    return null;
  }

  const body = (await res.json()) as { data?: WompiTransaction } | null;
  return body?.data ?? null;
}

export type ReconcileOutcome =
  | { result: "activated"; plan: string }
  | { result: "already_processed" }
  | { result: "not_approved"; status: string }
  | { result: "ignored"; reason: string };

/**
 * Verifica una transacción y, si corresponde, activa el plan.
 *
 * `expectedClinicId` es obligatorio y NO decorativo: sin él, cualquiera
 * podría pasar el id de una transacción ajena en la URL de retorno y
 * activarse un plan que pagó otra clínica. La referencia embebe el
 * clinicId, así que se exige que coincida con la clínica de quien está
 * pidiendo la reconciliación.
 */
export async function reconcilePlanPayment(
  transactionId: string,
  expectedClinicId: string,
): Promise<ReconcileOutcome> {
  const tx = await fetchWompiTransaction(transactionId);
  if (!tx) return { result: "ignored", reason: "transaccion_no_encontrada" };

  // Wompi descarta nuestra referencia en los pagos por payment link, así que
  // la clínica se resuelve por el id del link registrado al crear el checkout
  // (ver lib/db/billing-checkouts.ts).
  const parsed = await resolveTransactionOwner(tx);
  if (!parsed) return { result: "ignored", reason: "referencia_no_reconocida" };

  // Control de acceso: la transacción debe pertenecer a la clínica que la
  // está reclamando.
  if (parsed.clinicId !== expectedClinicId) {
    logger.warn("wompi.reconcile_clinic_mismatch", {
      transactionId,
      expectedClinicId,
      referenceClinicId: parsed.clinicId,
    });
    return { result: "ignored", reason: "la_transaccion_es_de_otra_clinica" };
  }

  if (!(await clinicExists(parsed.clinicId))) {
    return { result: "ignored", reason: "clinica_inexistente" };
  }

  if (tx.status !== "APPROVED") {
    return { result: "not_approved", status: tx.status };
  }

  // Mismo control que el webhook: no activar un plan si lo pagado no
  // corresponde a su precio.
  const expected = PLANS[parsed.plan].priceInCents;
  if (tx.amount_in_cents !== expected) {
    logger.error("wompi.reconcile_amount_mismatch", {
      transactionId,
      clinicId: parsed.clinicId,
      plan: parsed.plan,
      expected,
      received: tx.amount_in_cents,
    });
    return { result: "ignored", reason: "monto_no_coincide_con_el_plan" };
  }

  const { isNew } = await recordBillingEvent({
    clinicId: parsed.clinicId,
    wompiTransactionId: tx.id,
    wompiEvent: "checkout.return_reconciliation",
    status: tx.status,
    amountInCents: tx.amount_in_cents,
    rawPayload: tx,
  });

  // El webhook ya lo procesó: no hay nada que hacer (y no se debe reactivar
  // ni extender el período dos veces por el mismo pago).
  if (!isNew) return { result: "already_processed" };

  const paymentSourceId = tx.payment_source_id != null ? String(tx.payment_source_id) : null;
  if (!paymentSourceId) {
    logger.warn("wompi.reconcile_without_payment_source", {
      clinicId: parsed.clinicId,
      transactionId: tx.id,
      note: "el plan se activa igual; sin token no habrá cobro recurrente automático",
    });
  }

  await activateBilling(parsed.clinicId, parsed.plan, paymentSourceId);
  logger.info("wompi.reconciled_from_return", {
    clinicId: parsed.clinicId,
    plan: parsed.plan,
    transactionId: tx.id,
  });
  return { result: "activated", plan: parsed.plan };
}

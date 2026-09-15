import type { Plan } from "@/lib/plans";
import { logger } from "@/lib/logger";
import { recordBillingEvent, clinicExists } from "@/lib/db/billing";
import { resolveTransactionOwner, type CheckoutKind } from "@/lib/db/billing-checkouts";
import { fulfillCheckoutPayment } from "@/lib/billing/fulfillment";

/**
 * Reconciliación de un pago al volver del checkout.
 *
 * El webhook de Wompi es el camino principal para aplicar un pago, pero es
 * un único punto de falla fuera de nuestro control: si Wompi no entrega el
 * evento (webhook mal configurado, caída momentánea, entrega perdida), la
 * clínica paga y no recibe nada, en silencio. Eso ya pasó en producción
 * (2026-08-06: pago aprobado en Wompi, cero eventos recibidos).
 *
 * Por eso, al regresar del checkout Wompi agrega `?id=<transaction_id>` a la
 * URL de retorno y acá consultamos esa transacción directamente. Ambos
 * caminos convergen en fulfillCheckoutPayment, que aplica cada transacción una
 * sola vez (billing_fulfillments) — si el webhook ya la procesó, esto es un no-op.
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
  payment_link_id?: string | null;
  created_at?: string;
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
  /** El pago se aplicó ahora: plan comprado o upgrade. */
  | { result: "activated"; kind: CheckoutKind; plan: Plan }
  /** Ya lo había aplicado el webhook (o una visita anterior). */
  | { result: "already_processed"; kind: CheckoutKind; plan: Plan }
  /** Pago aprobado que no se pudo aplicar: queda registrado para reembolso. */
  | { result: "rejected"; kind: CheckoutKind; reason: string }
  | { result: "not_approved"; status: string }
  | { result: "ignored"; reason: string };

/**
 * Verifica una transacción y, si corresponde, la aplica.
 *
 * `expectedClinicId` es obligatorio y NO decorativo: sin él, cualquiera
 * podría pasar el id de una transacción ajena en la URL de retorno y
 * aplicarse un pago que hizo otra clínica. Se exige que la clínica del pago
 * coincida con la de quien pide la reconciliación.
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
  const owner = await resolveTransactionOwner(tx);
  if (!owner) return { result: "ignored", reason: "referencia_no_reconocida" };

  // Control de acceso: la transacción debe pertenecer a la clínica que la
  // está reclamando.
  if (owner.clinicId !== expectedClinicId) {
    logger.warn("wompi.reconcile_clinic_mismatch", {
      transactionId,
      expectedClinicId,
      referenceClinicId: owner.clinicId,
    });
    return { result: "ignored", reason: "la_transaccion_es_de_otra_clinica" };
  }

  if (!(await clinicExists(owner.clinicId))) {
    return { result: "ignored", reason: "clinica_inexistente" };
  }

  if (tx.status !== "APPROVED") {
    return { result: "not_approved", status: tx.status };
  }

  // Constancia del evento; idempotente por (transaction_id, status). Lo que
  // decide si el pago se aplica es el cumplimiento, no si el evento era nuevo.
  await recordBillingEvent({
    clinicId: owner.clinicId,
    wompiTransactionId: tx.id,
    wompiEvent: "checkout.return_reconciliation",
    status: tx.status,
    amountInCents: tx.amount_in_cents,
    rawPayload: tx,
  });

  // El monto se valida en la base: contra el precio del plan o contra lo cotizado.
  const fulfillment = await fulfillCheckoutPayment(owner, tx);

  if (fulfillment.outcome === "rejected") {
    return { result: "rejected", kind: fulfillment.kind, reason: fulfillment.reason };
  }
  if (fulfillment.alreadyProcessed) {
    return { result: "already_processed", kind: fulfillment.kind, plan: fulfillment.plan };
  }

  if (fulfillment.kind === "plan" && tx.payment_source_id == null) {
    logger.warn("wompi.reconcile_without_payment_source", {
      clinicId: owner.clinicId,
      transactionId: tx.id,
      note: "el plan se activa igual; sin token no habrá cobro recurrente automático",
    });
  }

  logger.info("wompi.reconciled_from_return", {
    clinicId: owner.clinicId,
    kind: fulfillment.kind,
    plan: fulfillment.plan,
    transactionId: tx.id,
  });
  return { result: "activated", kind: fulfillment.kind, plan: fulfillment.plan };
}

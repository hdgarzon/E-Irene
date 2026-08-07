import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import type { Plan } from "@/lib/plans";
import { parseBillingReference } from "@/lib/billing/wompi";

/**
 * Resolución de "¿de qué clínica y plan es este pago?".
 *
 * Wompi devuelve nuestra `reference` intacta SOLO en las transacciones que
 * creamos directamente (cobros recurrentes con payment_source_id). En los
 * pagos hechos a través de un Payment Link la descarta y genera la suya:
 *
 *   `<payment_link_id>_<timestamp>_<random>`  →  test_DycgWj_1786079615_Tc7H27rmL
 *
 * Por eso hay dos caminos de resolución y siempre se valida contra la base:
 * si el parseo fuera incorrecto, no encuentra nada y el pago se descarta en
 * vez de asignarse a una clínica equivocada.
 */

/** El monto NO se toma de acá: se valida siempre contra PLANS[plan], que es
 *  la única fuente de verdad de precios. */
export interface CheckoutRecord {
  clinicId: string;
  plan: Plan;
}

export async function recordCheckout(input: {
  paymentLinkId: string;
  clinicId: string;
  plan: Plan;
  amountInCents: number;
  reference: string;
}): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("billing_checkouts").insert({
    wompi_payment_link_id: input.paymentLinkId,
    clinic_id: input.clinicId,
    plan: input.plan,
    amount_in_cents: input.amountInCents,
    reference: input.reference,
  });
  // 23505 = el mismo link ya se registró (reintento del usuario): no es error.
  if (error && error.code !== "23505") throw error;
}

export async function findCheckoutByPaymentLinkId(
  paymentLinkId: string,
): Promise<CheckoutRecord | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("billing_checkouts")
    .select("clinic_id, plan")
    .eq("wompi_payment_link_id", paymentLinkId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { clinicId: data.clinic_id, plan: data.plan as Plan };
}

/**
 * Extrae el id del payment link de una referencia generada por Wompi.
 * Formato observado: `<payment_link_id>_<timestamp>_<random>`, donde el id
 * puede contener guiones bajos ("test_DycgWj"), así que se descartan los dos
 * últimos segmentos en vez de tomar el primero.
 *
 * Devuelve null si no encaja: el llamador entonces no resuelve nada, que es
 * el comportamiento seguro.
 */
export function extractPaymentLinkId(wompiReference: string): string | null {
  const parts = wompiReference.split("_");
  if (parts.length < 3) return null;
  return parts.slice(0, -2).join("_") || null;
}

/**
 * Resuelve clínica y plan de una transacción, probando en orden:
 *  1. `payment_link_id` del propio payload (lo más directo y confiable).
 *  2. Nuestra referencia, si Wompi la conservó (cobros recurrentes).
 *  3. El id embebido en la referencia que generó Wompi.
 *
 * Siempre contra la base: un id inventado no resuelve nada.
 */
export async function resolveTransactionOwner(tx: {
  reference: string;
  payment_link_id?: string | null;
}): Promise<CheckoutRecord | null> {
  if (tx.payment_link_id) {
    const byId = await findCheckoutByPaymentLinkId(tx.payment_link_id);
    if (byId) return byId;
  }

  const own = parseBillingReference(tx.reference);
  if (own) return { clinicId: own.clinicId, plan: own.plan };

  const extracted = extractPaymentLinkId(tx.reference);
  if (extracted) {
    const byPrefix = await findCheckoutByPaymentLinkId(extracted);
    if (byPrefix) return byPrefix;
  }

  logger.warn("billing.unresolved_transaction_owner", { reference: tx.reference });
  return null;
}

import { createAdminClient } from "@/lib/supabase/admin";
import { encrypt } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import { PLANS, type Plan } from "@/lib/plans";
import type { CheckoutKind, CheckoutRecord } from "@/lib/db/billing-checkouts";

/**
 * Aplicación de un pago aprobado por link, una sola vez por transacción
 * (billing_fulfillments, migración 0056).
 *
 * Cada tipo de compra tiene su función en la base, que bloquea la clínica,
 * consulta si esa transacción ya se aplicó y aplica en la misma transacción. Si
 * algo falla, esta función lanza sin haber dejado nada a medias: el webhook
 * responde 500 y el reintento de Wompi vuelve a intentarlo. Antes se registraba
 * el evento primero y un fallo al activar dejaba el pago sin aplicar para
 * siempre.
 *
 * Un pago que no se puede aplicar (monto distinto del cotizado, plan o período
 * cambiados) no se descarta en silencio: queda `rejected` con su motivo y en
 * audit_logs, para reembolsarlo o aplicarlo a mano.
 */

export interface PaidTransaction {
  id: string;
  amount_in_cents: number;
  payment_source_id?: number | string | null;
}

export type FulfillmentResult =
  | { outcome: "applied"; kind: CheckoutKind; plan: Plan; alreadyProcessed: boolean }
  | { outcome: "rejected"; kind: CheckoutKind; reason: string; alreadyProcessed: boolean };

interface RpcResult {
  outcome: "applied" | "rejected";
  reason?: string | null;
  plan?: string | null;
  already_processed?: boolean;
}

export async function fulfillCheckoutPayment(
  owner: CheckoutRecord,
  transaction: PaidTransaction,
): Promise<FulfillmentResult> {
  const admin = createAdminClient();
  // El token del medio de pago solo viaja cifrado, igual que en activate_subscription.
  const paymentSourceEnc =
    transaction.payment_source_id != null ? encrypt(String(transaction.payment_source_id)) : undefined;

  let response: { data: unknown; error: unknown };
  switch (owner.kind) {
    case "plan":
      response = await admin.rpc("fulfill_plan_purchase", {
        p_clinic: owner.clinicId,
        p_transaction_id: transaction.id,
        p_checkout_id: owner.checkoutId ?? undefined,
        p_plan: owner.plan,
        p_amount: transaction.amount_in_cents,
        // Precio vigente del plan: lib/plans.ts es la única fuente de precios.
        p_expected_amount: PLANS[owner.plan]?.priceInCents ?? undefined,
        p_payment_source_enc: paymentSourceEnc,
      });
      break;
    case "upgrade":
      if (!owner.checkoutId) {
        // Un upgrade siempre nace de un checkout registrado: sin él no hay cotización que comprobar.
        throw new Error("Pago de upgrade sin checkout registrado");
      }
      response = await admin.rpc("apply_plan_upgrade", {
        p_clinic: owner.clinicId,
        p_transaction_id: transaction.id,
        p_checkout_id: owner.checkoutId,
        p_amount: transaction.amount_in_cents,
        p_payment_source_enc: paymentSourceEnc,
      });
      break;
    default:
      // Todavía no hay forma de aplicar este tipo. Se lanza para que el pago no
      // se dé por procesado: queda en billing_events y Wompi lo reintenta.
      throw new Error(`Tipo de compra sin cumplimiento: ${owner.kind}`);
  }

  if (response.error) throw response.error;
  const result = response.data as RpcResult;
  const alreadyProcessed = result.already_processed === true;

  if (result.outcome === "rejected") {
    const reason = result.reason ?? "sin_motivo";
    if (!alreadyProcessed) {
      logger.error("billing.payment_rejected", {
        clinicId: owner.clinicId,
        kind: owner.kind,
        transactionId: transaction.id,
        amountInCents: transaction.amount_in_cents,
        reason,
        action: "PAGO APROBADO que no se aplicó: reembolsar o aplicarlo a mano. Queda en audit_logs.",
      });
    }
    return { outcome: "rejected", kind: owner.kind, reason, alreadyProcessed };
  }

  const plan = (result.plan as Plan | null | undefined) ?? owner.plan;
  logger.info("billing.payment_applied", {
    clinicId: owner.clinicId,
    kind: owner.kind,
    plan,
    transactionId: transaction.id,
    alreadyProcessed,
  });
  return { outcome: "applied", kind: owner.kind, plan, alreadyProcessed };
}

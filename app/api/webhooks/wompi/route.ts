import { NextResponse } from "next/server";
import {
  verifyWompiChecksum,
  extractWompiTimestamp,
  parseRenewalReference,
  type WompiEventPayload,
} from "@/lib/billing/wompi";
import { settleRenewalPayment } from "@/lib/billing/recurring";
import { fulfillCheckoutPayment } from "@/lib/billing/fulfillment";
import { recordBillingEvent, clinicExists } from "@/lib/db/billing";
import { resolveTransactionOwner } from "@/lib/db/billing-checkouts";
import { logger } from "@/lib/logger";

/**
 * Webhook de eventos de Wompi. Único endpoint HTTP "crudo" del proyecto —
 * todo lo demás son Server Actions, pero un webhook de un tercero no puede
 * invocar una Server Action (necesita una URL pública estable con su propio
 * contrato de verificación de firma).
 *
 * Solo procesa `transaction.updated`: cobros recurrentes (renovaciones) y pagos
 * por link (compra de un plan, upgrade prorrateado).
 */
export async function POST(request: Request): Promise<NextResponse> {
  const secret = process.env.WOMPI_EVENTS_SECRET;
  if (!secret) {
    // Fail closed: sin secreto no hay forma de verificar que esto venga de
    // Wompi y no de cualquiera que adivine la URL. 503, no 200 — que Wompi
    // reintente en vez de asumir silenciosamente que el evento se perdió.
    logger.error("wompi_webhook.missing_secret");
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  let payload: WompiEventPayload;
  try {
    payload = (await request.json()) as WompiEventPayload;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const timestamp = extractWompiTimestamp(payload);
  if (timestamp === null || !payload.signature?.checksum || !payload.signature?.properties) {
    logger.warn("wompi_webhook.malformed_signature", { event: payload.event });
    return NextResponse.json({ error: "malformed_signature" }, { status: 400 });
  }

  const valid = verifyWompiChecksum({
    properties: payload.signature.properties,
    data: payload.data,
    timestamp,
    checksum: payload.signature.checksum,
    secret,
  });
  if (!valid) {
    // Posible intento de forjar una confirmación de pago — nivel warn, no
    // solo un 401 silencioso.
    logger.warn("wompi_webhook.invalid_checksum", { event: payload.event });
    return NextResponse.json({ error: "invalid_checksum" }, { status: 401 });
  }

  if (payload.event !== "transaction.updated") {
    // Reconocemos el evento pero no hay nada que hacer con él todavía —
    // 200 para que Wompi no lo reintente indefinidamente.
    return NextResponse.json({ ok: true, skipped: true });
  }

  const transaction = payload.data.transaction as
    | {
        id: string;
        status: string;
        amount_in_cents: number;
        reference: string;
        payment_source_id: string | null;
        payment_link_id?: string | null;
      }
    | undefined;
  if (!transaction) {
    logger.warn("wompi_webhook.missing_transaction", { event: payload.event });
    return NextResponse.json({ error: "missing_transaction" }, { status: 400 });
  }

  // Cobro recurrente (transacción directa con el token guardado): solo avanza el
  // período. Va antes que la resolución de compras porque una renovación tratada
  // como compra reiniciaba el ciclo del cliente en cada cobro.
  const renewal = parseRenewalReference(transaction.reference);
  if (renewal) {
    const outcome = await settleRenewalPayment({
      transaction,
      reference: renewal,
      wompiEvent: payload.event,
      rawPayload: payload,
    });
    logger.info("wompi_webhook.renewal_settled", {
      clinicId: renewal.clinicId,
      transactionId: transaction.id,
      ...outcome,
    });
    return NextResponse.json({ ok: true });
  }

  // Wompi NO devuelve nuestra `reference` en los pagos por payment link:
  // genera la suya. La resolución cubre ambos casos (ver
  // lib/db/billing-checkouts.ts).
  const owner = await resolveTransactionOwner(transaction);
  if (!owner || !(await clinicExists(owner.clinicId))) {
    // Podría ser tráfico de prueba del Dashboard de Wompi con una referencia
    // ajena — se acusa recibo igual, sin reintentos.
    logger.warn("wompi_webhook.unknown_reference", { reference: transaction.reference });
    return NextResponse.json({ ok: true, skipped: true });
  }

  await recordBillingEvent({
    clinicId: owner.clinicId,
    wompiTransactionId: transaction.id,
    wompiEvent: payload.event,
    status: transaction.status,
    amountInCents: transaction.amount_in_cents,
    rawPayload: payload,
  });

  if (transaction.status !== "APPROVED") {
    return NextResponse.json({ ok: true });
  }

  // Se intenta en cada entrega del evento aprobado, no solo en la primera: el
  // cumplimiento es idempotente por transacción (billing_fulfillments), y si
  // falla lanza sin aplicar nada, así que el 500 hace que Wompi lo reintente.
  // Antes se activaba solo si el evento era nuevo y un fallo dejaba el pago sin
  // aplicar para siempre. Un pago que no corresponde (monto distinto del precio o
  // de lo cotizado) queda `rejected` en la base para reembolsarlo: 200, porque
  // reintentarlo no cambiaría nada.
  const fulfillment = await fulfillCheckoutPayment(owner, transaction);
  return NextResponse.json({
    ok: true,
    outcome: fulfillment.outcome,
    planActivated: fulfillment.outcome === "applied",
  });
}

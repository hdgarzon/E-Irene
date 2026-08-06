import { NextResponse } from "next/server";
import {
  verifyWompiChecksum,
  extractWompiTimestamp,
  parseBillingReference,
  type WompiEventPayload,
} from "@/lib/billing/wompi";
import { recordBillingEvent, activateBilling, clinicExists } from "@/lib/db/billing";
import { PLANS } from "@/lib/plans";
import { logger } from "@/lib/logger";

/**
 * Webhook de eventos de Wompi. Único endpoint HTTP "crudo" del proyecto —
 * todo lo demás son Server Actions, pero un webhook de un tercero no puede
 * invocar una Server Action (necesita una URL pública estable con su propio
 * contrato de verificación de firma).
 *
 * Fase 1 del roadmap de facturación: solo procesa `transaction.updated`.
 * El checkout que genera estas transacciones (Fase 2) todavía no existe —
 * este endpoint puede recibir tráfico real desde ya (probarlo con el
 * Dashboard sandbox de Wompi) aunque nada en la app dispare pagos todavía.
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
      }
    | undefined;
  if (!transaction) {
    logger.warn("wompi_webhook.missing_transaction", { event: payload.event });
    return NextResponse.json({ error: "missing_transaction" }, { status: 400 });
  }

  const parsedRef = parseBillingReference(transaction.reference);
  if (!parsedRef || !(await clinicExists(parsedRef.clinicId))) {
    // No es un error nuestro necesariamente (podría ser tráfico de prueba
    // del Dashboard de Wompi con una referencia inventada) — se acusa
    // recibo igual, sin reintentos.
    logger.warn("wompi_webhook.unknown_reference", { reference: transaction.reference });
    return NextResponse.json({ ok: true, skipped: true });
  }
  const { clinicId, plan } = parsedRef;

  const { isNew } = await recordBillingEvent({
    clinicId,
    wompiTransactionId: transaction.id,
    wompiEvent: payload.event,
    status: transaction.status,
    amountInCents: transaction.amount_in_cents,
    rawPayload: payload,
  });

  if (isNew && transaction.status === "APPROVED") {
    // Defensa en profundidad: el plan a activar viene de `reference`, que la
    // generamos nosotros y llega firmada — pero activar un plan sin comprobar
    // que lo pagado corresponde a su precio deja el sistema a merced de un
    // solo error (un payment link creado con el monto equivocado, un cambio
    // de precio a mitad de un checkout ya abierto). El monto es el único dato
    // que refleja lo que la clínica realmente pagó, así que se compara.
    const expected = PLANS[plan].priceInCents;
    if (transaction.amount_in_cents !== expected) {
      logger.error("wompi_webhook.amount_mismatch", {
        clinicId,
        plan,
        expected,
        received: transaction.amount_in_cents,
        transactionId: transaction.id,
        action: "NO se activó el plan; el pago quedó registrado en billing_events. Conciliar manualmente.",
      });
      // 200 a propósito: el evento se procesó y quedó registrado; reintentarlo
      // no cambiaría nada. Lo que no se hace es activar el plan.
      return NextResponse.json({ ok: true, planActivated: false });
    }

    await activateBilling(clinicId, plan, transaction.payment_source_id ?? null);
  }

  return NextResponse.json({ ok: true });
}

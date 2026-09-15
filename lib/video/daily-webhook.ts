import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Webhooks de Daily (https://docs.daily.co/reference/rest-api/webhooks).
 *
 * Firma: HMAC-SHA256 de `X-Webhook-Timestamp + "." + cuerpo`, con el secreto
 * decodificado de base64, en base64, en la cabecera `X-Webhook-Signature`. La
 * documentación arma el cuerpo con JSON.stringify(event): se acepta el cuerpo tal
 * como llegó y, si no coincide, su versión re-serializada. Las dos firmas exigen el
 * secreto, así que aceptar ambas no debilita la verificación. Confirmar contra un
 * evento real antes de depender de la segunda.
 */

export function computeDailySignature(params: {
  timestamp: string;
  body: string;
  secret: string;
}): string {
  return createHmac("sha256", Buffer.from(params.secret, "base64"))
    .update(`${params.timestamp}.${params.body}`)
    .digest("base64");
}

function reserialized(body: string): string | null {
  try {
    return JSON.stringify(JSON.parse(body));
  } catch {
    return null;
  }
}

/** Comparación en tiempo constante, como la firma de Wompi (lib/billing/wompi.ts). */
export function verifyDailySignature(params: {
  timestamp: string | null;
  signature: string | null;
  body: string;
  secret: string;
}): boolean {
  const { timestamp, signature, body, secret } = params;
  if (!timestamp || !signature) return false;
  const received = Buffer.from(signature, "utf8");
  const candidates = [body, reserialized(body)].filter(
    (candidate, index, all): candidate is string =>
      candidate !== null && all.indexOf(candidate) === index,
  );
  return candidates.some((candidate) => {
    const expected = Buffer.from(computeDailySignature({ timestamp, body: candidate, secret }), "utf8");
    return expected.length === received.length && timingSafeEqual(expected, received);
  });
}

export interface DailyWebhookEvent {
  version?: string;
  type?: string;
  id?: string;
  event_ts?: number;
  payload?: {
    room?: string;
    user_id?: string | null;
    session_id?: string;
    /** Segundos desde epoch. */
    joined_at?: number;
    owner?: boolean;
  };
}

/** Lo que Daily envía a la URL al crear el webhook: `{"test":"test"}`. */
export function isDailyVerificationPing(event: unknown): boolean {
  return (
    typeof event === "object" && event !== null && (event as Record<string, unknown>).test === "test"
  );
}

import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Verificación de la firma de integridad de eventos de Wompi
 * (https://docs.wompi.co/en/docs/colombia/eventos/). Según la descripción en
 * prosa de esa página: el payload trae `signature.properties` (una lista de
 * rutas dentro de `data`, p. ej. "transaction.id"), y el checksum se arma
 * concatenando esos valores en ese orden, más un timestamp Unix y el secreto
 * de eventos (Dashboard de Wompi, NO la llave de API), hasheado con SHA-256.
 *
 * ⚠️ Esa descripción NO se pudo confirmar contra un ejemplo numérico real —
 * ver la nota al inicio de tests/wompi.test.ts. Confirmar contra un evento
 * real de sandbox antes de depender de esto para activar cobros.
 *
 * Implementación genérica a propósito (lee `properties` del propio payload
 * en vez de asumir campos fijos): así funciona igual para transaction.updated
 * y cualquier otro tipo de evento que Wompi agregue después — asumiendo que
 * la descripción del algoritmo es correcta.
 */

export interface WompiEventPayload {
  event: string;
  data: Record<string, unknown>;
  signature: {
    properties: string[];
    checksum: string;
  };
  /**
   * SIN VERIFICAR contra un payload real de Wompi — ver nota extensa al
   * inicio de tests/wompi.test.ts. Tanto la ubicación exacta de este campo
   * (`payload.timestamp` vs `payload.signature.timestamp`) como el propio
   * algoritmo de concatenación en `computeWompiChecksum` están reconstruidos
   * a partir de descripciones en prosa de la documentación pública, no de un
   * ejemplo numérico confirmado. `extractWompiTimestamp` prueba ambas
   * ubicaciones. ANTES de activar esto contra producción (o incluso contra
   * el sandbox real): disparar un evento de prueba desde el Dashboard de
   * Wompi, loguear el payload crudo una vez, y confirmar contra eso.
   */
  timestamp?: number;
  sent_at?: string;
  environment?: string;
}

function getByPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in acc) return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

export function extractWompiTimestamp(payload: WompiEventPayload): number | null {
  if (typeof payload.timestamp === "number") return payload.timestamp;
  const nested = (payload.signature as unknown as { timestamp?: number }).timestamp;
  if (typeof nested === "number") return nested;
  return null;
}

export function computeWompiChecksum(params: {
  properties: string[];
  data: Record<string, unknown>;
  timestamp: number;
  secret: string;
}): string {
  const concatenated =
    params.properties.map((p) => String(getByPath(params.data, p) ?? "")).join("") +
    String(params.timestamp) +
    params.secret;
  return createHash("sha256").update(concatenated).digest("hex").toUpperCase();
}

/**
 * Comparación en tiempo constante — un checksum de pago no se debe validar
 * con `===` (vulnerable a timing attack para forjar confirmaciones de pago).
 */
export function verifyWompiChecksum(params: {
  properties: string[];
  data: Record<string, unknown>;
  timestamp: number;
  checksum: string;
  secret: string;
}): boolean {
  const expected = Buffer.from(computeWompiChecksum(params), "utf8");
  const received = Buffer.from(params.checksum.toUpperCase(), "utf8");
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}

// ── Referencia de transacción: dónde va embebido el clinicId ────────────────
//
// Wompi no tiene un concepto propio de "cliente E-Irene" — el campo
// `reference` es texto libre que nosotros generamos al crear el checkout
// (Fase 2) y que Wompi nos devuelve tal cual en cada evento. Lo usamos para
// saber a qué clínica pertenece la transacción.

import { PAID_PLANS, PLAN_ORDER, type Plan } from "@/lib/plans";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

const REFERENCE_PREFIX = "planupgrade";
// Los planes salen de lib/plans.ts. Con la lista escrita aquí a mano, un plan
// nuevo se cobraba pero el webhook no reconocía su referencia y no lo activaba.
const REFERENCE_RE = new RegExp(`^planupgrade-(${UUID})-(${PLAN_ORDER.join("|")})-\\d+$`, "i");

export interface BillingReference {
  clinicId: string;
  plan: Plan;
}

export function buildBillingReference(clinicId: string, plan: Plan): string {
  return `${REFERENCE_PREFIX}-${clinicId}-${plan}-${Date.now()}`;
}

export function parseBillingReference(reference: string): BillingReference | null {
  const match = REFERENCE_RE.exec(reference);
  if (!match) return null;
  return { clinicId: match[1], plan: match[2] as Plan };
}

// ── Referencia de los cobros recurrentes ────────────────────────────────────
//
// Los cobros recurrentes son transacciones directas con el token guardado, y en
// ellas Wompi SÍ devuelve nuestra referencia. Llevan un prefijo propio para que
// el webhook no los confunda con la compra de un plan: una compra empieza una
// suscripción (ciclo nuevo) y una renovación solo avanza el período. Tratar las
// renovaciones como compras corría la fecha de corte del cliente cada mes.
//
// Incluye el período que se cobra (periodKeyFor): con él, el webhook encuentra
// el intento en billing_scheduled_charges y sabe qué fin de período renovar.

const RENEWAL_PREFIX = "renewal";
// Solo se renuevan los planes con precio fijo: ni Free ni los planes a convenir.
const RENEWAL_RE = new RegExp(
  `^renewal-(${UUID})-(${PAID_PLANS.join("|")})-(\\d{4}-\\d{2}-\\d{2})-\\d+$`,
  "i",
);

export interface RenewalReference {
  clinicId: string;
  plan: Plan;
  periodKey: string;
}

export function buildRenewalReference(clinicId: string, plan: Plan, periodKey: string): string {
  return `${RENEWAL_PREFIX}-${clinicId}-${plan}-${periodKey}-${Date.now()}`;
}

export function parseRenewalReference(reference: string): RenewalReference | null {
  const match = RENEWAL_RE.exec(reference);
  if (!match) return null;
  return { clinicId: match[1], plan: match[2] as Plan, periodKey: match[3] };
}

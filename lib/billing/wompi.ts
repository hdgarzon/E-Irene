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

import type { Plan } from "@/lib/plans";

const REFERENCE_PREFIX = "planupgrade";
const REFERENCE_RE =
  /^planupgrade-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(free|pro|clinica|enterprise)-\d+$/i;

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

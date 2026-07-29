import { describe, it, expect } from "vitest";
import {
  computeWompiChecksum,
  verifyWompiChecksum,
  extractWompiTimestamp,
  buildBillingReference,
  parseClinicIdFromReference,
  type WompiEventPayload,
} from "@/lib/billing/wompi";

/**
 * IMPORTANTE — leer antes de confiar en este archivo:
 *
 * NO existe todavía un vector de prueba verificado contra un payload real de
 * Wompi. Un intento anterior de conseguir uno vía búsqueda web produjo un
 * "ejemplo oficial" que resultó ser alucinado por la herramienta de
 * resumen — el checksum que decía no lo reproducía ningún orden de
 * concatenación razonable. Se descartó por completo en vez de dejarlo como
 * prueba falsa.
 *
 * Estos tests solo verifican CONSISTENCIA INTERNA del algoritmo (que
 * compute/verify sean inversos, que la comparación sea sensible a
 * manipulación) — NO prueban que el algoritmo coincida con lo que Wompi
 * realmente hace. Eso solo se puede confirmar dos formas: (a) capturando un
 * evento real del Dashboard sandbox de Wompi y comparando el checksum que
 * ellos mandan contra `computeWompiChecksum` con esos mismos datos, o (b)
 * encontrando el SDK oficial de Wompi (Node/PHP) y leyendo su código fuente
 * real. NO desplegar este webhook contra producción sin haber hecho (a).
 */
const SAMPLE_VECTOR = {
  properties: ["transaction.id", "transaction.status", "transaction.amount_in_cents"],
  data: {
    transaction: {
      id: "1234-1610641025-49201",
      status: "APPROVED",
      amount_in_cents: 4490000,
    },
  },
  timestamp: 1530291411,
  secret: "test_events_secret",
};

describe("wompi (verificación de firma de webhooks) — SOLO consistencia interna, ver nota arriba", () => {
  it("verifyWompiChecksum acepta el checksum que su propio compute produjo", () => {
    const checksum = computeWompiChecksum(SAMPLE_VECTOR);
    expect(verifyWompiChecksum({ ...SAMPLE_VECTOR, checksum })).toBe(true);
  });

  it("verifyWompiChecksum rechaza un checksum alterado", () => {
    const checksum = computeWompiChecksum(SAMPLE_VECTOR);
    expect(verifyWompiChecksum({ ...SAMPLE_VECTOR, checksum: checksum.replace(/^./, "0") })).toBe(
      false,
    );
  });

  it("verifyWompiChecksum rechaza si cualquier valor de data cambió (payload manipulado)", () => {
    const checksum = computeWompiChecksum(SAMPLE_VECTOR);
    const tampered = {
      ...SAMPLE_VECTOR,
      data: { transaction: { ...SAMPLE_VECTOR.data.transaction, amount_in_cents: 1 } },
      checksum,
    };
    expect(verifyWompiChecksum(tampered)).toBe(false);
  });

  it("verifyWompiChecksum rechaza si el secreto no coincide", () => {
    const checksum = computeWompiChecksum(SAMPLE_VECTOR);
    expect(verifyWompiChecksum({ ...SAMPLE_VECTOR, checksum, secret: "otro_secreto" })).toBe(false);
  });

  it("verifyWompiChecksum rechaza si el timestamp no coincide", () => {
    const checksum = computeWompiChecksum(SAMPLE_VECTOR);
    expect(verifyWompiChecksum({ ...SAMPLE_VECTOR, checksum, timestamp: SAMPLE_VECTOR.timestamp + 1 })).toBe(
      false,
    );
  });

  it("extractWompiTimestamp lee de payload.timestamp cuando está presente", () => {
    const payload = { timestamp: 111 } as unknown as WompiEventPayload;
    expect(extractWompiTimestamp(payload)).toBe(111);
  });

  it("extractWompiTimestamp cae a signature.timestamp cuando el top-level no está", () => {
    const payload = { signature: { timestamp: 222 } } as unknown as WompiEventPayload;
    expect(extractWompiTimestamp(payload)).toBe(222);
  });

  it("extractWompiTimestamp devuelve null si no se encuentra en ninguno de los dos lugares", () => {
    const payload = { signature: {} } as unknown as WompiEventPayload;
    expect(extractWompiTimestamp(payload)).toBeNull();
  });

  it("buildBillingReference/parseClinicIdFromReference son inversas", () => {
    const clinicId = "6550747c-13a0-4cfb-a88a-b1cb9bb99952";
    const reference = buildBillingReference(clinicId);
    expect(parseClinicIdFromReference(reference)).toBe(clinicId);
  });

  it("parseClinicIdFromReference devuelve null para una referencia con formato inválido", () => {
    expect(parseClinicIdFromReference("algo-inventado")).toBeNull();
    expect(parseClinicIdFromReference("planupgrade-no-es-un-uuid-123")).toBeNull();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const recordBillingEvent = vi.fn();
const activateBilling = vi.fn();
const clinicExists = vi.fn();

vi.mock("@/lib/db/billing", () => ({
  recordBillingEvent: (...a: unknown[]) => recordBillingEvent(...a),
  activateBilling: (...a: unknown[]) => activateBilling(...a),
  clinicExists: (...a: unknown[]) => clinicExists(...a),
}));

const { reconcilePlanPayment } = await import("@/lib/billing/reconcile");

const CLINIC = "6550747c-13a0-4cfb-a88a-b1cb9bb99952";
const OTRA_CLINICA = "11111111-2222-3333-4444-555555555555";

function stubTransaction(tx: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: tx }),
    })) as unknown as typeof fetch,
  );
}

beforeEach(() => {
  process.env.WOMPI_PUBLIC_KEY = "pub_test_key";
  process.env.WOMPI_ENVIRONMENT = "sandbox";
  recordBillingEvent.mockReset().mockResolvedValue({ isNew: true });
  activateBilling.mockReset().mockResolvedValue(undefined);
  clinicExists.mockReset().mockResolvedValue(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reconcilePlanPayment", () => {
  it("activa el plan cuando el pago está aprobado y todo cuadra", async () => {
    stubTransaction({
      id: "tx-1",
      status: "APPROVED",
      amount_in_cents: 2_900_000,
      reference: `planupgrade-${CLINIC}-pro-1700000000000`,
      payment_source_id: 55,
    });

    const out = await reconcilePlanPayment("tx-1", CLINIC);

    expect(out).toEqual({ result: "activated", plan: "pro" });
    expect(activateBilling).toHaveBeenCalledWith(CLINIC, "pro", "55");
  });

  it("SEGURIDAD: no activa nada si la transacción pertenece a otra clínica", async () => {
    // Sin esta verificación, cualquiera podría pegar en la URL de retorno el
    // id de una transacción ajena y activarse un plan que pagó otro.
    stubTransaction({
      id: "tx-ajena",
      status: "APPROVED",
      amount_in_cents: 2_900_000,
      reference: `planupgrade-${OTRA_CLINICA}-enterprise-1700000000000`,
    });

    const out = await reconcilePlanPayment("tx-ajena", CLINIC);

    expect(out).toEqual({ result: "ignored", reason: "la_transaccion_es_de_otra_clinica" });
    expect(activateBilling).not.toHaveBeenCalled();
    expect(recordBillingEvent).not.toHaveBeenCalled();
  });

  it("SEGURIDAD: no activa un plan si el monto pagado no corresponde a su precio", async () => {
    stubTransaction({
      id: "tx-barata",
      status: "APPROVED",
      amount_in_cents: 100, // pagó $1 por un plan de $149.000
      reference: `planupgrade-${CLINIC}-enterprise-1700000000000`,
    });

    const out = await reconcilePlanPayment("tx-barata", CLINIC);

    expect(out).toEqual({ result: "ignored", reason: "monto_no_coincide_con_el_plan" });
    expect(activateBilling).not.toHaveBeenCalled();
  });

  it("no activa si el pago no está aprobado (PENDING/DECLINED)", async () => {
    stubTransaction({
      id: "tx-pendiente",
      status: "PENDING",
      amount_in_cents: 2_900_000,
      reference: `planupgrade-${CLINIC}-pro-1700000000000`,
    });

    const out = await reconcilePlanPayment("tx-pendiente", CLINIC);

    expect(out).toEqual({ result: "not_approved", status: "PENDING" });
    expect(activateBilling).not.toHaveBeenCalled();
  });

  it("no vuelve a activar si el webhook ya procesó el mismo pago (idempotencia)", async () => {
    recordBillingEvent.mockResolvedValue({ isNew: false });
    stubTransaction({
      id: "tx-1",
      status: "APPROVED",
      amount_in_cents: 2_900_000,
      reference: `planupgrade-${CLINIC}-pro-1700000000000`,
    });

    const out = await reconcilePlanPayment("tx-1", CLINIC);

    expect(out).toEqual({ result: "already_processed" });
    expect(activateBilling).not.toHaveBeenCalled();
  });

  it("activa igual si Wompi no devuelve payment_source_id (sin token de cobro recurrente)", async () => {
    stubTransaction({
      id: "tx-sin-token",
      status: "APPROVED",
      amount_in_cents: 2_900_000,
      reference: `planupgrade-${CLINIC}-pro-1700000000000`,
    });

    const out = await reconcilePlanPayment("tx-sin-token", CLINIC);

    // La clínica pagó: el plan se activa. Que falte el token es un problema
    // nuestro para el cobro del mes siguiente, no motivo para negarle lo pagado.
    expect(out).toEqual({ result: "activated", plan: "pro" });
    expect(activateBilling).toHaveBeenCalledWith(CLINIC, "pro", null);
  });

  it("ignora una referencia que no es de E-Irene", async () => {
    stubTransaction({
      id: "tx-x",
      status: "APPROVED",
      amount_in_cents: 2_900_000,
      reference: "algo-de-otro-comercio",
    });

    const out = await reconcilePlanPayment("tx-x", CLINIC);
    expect(out).toEqual({ result: "ignored", reason: "referencia_no_reconocida" });
    expect(activateBilling).not.toHaveBeenCalled();
  });
});

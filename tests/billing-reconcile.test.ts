import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const recordBillingEvent = vi.fn();
const clinicExists = vi.fn();
const fulfillCheckoutPayment = vi.fn();

vi.mock("@/lib/db/billing", () => ({
  recordBillingEvent: (...a: unknown[]) => recordBillingEvent(...a),
  clinicExists: (...a: unknown[]) => clinicExists(...a),
}));

// Qué se aplica y con qué monto lo decide la base (plan-changes.test.ts); acá se
// prueba quién puede reclamar un pago y que cada vuelta lo intente aplicar.
vi.mock("@/lib/billing/fulfillment", () => ({
  fulfillCheckoutPayment: (...a: unknown[]) => fulfillCheckoutPayment(...a),
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

const approvedPro = {
  id: "tx-1",
  status: "APPROVED",
  amount_in_cents: 9_900_000,
  reference: `planupgrade-${CLINIC}-pro-1700000000000`,
  payment_source_id: 55,
};

beforeEach(() => {
  process.env.WOMPI_PUBLIC_KEY = "pub_test_key";
  process.env.WOMPI_ENVIRONMENT = "sandbox";
  recordBillingEvent.mockReset().mockResolvedValue({ isNew: true });
  clinicExists.mockReset().mockResolvedValue(true);
  fulfillCheckoutPayment
    .mockReset()
    .mockResolvedValue({ outcome: "applied", kind: "plan", plan: "pro", alreadyProcessed: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reconcilePlanPayment", () => {
  it("aplica el pago aprobado con la compra resuelta desde la referencia", async () => {
    stubTransaction(approvedPro);

    const out = await reconcilePlanPayment("tx-1", CLINIC);

    expect(out).toEqual({ result: "activated", kind: "plan", plan: "pro" });
    expect(fulfillCheckoutPayment).toHaveBeenCalledWith(
      expect.objectContaining({ clinicId: CLINIC, plan: "pro", kind: "plan", checkoutId: null }),
      expect.objectContaining({ id: "tx-1", amount_in_cents: 9_900_000, payment_source_id: 55 }),
    );
    expect(recordBillingEvent).toHaveBeenCalledTimes(1);
  });

  it("SEGURIDAD: no aplica nada si la transacción pertenece a otra clínica", async () => {
    // Sin esta verificación, cualquiera podría pegar en la URL de retorno el
    // id de una transacción ajena y activarse un plan que pagó otro.
    stubTransaction({
      ...approvedPro,
      id: "tx-ajena",
      reference: `planupgrade-${OTRA_CLINICA}-clinica-1700000000000`,
    });

    const out = await reconcilePlanPayment("tx-ajena", CLINIC);

    expect(out).toEqual({ result: "ignored", reason: "la_transaccion_es_de_otra_clinica" });
    expect(fulfillCheckoutPayment).not.toHaveBeenCalled();
    expect(recordBillingEvent).not.toHaveBeenCalled();
  });

  it("SEGURIDAD: informa el pago que la base rechazó (monto distinto), sin darlo por activo", async () => {
    stubTransaction({ ...approvedPro, id: "tx-barata", amount_in_cents: 100 });
    fulfillCheckoutPayment.mockResolvedValue({
      outcome: "rejected",
      kind: "plan",
      reason: "monto_no_coincide_con_el_plan",
      alreadyProcessed: false,
    });

    const out = await reconcilePlanPayment("tx-barata", CLINIC);

    expect(out).toEqual({
      result: "rejected",
      kind: "plan",
      reason: "monto_no_coincide_con_el_plan",
    });
    // El evento queda como constancia del cobro, para reembolsarlo.
    expect(recordBillingEvent).toHaveBeenCalledTimes(1);
  });

  it("no aplica si el pago no está aprobado (PENDING/DECLINED)", async () => {
    stubTransaction({ ...approvedPro, id: "tx-pendiente", status: "PENDING" });

    const out = await reconcilePlanPayment("tx-pendiente", CLINIC);

    expect(out).toEqual({ result: "not_approved", status: "PENDING" });
    expect(fulfillCheckoutPayment).not.toHaveBeenCalled();
  });

  it("si el webhook ya lo aplicó, lo informa sin volver a aplicarlo", async () => {
    recordBillingEvent.mockResolvedValue({ isNew: false });
    fulfillCheckoutPayment.mockResolvedValue({
      outcome: "applied",
      kind: "upgrade",
      plan: "clinica",
      alreadyProcessed: true,
    });
    stubTransaction(approvedPro);

    const out = await reconcilePlanPayment("tx-1", CLINIC);

    expect(out).toEqual({ result: "already_processed", kind: "upgrade", plan: "clinica" });
  });

  it("un evento ya registrado cuyo cumplimiento había fallado se vuelve a intentar", async () => {
    // Antes solo se activaba si el evento era nuevo: un fallo al activar después
    // de registrarlo dejaba el pago sin aplicar para siempre.
    recordBillingEvent.mockResolvedValue({ isNew: false });
    stubTransaction(approvedPro);

    const out = await reconcilePlanPayment("tx-1", CLINIC);

    expect(out).toEqual({ result: "activated", kind: "plan", plan: "pro" });
    expect(fulfillCheckoutPayment).toHaveBeenCalledTimes(1);
  });

  it("si el cumplimiento falla, lanza: no informa un pago aplicado que no lo está", async () => {
    stubTransaction(approvedPro);
    fulfillCheckoutPayment.mockRejectedValue(new Error("conexión perdida"));

    await expect(reconcilePlanPayment("tx-1", CLINIC)).rejects.toThrow("conexión perdida");
  });

  it("aplica igual si Wompi no devuelve payment_source_id (sin token de cobro recurrente)", async () => {
    stubTransaction({ ...approvedPro, id: "tx-sin-token", payment_source_id: null });

    const out = await reconcilePlanPayment("tx-sin-token", CLINIC);

    // La clínica pagó: el plan se activa. Que falte el token es un problema
    // nuestro para el cobro del mes siguiente, no motivo para negarle lo pagado.
    expect(out).toEqual({ result: "activated", kind: "plan", plan: "pro" });
  });

  it("ignora una referencia que no es de E-Irene", async () => {
    stubTransaction({ ...approvedPro, id: "tx-x", reference: "algo-de-otro-comercio" });

    const out = await reconcilePlanPayment("tx-x", CLINIC);
    expect(out).toEqual({ result: "ignored", reason: "referencia_no_reconocida" });
    expect(fulfillCheckoutPayment).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Cobros recurrentes: el cron y el webhook resuelven la renovación del MISMO
// cobro y ninguno de los dos puede reiniciar el ciclo ni renovarlo dos veces.
// La idempotencia real vive en renew_subscription_period (billing-cycle.test.ts);
// acá se prueba que ambos caminos le pasen el fin de período correcto.

const db = vi.hoisted(() => ({
  getClinicsDueForCharge: vi.fn(),
  isStillDueForCharge: vi.fn(),
  createScheduledCharge: vi.fn(),
  markScheduledChargeSuccess: vi.fn(),
  markScheduledChargeFailed: vi.fn(),
  renewBilling: vi.fn(),
  markBillingFailed: vi.fn(),
  flagClinicForBillingReview: vi.fn(),
  expireStaleProcessingCharges: vi.fn(),
  recordBillingEvent: vi.fn(),
  clinicExists: vi.fn(),
  findScheduledChargeForPeriod: vi.fn(),
  getSubscriptionPeriod: vi.fn(),
}));

vi.mock("@/lib/db/billing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/billing")>();
  return { ...db, periodKeyFor: actual.periodKeyFor };
});

// flagClinicsWithRepeatedFailures consulta la base directamente al final del cron.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ gte: async () => ({ data: [], error: null }) }) }),
    }),
  }),
}));

const { settleRenewalPayment, processRecurringCharges } = await import("@/lib/billing/recurring");
const { parseRenewalReference } = await import("@/lib/billing/wompi");

const CLINIC = "6550747c-13a0-4cfb-a88a-b1cb9bb99952";
const PERIOD_END = "2026-10-18T14:00:00+00:00";
const NEXT_PERIOD_END = "2026-11-18T14:00:00+00:00";
const reference = { clinicId: CLINIC, plan: "pro" as const, periodKey: "2026-10-18" };

function transaction(status = "APPROVED", amount = 2_900_000) {
  return { id: "tx-renewal-1", status, amount_in_cents: amount };
}

function charge(overrides: Record<string, unknown> = {}) {
  return {
    id: "charge-1",
    plan: "pro",
    status: "processing",
    amountInCents: 2_900_000,
    dueAt: PERIOD_END,
    ...overrides,
  };
}

function settle(tx = transaction()) {
  return settleRenewalPayment({
    transaction: tx,
    reference,
    wompiEvent: "transaction.updated",
    rawPayload: {},
  });
}

beforeEach(() => {
  for (const fn of Object.values(db)) fn.mockReset();
  db.clinicExists.mockResolvedValue(true);
  db.recordBillingEvent.mockResolvedValue({ isNew: true });
  db.findScheduledChargeForPeriod.mockResolvedValue(charge());
  db.markScheduledChargeSuccess.mockResolvedValue(undefined);
  db.renewBilling.mockResolvedValue(NEXT_PERIOD_END);
  db.getSubscriptionPeriod.mockResolvedValue({ plan: "pro", currentPeriodEnd: NEXT_PERIOD_END });
});

describe("settleRenewalPayment (webhook de cobros recurrentes)", () => {
  it("un cobro aprobado cierra el intento y renueva el período que se cobró", async () => {
    await expect(settle()).resolves.toEqual({ result: "renewed", periodEnd: NEXT_PERIOD_END });
    expect(db.markScheduledChargeSuccess).toHaveBeenCalledWith("charge-1", "tx-renewal-1");
    // El fin de período del intento registrado, no la fecha en que llega el webhook.
    expect(db.renewBilling).toHaveBeenCalledWith(CLINIC, PERIOD_END);
  });

  it("si el cron ya renovó ese período, el webhook no lo renueva otra vez", async () => {
    db.findScheduledChargeForPeriod.mockResolvedValue(charge({ status: "success" }));
    db.renewBilling.mockResolvedValue(null);
    await expect(settle()).resolves.toEqual({ result: "already_applied" });
    expect(db.markScheduledChargeSuccess).not.toHaveBeenCalled();
  });

  it("un cobro aprobado después de que la suscripción terminó no la revive y queda para conciliar", async () => {
    // Venció la gracia (o se canceló) entre el cobro y su aprobación: la clínica
    // pagó por un plan que ya no tiene. No se reactiva en silencio.
    db.renewBilling.mockResolvedValue(null);
    db.getSubscriptionPeriod.mockResolvedValue({ plan: "free", currentPeriodEnd: null });
    await expect(settle()).resolves.toEqual({ result: "ignored", reason: "suscripcion_terminada" });
  });

  it("una entrega repetida del evento vuelve a intentar renovar: renovar es idempotente", async () => {
    // Si el primer procesamiento se cayó después de registrar el evento, cortar
    // por isNew dejaría ese cobro sin renovar para siempre.
    db.recordBillingEvent.mockResolvedValue({ isNew: false });
    await settle();
    expect(db.renewBilling).toHaveBeenCalledWith(CLINIC, PERIOD_END);
  });

  it("un cobro rechazado queda registrado y no renueva", async () => {
    await expect(settle(transaction("DECLINED"))).resolves.toEqual({
      result: "not_approved",
      status: "DECLINED",
    });
    expect(db.recordBillingEvent).toHaveBeenCalled();
    expect(db.renewBilling).not.toHaveBeenCalled();
  });

  it("SEGURIDAD: no renueva si el monto aprobado no es el que se pidió cobrar", async () => {
    await expect(settle(transaction("APPROVED", 100))).resolves.toEqual({
      result: "ignored",
      reason: "no_coincide_con_el_cobro",
    });
    expect(db.renewBilling).not.toHaveBeenCalled();
  });

  it("sin intento registrado para ese período no renueva nada", async () => {
    db.findScheduledChargeForPeriod.mockResolvedValue(null);
    await expect(settle()).resolves.toEqual({ result: "ignored", reason: "cobro_no_registrado" });
    expect(db.renewBilling).not.toHaveBeenCalled();
  });

  it("un cobro dado por fallido que Wompi aprobó después renueva igual, sin tocar el intento liquidado", async () => {
    db.findScheduledChargeForPeriod.mockResolvedValue(charge({ status: "failed" }));
    await expect(settle()).resolves.toEqual({ result: "renewed", periodEnd: NEXT_PERIOD_END });
    expect(db.markScheduledChargeSuccess).not.toHaveBeenCalled();
    expect(db.renewBilling).toHaveBeenCalledWith(CLINIC, PERIOD_END);
  });

  it("no registra nada de una clínica inexistente", async () => {
    db.clinicExists.mockResolvedValue(false);
    await expect(settle()).resolves.toEqual({ result: "ignored", reason: "clinica_inexistente" });
    expect(db.recordBillingEvent).not.toHaveBeenCalled();
  });
});

describe("processRecurringCharges (cron)", () => {
  const due = {
    id: CLINIC,
    plan: "pro" as const,
    currentPeriodEnd: PERIOD_END,
    wompiPaymentSourceId: "ps-123",
  };

  beforeEach(() => {
    process.env.WOMPI_PRIVATE_KEY = "test_private_key";
    process.env.WOMPI_ENVIRONMENT = "sandbox";
    db.expireStaleProcessingCharges.mockResolvedValue(0);
    db.getClinicsDueForCharge.mockResolvedValue([due]);
    db.isStillDueForCharge.mockResolvedValue(true);
    db.createScheduledCharge.mockResolvedValue("charge-1");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: { id: "tx-1", status: "APPROVED" } }),
      })) as unknown as typeof fetch,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("un cobro aprobado renueva desde el fin del período cobrado y lleva referencia de renovación", async () => {
    const result = await processRecurringCharges();
    expect(result.succeeded).toBe(1);
    expect(db.renewBilling).toHaveBeenCalledWith(CLINIC, PERIOD_END);

    const body = JSON.parse(
      (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string,
    );
    // Con referencia de compra, el webhook de este mismo cobro reiniciaría el ciclo.
    expect(parseRenewalReference(body.reference)).toEqual(reference);
  });

  it("un token que no descifra aparta solo a su clínica: no se cobra ni queda morosa, y las demás se cobran", async () => {
    const unreadable = {
      ...due,
      id: "00000000-0000-4000-8000-000000000002",
      wompiPaymentSourceId: null,
      paymentSourceUnreadable: true as const,
    };
    db.getClinicsDueForCharge.mockResolvedValue([unreadable, due]);

    const result = await processRecurringCharges();
    expect(result).toMatchObject({
      processed: 2,
      succeeded: 1,
      failed: 0,
      unreadablePaymentSource: 1,
      // No es una clínica sin token: el token existe y hay que recuperarlo.
      missingPaymentSource: 0,
    });

    // Ni se reserva su período ni se le cobra ni se toca su estado.
    expect(db.isStillDueForCharge).toHaveBeenCalledTimes(1);
    expect(db.createScheduledCharge).toHaveBeenCalledTimes(1);
    expect(db.createScheduledCharge).toHaveBeenCalledWith(expect.objectContaining({ clinicId: CLINIC }));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(db.markBillingFailed).not.toHaveBeenCalled();
    expect(db.markScheduledChargeFailed).not.toHaveBeenCalled();
    expect(db.renewBilling).toHaveBeenCalledTimes(1);
    expect(db.renewBilling).toHaveBeenCalledWith(CLINIC, PERIOD_END);
  });

  it("si la clínica canceló o cambió de plan desde la consulta, no se cobra", async () => {
    db.isStillDueForCharge.mockResolvedValue(false);
    const result = await processRecurringCharges();
    expect(result.skipped).toBe(1);
    expect(db.createScheduledCharge).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Qué función de la base aplica cada compra y con qué datos. Las reglas (monto,
// cotización, una sola vez por transacción) viven en la base: plan-changes.test.ts.

const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: (...a: unknown[]) => rpc(...a) }),
}));
vi.mock("@/lib/crypto", () => ({ encrypt: (value: string) => `enc(${value})` }));

const { fulfillCheckoutPayment } = await import("@/lib/billing/fulfillment");
const { logger } = await import("@/lib/logger");
const { PLANS } = await import("@/lib/plans");

const CLINIC = "6550747c-13a0-4cfb-a88a-b1cb9bb99952";
const CHECKOUT = "0b7c1d2e-3f40-4a5b-8c6d-7e8f90a1b2c3";

function owner(overrides: Record<string, unknown> = {}) {
  return {
    checkoutId: CHECKOUT,
    clinicId: CLINIC,
    plan: "pro" as const,
    kind: "plan" as const,
    amountInCents: 9_900_000,
    quantity: null,
    details: {},
    ...overrides,
  } as Parameters<typeof fulfillCheckoutPayment>[0];
}

const tx = {
  id: "tx-demo-1",
  amount_in_cents: 9_900_000,
  payment_source_id: 55,
  created_at: "2026-09-15T15:00:00.000Z",
};

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({
    data: { outcome: "applied", plan: "pro", already_processed: false },
    error: null,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fulfillCheckoutPayment", () => {
  it("la compra de un plan con link se valida contra el monto del link, no contra el precio vigente", async () => {
    const result = await fulfillCheckoutPayment(owner(), tx);

    expect(result).toEqual({ outcome: "applied", kind: "plan", plan: "pro", alreadyProcessed: false });
    expect(rpc).toHaveBeenCalledWith("fulfill_plan_purchase", {
      p_clinic: CLINIC,
      p_transaction_id: "tx-demo-1",
      p_checkout_id: CHECKOUT,
      p_plan: "pro",
      p_amount: 9_900_000,
      p_expected_amount: undefined,
      // El token del medio de pago nunca viaja en claro.
      p_payment_source_enc: "enc(55)",
      // Con ella la base comprueba que el link no había vencido.
      p_transaction_created_at: "2026-09-15T15:00:00.000Z",
    });
  });

  it("un pago sin checkout (referencia propia) se valida contra el precio vigente de lib/plans.ts", async () => {
    await fulfillCheckoutPayment(owner({ checkoutId: null }), tx);
    expect(rpc).toHaveBeenCalledWith(
      "fulfill_plan_purchase",
      expect.objectContaining({ p_checkout_id: undefined, p_expected_amount: PLANS.pro.priceInCents }),
    );
  });

  it("un plan a convenir llega sin precio esperado: la base lo rechaza", async () => {
    await fulfillCheckoutPayment(owner({ plan: "enterprise", checkoutId: null }), {
      id: "tx-demo-2",
      amount_in_cents: 1,
    });
    expect(rpc).toHaveBeenCalledWith(
      "fulfill_plan_purchase",
      expect.objectContaining({ p_expected_amount: undefined, p_checkout_id: undefined }),
    );
  });

  it("un upgrade se aplica contra su checkout, que guarda la cotización", async () => {
    rpc.mockResolvedValue({
      data: { outcome: "applied", plan: "clinica", already_processed: false },
      error: null,
    });

    const result = await fulfillCheckoutPayment(owner({ kind: "upgrade", plan: "clinica" }), {
      id: "tx-demo-3",
      amount_in_cents: 5_000_000,
    });

    expect(result).toEqual({
      outcome: "applied",
      kind: "upgrade",
      plan: "clinica",
      alreadyProcessed: false,
    });
    expect(rpc).toHaveBeenCalledWith("apply_plan_upgrade", {
      p_clinic: CLINIC,
      p_transaction_id: "tx-demo-3",
      p_checkout_id: CHECKOUT,
      p_amount: 5_000_000,
      p_payment_source_enc: undefined,
      p_transaction_created_at: undefined,
    });
  });

  it("un upgrade sin checkout registrado no se aplica: no hay cotización que comprobar", async () => {
    await expect(
      fulfillCheckoutPayment(owner({ kind: "upgrade", checkoutId: null }), tx),
    ).rejects.toThrow("sin checkout");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("una bolsa de transcripción se otorga contra su checkout, sin token de cobro", async () => {
    rpc.mockResolvedValue({
      data: { outcome: "applied", plan: "esencial", seconds: 18_000, already_processed: false },
      error: null,
    });

    const result = await fulfillCheckoutPayment(
      owner({ kind: "transcription_pack", plan: "esencial", amountInCents: 2_500_000, quantity: 1 }),
      { id: "tx-demo-4", amount_in_cents: 2_500_000, payment_source_id: 77 },
    );

    expect(result).toEqual({
      outcome: "applied",
      kind: "transcription_pack",
      plan: "esencial",
      alreadyProcessed: false,
    });
    // Ni horas ni vencimiento viajan desde aquí: los fija la base.
    expect(rpc).toHaveBeenCalledWith("grant_transcription_pack", {
      p_clinic: CLINIC,
      p_transaction_id: "tx-demo-4",
      p_checkout_id: CHECKOUT,
      p_amount: 2_500_000,
    });
  });

  it("una bolsa sin checkout registrado no se otorga", async () => {
    await expect(
      fulfillCheckoutPayment(owner({ kind: "transcription_pack", checkoutId: null }), tx),
    ).rejects.toThrow("sin checkout");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("un pack de videollamadas se otorga contra su checkout: cantidad y monto los valida la base", async () => {
    rpc.mockResolvedValue({
      data: { outcome: "applied", plan: "pro", quantity: 5, already_processed: false },
      error: null,
    });

    const result = await fulfillCheckoutPayment(
      owner({ kind: "video_pack", amountInCents: 4_500_000, quantity: 5 }),
      { id: "tx-demo-5", amount_in_cents: 4_500_000, payment_source_id: 88 },
    );

    expect(result).toEqual({ outcome: "applied", kind: "video_pack", plan: "pro", alreadyProcessed: false });
    expect(rpc).toHaveBeenCalledWith("grant_video_pack", {
      p_clinic: CLINIC,
      p_transaction_id: "tx-demo-5",
      p_checkout_id: CHECKOUT,
      p_amount: 4_500_000,
    });
  });

  it("un pack de videollamadas sin checkout registrado no se otorga", async () => {
    await expect(
      fulfillCheckoutPayment(owner({ kind: "video_pack", checkoutId: null }), tx),
    ).rejects.toThrow("sin checkout");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("un tipo de compra sin cumplimiento lanza en vez de darse por procesado", async () => {
    await expect(fulfillCheckoutPayment(owner({ kind: "otro" }), tx)).rejects.toThrow(
      "sin cumplimiento",
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it("un error de la base se propaga: el webhook responde 500 y Wompi reintenta", async () => {
    rpc.mockResolvedValue({ data: null, error: new Error("canceling statement due to timeout") });
    await expect(fulfillCheckoutPayment(owner(), tx)).rejects.toThrow("timeout");
  });

  it("un pago rechazado se reporta una vez, no en cada reintento", async () => {
    const errors = vi.spyOn(logger, "error").mockImplementation(() => {});

    rpc.mockResolvedValue({
      data: { outcome: "rejected", reason: "monto_no_coincide_con_el_plan", already_processed: false },
      error: null,
    });
    await expect(fulfillCheckoutPayment(owner(), tx)).resolves.toEqual({
      outcome: "rejected",
      kind: "plan",
      reason: "monto_no_coincide_con_el_plan",
      alreadyProcessed: false,
    });

    rpc.mockResolvedValue({
      data: { outcome: "rejected", reason: "monto_no_coincide_con_el_plan", already_processed: true },
      error: null,
    });
    await fulfillCheckoutPayment(owner(), tx);

    const reports = errors.mock.calls.filter(([event]) => event === "billing.payment_rejected");
    expect(reports).toHaveLength(1);
  });
});

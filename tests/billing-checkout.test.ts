import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createWompiCheckout } from "@/lib/billing/wompi-checkout";
import { chargeClinic } from "@/lib/billing/recurring";
import { periodKeyFor } from "@/lib/db/billing";

describe("createWompiCheckout", () => {
  beforeEach(() => {
    process.env.WOMPI_PRIVATE_KEY = "test_private_key";
    process.env.WOMPI_ENVIRONMENT = "sandbox";
    // El mock NO incluye un campo `url`: la respuesta real de Wompi tampoco
    // lo trae. El mock anterior lo inventaba, y por eso este test pasaba
    // mientras el checkout fallaba en producción.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            data: { id: "pl-123", active: true },
          }),
      })) as unknown as typeof fetch,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects free plans", async () => {
    await expect(
      createWompiCheckout({
        clinicId: "6550747c-13a0-4cfb-a88a-b1cb9bb99952",
        plan: "free",
        redirectUrl: "https://e-irene.co/settings/plan?wompi=return",
      }),
    ).rejects.toThrow("no requiere pago");
  });

  it("creates a checkout for a paid plan", async () => {
    const result = await createWompiCheckout({
      clinicId: "6550747c-13a0-4cfb-a88a-b1cb9bb99952",
      plan: "pro",
      redirectUrl: "https://e-irene.co/settings/plan?wompi=return",
      userEmail: "test@example.com",
    });

    expect(result.paymentLinkId).toBe("pl-123");
    expect(result.checkoutUrl).toBe("https://checkout.wompi.co/l/pl-123");
    expect(result.reference).toMatch(/^planupgrade-6550747c-13a0-4cfb-a88a-b1cb9bb99952-pro-\d+$/);

    const fetchCall = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[0]).toBe("https://sandbox.wompi.co/v1/payment_links");
    const body = JSON.parse(fetchCall[1].body);
    expect(body.amount_in_cents).toBe(2_900_000);
    expect(body.currency).toBe("COP");
    expect(body.reference).toBe(result.reference);
    expect(body.redirect_url).toBe("https://e-irene.co/settings/plan?wompi=return");
    // Requeridos por Wompi — su ausencia causó un 422 INPUT_VALIDATION_ERROR
    // real en producción (2026-08-05) porque el mock de este test siempre
    // devolvía éxito y nunca lo hubiera atrapado sin esta aserción explícita.
    expect(body.single_use).toBe(true);
    expect(body.collect_shipping).toBe(false);
  });

  it("construye la URL de pago desde el id (Wompi no la devuelve en la respuesta)", async () => {
    // Regresión del segundo fallo real en producción (2026-08-06): el link SE
    // CREABA correctamente (200 OK), pero el código buscaba un campo
    // `url`/`checkout_url` que la respuesta de Wompi nunca incluye, así que
    // abortaba un checkout perfectamente válido. El mock replica la forma
    // exacta de la respuesta real, sin campo de URL.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            data: {
              id: "test_ikE08d",
              name: "Plan Professional · E-Irene",
              amount_in_cents: 2_900_000,
              currency: "COP",
              single_use: true,
              collect_shipping: false,
              active: true,
            },
          }),
      })) as unknown as typeof fetch,
    );

    const result = await createWompiCheckout({
      clinicId: "6550747c-13a0-4cfb-a88a-b1cb9bb99952",
      plan: "pro",
      redirectUrl: "https://e-irene.co/settings/plan?wompi=return",
    });

    expect(result.checkoutUrl).toBe("https://checkout.wompi.co/l/test_ikE08d");
    expect(result.paymentLinkId).toBe("test_ikE08d");
  });

  it("regresión: reproduce el 422 real de producción si vuelven a faltar single_use/collect_shipping", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        const sent = JSON.parse(init.body);
        const missing: string[] = [];
        if (sent.single_use === undefined) missing.push("single_use");
        if (sent.collect_shipping === undefined) missing.push("collect_shipping");
        if (missing.length > 0) {
          return {
            ok: false,
            status: 422,
            text: async () =>
              JSON.stringify({
                error: {
                  type: "INPUT_VALIDATION_ERROR",
                  messages: Object.fromEntries(missing.map((m) => [m, ["No está presente"]])),
                },
              }),
          };
        }
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({ data: { id: "pl-123", status: "PENDING", url: "https://checkout.wompi.co/pl-123" } }),
        };
      }) as unknown as typeof fetch,
    );

    await expect(
      createWompiCheckout({
        clinicId: "6550747c-13a0-4cfb-a88a-b1cb9bb99952",
        plan: "pro",
        redirectUrl: "https://e-irene.co/settings/plan?wompi=return",
      }),
    ).resolves.toMatchObject({ paymentLinkId: "pl-123" });
  });

  it("throws when Wompi returns an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 422,
        text: async () => JSON.stringify({ error: { reason: "Invalid amount" } }),
      })) as unknown as typeof fetch,
    );

    await expect(
      createWompiCheckout({
        clinicId: "6550747c-13a0-4cfb-a88a-b1cb9bb99952",
        plan: "pro",
        redirectUrl: "https://e-irene.co/settings/plan?wompi=return",
      }),
    ).rejects.toThrow("Wompi respondió 422");
  });
});

describe("chargeClinic", () => {
  beforeEach(() => {
    process.env.WOMPI_PRIVATE_KEY = "test_private_key";
    process.env.WOMPI_ENVIRONMENT = "sandbox";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns success when Wompi approves the charge", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ data: { id: "tx-recurring-1", status: "APPROVED" } }),
      })) as unknown as typeof fetch,
    );

    const result = await chargeClinic({
      id: "6550747c-13a0-4cfb-a88a-b1cb9bb99952",
      plan: "pro",
      currentPeriodEnd: "2026-01-01T00:00:00.000Z",
      wompiPaymentSourceId: "ps-123",
    });

    expect(result.success).toBe(true);
    expect(result.transactionId).toBe("tx-recurring-1");
    expect(result.status).toBe("APPROVED");

    const fetchCall = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.payment_source_id).toBe("ps-123");
    expect(body.amount_in_cents).toBe(2_900_000);
  });

  it("returns failure when clinic has no payment source", async () => {
    const result = await chargeClinic({
      id: "6550747c-13a0-4cfb-a88a-b1cb9bb99952",
      plan: "pro",
      currentPeriodEnd: "2026-01-01T00:00:00.000Z",
      wompiPaymentSourceId: null,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("clinic_has_no_payment_source");
  });

  it("returns failure when Wompi declines", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ data: { id: "tx-recurring-2", status: "DECLINED" } }),
      })) as unknown as typeof fetch,
    );

    const result = await chargeClinic({
      id: "6550747c-13a0-4cfb-a88a-b1cb9bb99952",
      plan: "pro",
      currentPeriodEnd: "2026-01-01T00:00:00.000Z",
      wompiPaymentSourceId: "ps-123",
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe("DECLINED");
  });

  it("PENDING no se reporta como fallo (PSE/Nequi en curso — cobrarlo de nuevo sería doble cobro)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: { id: "tx-pse-1", status: "PENDING" } }),
      })) as unknown as typeof fetch,
    );

    const result = await chargeClinic({
      id: "6550747c-13a0-4cfb-a88a-b1cb9bb99952",
      plan: "pro",
      currentPeriodEnd: "2026-01-01T00:00:00.000Z",
      wompiPaymentSourceId: "ps-123",
    });

    expect(result.pending).toBe(true);
    expect(result.success).toBe(false);
    expect(result.transactionId).toBe("tx-pse-1");
  });
});

describe("periodKeyFor (idempotencia del cobro recurrente)", () => {
  it("deriva la clave del período vigente, no de la fecha de ejecución", () => {
    // Dos corridas del cron en días distintos, sobre la misma clínica sin
    // renovar, deben producir la MISMA clave → el índice único de la BD
    // detecta el intento repetido y no se vuelve a cobrar.
    expect(periodKeyFor("2026-09-15T00:00:00.000Z")).toBe("2026-09-15");
    expect(periodKeyFor("2026-09-15T23:59:59.000Z")).toBe("2026-09-15");
  });

  it("cae a la fecha de hoy si la clínica no tiene período previo", () => {
    const key = periodKeyFor(null);
    expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

import { describe, it, expect } from "vitest";
import {
  BILLING_GRACE_DAYS,
  graceEndsAt,
  subscriptionState,
} from "@/lib/billing/subscription-state";

// La regla que decide qué ve la clínica: avisos, "Pagar ahora" y a qué fecha pasa
// a Free. El barrido de la base aplica la misma (billing-grace.test.ts).

const NOW = new Date("2026-09-10T15:00:00Z");

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    status: "activo" as const,
    currentPeriodEnd: "2026-10-10T15:00:00Z",
    cancelAtPeriodEnd: false,
    ...overrides,
  } as Parameters<typeof subscriptionState>[1];
}

describe("estado de la suscripción", () => {
  it("un plan gratuito no tiene suscripción, aunque queden restos de cobro", () => {
    expect(subscriptionState("free", subscription({ status: "vencido" }), NOW)).toEqual({
      kind: "free",
    });
  });

  it("un plan pago sin período es un plan asignado sin cobro", () => {
    expect(subscriptionState("clinica", subscription({ currentPeriodEnd: null }), NOW)).toEqual({
      kind: "unbilled",
    });
  });

  it("un plan a convenir (Enterprise) no tiene suscripción en la app, tenga o no período", () => {
    expect(subscriptionState("enterprise", subscription(), NOW)).toEqual({ kind: "negotiated" });
    expect(
      subscriptionState("enterprise", subscription({ currentPeriodEnd: null }), NOW),
    ).toEqual({ kind: "negotiated" });
  });

  it("con el período vigente y sin cobros fallidos, se renueva", () => {
    expect(subscriptionState("pro", subscription(), NOW)).toEqual({
      kind: "renewing",
      periodEnd: "2026-10-10T15:00:00Z",
    });
  });

  it("una cancelación pedida manda sobre el impago: termina al fin del período, sin gracia", () => {
    const state = subscriptionState(
      "pro",
      subscription({ cancelAtPeriodEnd: true, status: "vencido" }),
      NOW,
    );
    expect(state.kind).toBe("canceling");
  });

  it("un cobro fallido antes del vencimiento avisa sin dar por vencido lo pagado", () => {
    expect(
      subscriptionState(
        "clinica",
        subscription({ status: "vencido", currentPeriodEnd: "2026-09-12T15:00:00Z" }),
        NOW,
      ),
    ).toEqual({
      kind: "overdue",
      periodEnd: "2026-09-12T15:00:00Z",
      graceEndsAt: "2026-09-17T15:00:00.000Z",
      periodEnded: false,
    });
  });

  it("un período vencido sin renovar está en gracia aunque nunca se marcara vencido (clínica sin token)", () => {
    expect(
      subscriptionState("pro", subscription({ currentPeriodEnd: "2026-09-08T15:00:00Z" }), NOW),
    ).toEqual({
      kind: "overdue",
      periodEnd: "2026-09-08T15:00:00Z",
      graceEndsAt: "2026-09-13T15:00:00.000Z",
      periodEnded: true,
    });
  });

  it("el período se da por terminado exactamente en su fin", () => {
    const state = subscriptionState(
      "pro",
      subscription({ currentPeriodEnd: NOW.toISOString() }),
      NOW,
    );
    expect(state).toMatchObject({ kind: "overdue", periodEnded: true });
  });

  it("la gracia termina 5 días después del fin del período pagado", () => {
    expect(BILLING_GRACE_DAYS).toBe(5);
    expect(graceEndsAt("2026-09-08T15:00:00Z")).toBe("2026-09-13T15:00:00.000Z");
  });
});

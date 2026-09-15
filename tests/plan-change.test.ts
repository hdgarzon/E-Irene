import { describe, it, expect } from "vitest";
import { planChangeOption, subscriptionPaidPeriodEnd } from "@/lib/billing/plan-change";
import type { SubscriptionState } from "@/lib/billing/subscription-state";
import { billingCycleBounds } from "@/lib/dates";
import type { Plan } from "@/lib/plans";

// La regla única que decide el botón de /settings/plan y lo que aceptan las acciones.
// Lo que la base vuelve a comprobar al aplicar el pago: plan-changes.test.ts.

const ANCHOR = "2026-09-01T05:00:00Z";
const NOW = new Date("2026-09-10T12:00:00Z");
const PERIOD_END = billingCycleBounds(ANCHOR, NOW).end.toISOString();

const renewing = (scheduledPlan: Plan | null = null): SubscriptionState => ({
  kind: "renewing",
  periodEnd: PERIOD_END,
  scheduledPlan,
});
const canceling: SubscriptionState = { kind: "canceling", periodEnd: PERIOD_END };
const overdue = {
  kind: "overdue",
  periodEnd: "2026-09-08T12:00:00Z",
  graceEndsAt: "2026-09-13T12:00:00Z",
  periodEnded: true,
} as SubscriptionState;

function option(current: Plan, target: Plan, state: SubscriptionState, isAdmin = true) {
  return planChangeOption({ current, target, state, anchor: ANCHOR, isAdmin, now: NOW });
}

describe("opción para cambiar de plan", () => {
  it("el plan actual no se vuelve a comprar, salvo para salir de la mora", () => {
    expect(option("pro", "pro", renewing())).toEqual({ kind: "current" });
    expect(option("pro", "pro", overdue)).toEqual({ kind: "purchase" });
  });

  it("Enterprise se acuerda por contrato y a Free se llega cancelando", () => {
    expect(option("pro", "enterprise", renewing())).toEqual({ kind: "negotiated" });
    expect(option("pro", "free", renewing())).toEqual({ kind: "free" });
  });

  it("sin período pagado vigente se compra el plan completo", () => {
    expect(option("free", "pro", { kind: "free" })).toEqual({ kind: "purchase" });
    expect(option("esencial", "pro", overdue)).toEqual({ kind: "purchase" });
    expect(option("esencial", "pro", { kind: "unbilled" })).toEqual({ kind: "purchase" });
  });

  it("con período vigente, el admin sube pagando la diferencia", () => {
    const result = option("esencial", "pro", renewing());
    expect(result.kind).toBe("upgrade");
    if (result.kind !== "upgrade") return;
    expect(result.quote.periodEnd).toBe(PERIOD_END);
    expect(result.quote.amountInCents).toBeGreaterThan(0);
    expect(result.replacesScheduledPlan).toBeNull();
  });

  it("subir con un downgrade programado lo avisa: pagar lo anula", () => {
    const result = option("pro", "clinica", renewing("esencial"));
    expect(result).toMatchObject({ kind: "upgrade", replacesScheduledPlan: "esencial" });
  });

  it("con período vigente, el admin programa el downgrade para la renovación", () => {
    expect(option("clinica", "pro", renewing())).toEqual({
      kind: "downgrade",
      effectiveAt: PERIOD_END,
      scheduled: false,
    });
  });

  it("SEGURIDAD: un profesional no cambia con un período vigente lo que decidió el admin", () => {
    expect(option("esencial", "pro", renewing(), false)).toEqual({ kind: "blocked", reason: "admin_only" });
    expect(option("clinica", "pro", renewing(), false)).toEqual({ kind: "blocked", reason: "admin_only" });
    // Lo ya programado sí se le muestra.
    expect(option("clinica", "pro", renewing("pro"), false)).toEqual({
      kind: "downgrade",
      effectiveAt: PERIOD_END,
      scheduled: true,
    });
  });

  it("con una cancelación pedida no se ofrece subir ni bajar: primero se reactiva", () => {
    // Pagar un upgrade reactivaría la renovación sin decirlo.
    expect(option("esencial", "pro", canceling)).toEqual({ kind: "blocked", reason: "canceling" });
    expect(option("clinica", "pro", canceling)).toEqual({ kind: "blocked", reason: "canceling" });
  });

  it("no cotiza si el período no coincide con un ciclo del ancla", () => {
    const offCycle: SubscriptionState = {
      kind: "renewing",
      periodEnd: new Date(new Date(PERIOD_END).getTime() + 3 * 3600_000).toISOString(),
      scheduledPlan: null,
    };
    expect(option("esencial", "pro", offCycle)).toEqual({ kind: "blocked", reason: "no_quote" });
  });

  it("el período pagado vigente es el de una suscripción renovándose o cancelada con plazo", () => {
    expect(subscriptionPaidPeriodEnd(renewing())).toBe(PERIOD_END);
    expect(subscriptionPaidPeriodEnd(canceling)).toBe(PERIOD_END);
    expect(subscriptionPaidPeriodEnd(overdue)).toBeNull();
    expect(subscriptionPaidPeriodEnd({ kind: "free" })).toBeNull();
  });
});

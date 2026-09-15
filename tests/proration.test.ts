import { describe, it, expect } from "vitest";
import {
  MIN_UPGRADE_CHARGE_IN_CENTS,
  isPaidPlanDowngrade,
  isPaidPlanUpgrade,
  quotePlanUpgrade,
} from "@/lib/billing/proration";
import { billingCycleBounds } from "@/lib/dates";
import { PLANS } from "@/lib/plans";

// Subir de plan a mitad de ciclo cobra la diferencia por lo que queda y no mueve
// la fecha de renovación (migración 0056). Lo que se cobra sale de aquí; la base
// solo acepta el monto cotizado (plan-changes.test.ts).

// Ancla a medianoche de Bogotá del 1 de septiembre: el ciclo dura 30 días.
const ANCHOR = "2026-09-01T05:00:00Z";
const CYCLE = billingCycleBounds(ANCHOR, new Date("2026-09-10T12:00:00Z"));
const PERIOD_END = CYCLE.end.toISOString();
const DIFF = PLANS.pro.priceInCents! - PLANS.esencial.priceInCents!;

function quoteAt(now: Date, overrides: Partial<Parameters<typeof quotePlanUpgrade>[0]> = {}) {
  return quotePlanUpgrade({
    fromPlan: "esencial",
    toPlan: "pro",
    anchor: ANCHOR,
    periodEnd: PERIOD_END,
    now,
    ...overrides,
  });
}

describe("qué cuenta como subir o bajar de plan", () => {
  it("solo entre planes pagos", () => {
    expect(isPaidPlanUpgrade("esencial", "pro")).toBe(true);
    expect(isPaidPlanUpgrade("pro", "clinica")).toBe(true);
    expect(isPaidPlanUpgrade("pro", "esencial")).toBe(false);
    // Desde Free es una compra; hacia Enterprise, un contrato.
    expect(isPaidPlanUpgrade("free", "pro")).toBe(false);
    expect(isPaidPlanUpgrade("clinica", "enterprise")).toBe(false);

    expect(isPaidPlanDowngrade("clinica", "esencial")).toBe(true);
    expect(isPaidPlanDowngrade("esencial", "pro")).toBe(false);
    // Bajar a Free es cancelar.
    expect(isPaidPlanDowngrade("pro", "free")).toBe(false);
  });
});

describe("cotización de un upgrade", () => {
  it("al empezar el ciclo cobra la diferencia completa", () => {
    const quote = quoteAt(CYCLE.start);
    expect(quote).toEqual({
      fromPlan: "esencial",
      toPlan: "pro",
      amountInCents: DIFF,
      cycleStart: CYCLE.start.toISOString(),
      periodEnd: PERIOD_END,
      nextRenewalInCents: PLANS.pro.priceInCents,
    });
  });

  it("a mitad del ciclo cobra la mitad, redondeada hacia arriba a pesos enteros", () => {
    const middle = new Date((CYCLE.start.getTime() + CYCLE.end.getTime()) / 2);
    const quote = quoteAt(middle)!;
    expect(quote.amountInCents).toBe(Math.max(MIN_UPGRADE_CHARGE_IN_CENTS, Math.ceil(DIFF / 200) * 100));
    expect(quote.amountInCents % 100).toBe(0);
  });

  it("nunca cobra por debajo del mínimo, aunque quede un minuto de ciclo", () => {
    const quote = quoteAt(new Date(CYCLE.end.getTime() - 60_000))!;
    expect(quote.amountInCents).toBe(MIN_UPGRADE_CHARGE_IN_CENTS);
  });

  it("no mueve la renovación: cotiza hasta el mismo fin de período", () => {
    const quote = quoteAt(new Date("2026-09-20T00:00:00Z"))!;
    expect(quote.periodEnd).toBe(PERIOD_END);
  });

  it("un ciclo corto (febrero) prorratea sobre su propia duración", () => {
    const anchor = "2026-01-31T15:00:00Z";
    const cycle = billingCycleBounds(anchor, new Date("2026-03-01T00:00:00Z"));
    const quote = quotePlanUpgrade({
      fromPlan: "pro",
      toPlan: "clinica",
      anchor,
      periodEnd: cycle.end.toISOString(),
      now: cycle.start,
    })!;
    expect(quote.amountInCents).toBe(PLANS.clinica.priceInCents! - PLANS.pro.priceInCents!);
  });

  it("no cotiza lo que no es un upgrade entre planes pagos", () => {
    const now = new Date("2026-09-10T12:00:00Z");
    expect(quoteAt(now, { fromPlan: "pro", toPlan: "esencial" })).toBeNull();
    expect(quoteAt(now, { fromPlan: "free", toPlan: "pro" })).toBeNull();
    expect(quoteAt(now, { fromPlan: "clinica", toPlan: "enterprise" })).toBeNull();
  });

  it("no cotiza un período que ya terminó", () => {
    expect(quoteAt(CYCLE.end)).toBeNull();
    expect(quoteAt(new Date(CYCLE.end.getTime() + 1000))).toBeNull();
  });

  it("no cotiza a ciegas si el período no termina en un borde de ciclo del ancla", () => {
    const now = new Date("2026-09-10T12:00:00Z");
    const offCycle = new Date(CYCLE.end.getTime() + 3 * 60 * 60 * 1000).toISOString();
    expect(quoteAt(now, { periodEnd: offCycle })).toBeNull();
  });
});

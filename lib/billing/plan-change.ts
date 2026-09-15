import { PLANS, type Plan } from "@/lib/plans";
import type { SubscriptionState } from "@/lib/billing/subscription-state";
import {
  isPaidPlanDowngrade,
  isPaidPlanUpgrade,
  quotePlanUpgrade,
  type UpgradeQuote,
} from "@/lib/billing/proration";

/**
 * Qué se puede hacer para pasar del plan actual a otro. Una sola regla para el botón
 * de /settings/plan y para las acciones que crean el link o programan el cambio: si
 * divergen, la pantalla ofrece algo que la acción rechaza, o al revés.
 */

export type PlanChangeBlock =
  /**
   * Con un período pagado vigente, subir o bajar cambia lo que decidió el admin (y
   * pagar un upgrade anula su downgrade programado): solo el admin.
   */
  | "admin_only"
  /** Con una cancelación pedida no se cambia de plan: primero se reactiva la suscripción. */
  | "canceling"
  /** El período no coincide con un ciclo del ancla: no se cotiza a ciegas. */
  | "no_quote";

export type PlanChangeOption =
  | { kind: "current" }
  /** A convenir (Enterprise): se acuerda por contrato. */
  | { kind: "negotiated" }
  /** Free: se llega cancelando la suscripción. */
  | { kind: "free" }
  /** Compra por el precio completo, que abre un ciclo nuevo: no hay período pagado vigente. */
  | { kind: "purchase" }
  /** Diferencia prorrateada; pagarla anula `replacesScheduledPlan`, si hay uno. */
  | { kind: "upgrade"; quote: UpgradeQuote; replacesScheduledPlan: Plan | null }
  /** Se programa para la renovación, sin cobro hoy. */
  | { kind: "downgrade"; effectiveAt: string; scheduled: boolean }
  | { kind: "blocked"; reason: PlanChangeBlock };

/** Fin del período pagado vigente, o null si no hay uno (Free, sin cobro o en mora). */
export function subscriptionPaidPeriodEnd(state: SubscriptionState): string | null {
  return state.kind === "renewing" || state.kind === "canceling" ? state.periodEnd : null;
}

export function planChangeOption(input: {
  current: Plan;
  target: Plan;
  state: SubscriptionState;
  anchor: string;
  isAdmin: boolean;
  now?: Date;
}): PlanChangeOption {
  const { current, target, state } = input;

  // Volver a pagar el plan actual solo tiene sentido si su renovación no se pudo
  // cobrar: es la salida de la gracia (lib/billing/subscription-state.ts).
  if (target === current) return state.kind === "overdue" ? { kind: "purchase" } : { kind: "current" };

  const price = PLANS[target].priceInCents;
  if (price === null) return { kind: "negotiated" };
  if (price <= 0) return { kind: "free" };

  const periodEnd = subscriptionPaidPeriodEnd(state);
  const upgrade = isPaidPlanUpgrade(current, target);
  const downgrade = isPaidPlanDowngrade(current, target);
  if (!periodEnd || (!upgrade && !downgrade)) return { kind: "purchase" };

  // Lo ya programado se muestra a cualquiera, aunque solo el admin lo pueda cambiar.
  if (downgrade && state.kind === "renewing" && state.scheduledPlan === target) {
    return { kind: "downgrade", effectiveAt: periodEnd, scheduled: true };
  }
  if (state.kind === "canceling") return { kind: "blocked", reason: "canceling" };
  if (!input.isAdmin) return { kind: "blocked", reason: "admin_only" };

  if (downgrade) return { kind: "downgrade", effectiveAt: periodEnd, scheduled: false };

  const quote = quotePlanUpgrade({
    fromPlan: current,
    toPlan: target,
    anchor: input.anchor,
    periodEnd,
    now: input.now,
  });
  if (!quote) return { kind: "blocked", reason: "no_quote" };
  return {
    kind: "upgrade",
    quote,
    replacesScheduledPlan: state.kind === "renewing" ? state.scheduledPlan : null,
  };
}

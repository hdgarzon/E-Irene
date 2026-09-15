import { PLANS, type Plan } from "@/lib/plans";
import type { ClinicSubscription } from "@/lib/db/clinic";

/**
 * Días que una suscripción vencida conserva el plan antes de pasar a Free.
 * Tiene que coincidir con billing_grace_period() (migración 0041), que es la que
 * aplica el barrido: tests/billing-grace.test.ts compara las dos.
 */
export const BILLING_GRACE_DAYS = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Hasta cuándo conserva el plan una suscripción cuyo período terminó en `periodEnd`. */
export function graceEndsAt(periodEnd: string): string {
  return new Date(new Date(periodEnd).getTime() + BILLING_GRACE_DAYS * DAY_MS).toISOString();
}

export type SubscriptionState =
  /** Plan gratuito: no hay suscripción. */
  | { kind: "free" }
  /**
   * Plan a convenir (Enterprise): se asigna desde la consola con un contrato. No
   * se compra ni se renueva por la app, así que tampoco hay nada que cancelar ni
   * pagar desde ella.
   */
  | { kind: "negotiated" }
  /** Plan pago sin período: asignado desde la consola, sin cobro. */
  | { kind: "unbilled" }
  /** Período pagado vigente que se va a renovar. */
  | { kind: "renewing"; periodEnd: string }
  /** Cancelación pedida: conserva el plan hasta periodEnd, sin gracia. */
  | { kind: "canceling"; periodEnd: string }
  /**
   * La renovación no se ha podido cobrar: conserva el plan hasta graceEndsAt y
   * después pasa a Free. `periodEnded` separa el aviso previo (el cobro falló
   * pero lo pagado aún no vence) de la gracia propiamente dicha.
   */
  | { kind: "overdue"; periodEnd: string; graceEndsAt: string; periodEnded: boolean };

/**
 * Estado de la suscripción tal como lo ve la clínica. Es la regla única para
 * la interfaz y las acciones, y la misma que aplica el barrido de la base
 * (end_overdue_subscriptions, migración 0042): una suscripción sin cancelar
 * cuyo período terminó sin renovarse está en gracia, sea cual sea la causa
 * (tarjeta rechazada, error de Wompi o clínica sin token de cobro).
 */
export function subscriptionState(
  plan: Plan,
  subscription: ClinicSubscription,
  now: Date = new Date(),
): SubscriptionState {
  const { priceInCents } = PLANS[plan];
  if (priceInCents === null) return { kind: "negotiated" };
  if (priceInCents <= 0) return { kind: "free" };

  const { status, currentPeriodEnd, cancelAtPeriodEnd } = subscription;
  if (!currentPeriodEnd) return { kind: "unbilled" };
  if (cancelAtPeriodEnd) return { kind: "canceling", periodEnd: currentPeriodEnd };

  const periodEnded = new Date(currentPeriodEnd).getTime() <= now.getTime();
  if (status === "vencido" || periodEnded) {
    return {
      kind: "overdue",
      periodEnd: currentPeriodEnd,
      graceEndsAt: graceEndsAt(currentPeriodEnd),
      periodEnded,
    };
  }
  return { kind: "renewing", periodEnd: currentPeriodEnd };
}

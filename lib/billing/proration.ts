import { PLAN_ORDER, PLANS, isPaidPlan, type Plan } from "@/lib/plans";
import { billingCycleBounds } from "@/lib/dates";

/**
 * Cambios de plan a mitad de ciclo (migración 0056).
 *
 * Subir de plan cobra solo la diferencia por lo que queda del ciclo y no mueve
 * la fecha de renovación. Bajar de plan no se paga: se programa y rige desde la
 * renovación, que cobra el precio del plan menor.
 */

/**
 * Cobro mínimo de una diferencia prorrateada, en centavos. Wompi no documenta el
 * mínimo por transacción en COP: este valor se confirma en sandbox antes de
 * producción. Una diferencia menor (upgrade en las últimas horas del ciclo) se
 * cobra al mínimo.
 */
export const MIN_UPGRADE_CHARGE_IN_CENTS = 150_000;

/** Subir entre planes pagos (Esencial → Profesional → Clínica). */
export function isPaidPlanUpgrade(from: Plan, to: Plan): boolean {
  return isPaidPlan(from) && isPaidPlan(to) && PLAN_ORDER.indexOf(to) > PLAN_ORDER.indexOf(from);
}

/** Bajar entre planes pagos. Bajar a Free no es un downgrade: es cancelar. */
export function isPaidPlanDowngrade(from: Plan, to: Plan): boolean {
  return isPaidPlan(from) && isPaidPlan(to) && PLAN_ORDER.indexOf(to) < PLAN_ORDER.indexOf(from);
}

export interface UpgradeQuote {
  fromPlan: Plan;
  toPlan: Plan;
  /** Lo que se cobra hoy, en centavos de COP, en pesos enteros. */
  amountInCents: number;
  /** Ciclo pagado que se prorratea: [cycleStart, periodEnd). */
  cycleStart: string;
  periodEnd: string;
  /** Precio completo del plan destino, el que cobrará la próxima renovación. */
  nextRenewalInCents: number;
}

/**
 * Cotiza un upgrade:
 *
 *   (precio destino − precio actual) × tiempo restante / duración del ciclo
 *
 * redondeado hacia arriba a pesos enteros y nunca por debajo del mínimo.
 *
 * El ciclo es el que termina en `periodEnd`, contado desde el ancla igual que la
 * cuota (billingCycleBounds). Devuelve null si no hay nada que prorratear: no es
 * un upgrade entre planes pagos, el período ya terminó, o el período no coincide
 * con un borde de ciclo del ancla (estado inconsistente: no se cotiza a ciegas).
 */
export function quotePlanUpgrade(input: {
  fromPlan: Plan;
  toPlan: Plan;
  anchor: string;
  periodEnd: string;
  now?: Date;
}): UpgradeQuote | null {
  const { fromPlan, toPlan } = input;
  if (!isPaidPlanUpgrade(fromPlan, toPlan)) return null;

  const fromPrice = PLANS[fromPlan].priceInCents;
  const toPrice = PLANS[toPlan].priceInCents;
  if (fromPrice === null || toPrice === null) return null;

  const now = (input.now ?? new Date()).getTime();
  const periodEndMs = new Date(input.periodEnd).getTime();
  if (!Number.isFinite(periodEndMs) || periodEndMs <= now) return null;

  // El ciclo que contiene el instante previo al fin del período es el que termina ahí.
  const cycle = billingCycleBounds(input.anchor, new Date(periodEndMs - 1));
  if (cycle.end.getTime() !== periodEndMs) return null;

  const cycleMs = periodEndMs - cycle.start.getTime();
  const remainingMs = Math.min(periodEndMs - now, cycleMs);
  const raw = ((toPrice - fromPrice) * remainingMs) / cycleMs;
  const amountInCents = Math.max(MIN_UPGRADE_CHARGE_IN_CENTS, Math.ceil(raw / 100) * 100);

  return {
    fromPlan,
    toPlan,
    amountInCents,
    cycleStart: cycle.start.toISOString(),
    periodEnd: new Date(periodEndMs).toISOString(),
    nextRenewalInCents: toPrice,
  };
}

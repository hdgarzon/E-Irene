import { PAID_PLANS, type Plan } from "@/lib/plans";

/**
 * Cuándo se vende una bolsa de transcripción (migración 0057). La misma regla
 * decide si la pantalla ofrece la compra y si la acción crea el link de pago.
 */

/**
 * No se venden horas que vencerían casi de inmediato: con menos de esto para el fin
 * del ciclo, la compra espera al ciclo siguiente.
 */
export const PACK_MIN_REMAINING_MS = 24 * 60 * 60 * 1000;

export type PackAvailability =
  /** Se puede comprar ya. */
  | "available"
  /** Plan y período en regla, pero el ciclo termina en menos de 24 horas. */
  | "cycle_ending"
  /** Free, Enterprise o sin período pagado vigente. */
  | "not_eligible";

export function transcriptionPackAvailability(input: {
  plan: Plan;
  /** Período pagado vigente: renovándose o cancelado con plazo por delante. */
  hasPaidPeriod: boolean;
  /** Fin del ciclo vigente, cuando vencen las horas compradas hoy. */
  cycleEnd: string;
  now?: Date;
}): PackAvailability {
  if (!input.hasPaidPeriod || !PAID_PLANS.includes(input.plan)) return "not_eligible";
  const remainingMs = new Date(input.cycleEnd).getTime() - (input.now ?? new Date()).getTime();
  return remainingMs >= PACK_MIN_REMAINING_MS ? "available" : "cycle_ending";
}

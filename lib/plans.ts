export type Plan = "free" | "esencial" | "pro" | "clinica" | "enterprise";

export interface PlanLimits {
  label: string;
  /** Precio visible ("$59.000 COP/mes"). Se deriva de priceInCents: nunca se escribe a mano. */
  price: string;
  /**
   * Precio mensual en centavos de peso colombiano, tal como lo cobra Wompi
   * (COP 59.000 = 5_900_000). 0 = gratis. null = a convenir: el plan no se vende
   * ni se renueva por la app; lo asigna la consola con un contrato de por medio.
   */
  priceInCents: number | null;
  maxDoctors: number;
  maxPatients: number;
  transcriptionHours: number;
  consultationsPerMonth: number;
  ai: boolean;
  whatsapp: boolean;
}

/** Centavos de COP → "$59.000". */
export function formatCop(priceInCents: number): string {
  const pesos = Math.round(priceInCents / 100);
  return `$${String(pesos).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}

/** Precio visible de un plan: "$59.000 COP/mes", o "A convenir" si no tiene precio fijo. */
export function priceLabel(priceInCents: number | null): string {
  return priceInCents === null ? "A convenir" : `${formatCop(priceInCents)} COP/mes`;
}

// El precio visible sale del mismo valor que se cobra. Antes eran dos campos
// escritos a mano y nada impedía que la pantalla mostrara una cifra y Wompi
// cobrara otra.
function definePlan(plan: Omit<PlanLimits, "price">): PlanLimits {
  return { ...plan, price: priceLabel(plan.priceInCents) };
}

// Escala vigente desde 2026-09, en pesos colombianos. Los códigos internos son
// los del enum clinic_plan: `pro` es Profesional, `clinica` es Clínica y
// `esencial` se agregó en la migración 0053. En los planes pagos la bolsa de
// horas es consultas × 1 h, de modo que "20 consultas de hasta una hora" es a
// la vez la promesa comercial y el límite que se aplica.
export const PLANS: Record<Plan, PlanLimits> = {
  free: definePlan({
    label: "Free",
    priceInCents: 0,
    maxDoctors: 1,
    maxPatients: 5,
    transcriptionHours: 2,
    consultationsPerMonth: 5,
    ai: false,
    whatsapp: false,
  }),
  esencial: definePlan({
    label: "Esencial",
    priceInCents: 5_900_000,
    maxDoctors: 1,
    maxPatients: Infinity,
    transcriptionHours: 20,
    consultationsPerMonth: 20,
    ai: true,
    whatsapp: false,
  }),
  pro: definePlan({
    label: "Profesional",
    priceInCents: 9_900_000,
    maxDoctors: 1,
    maxPatients: Infinity,
    transcriptionHours: 30,
    consultationsPerMonth: 30,
    ai: true,
    whatsapp: false,
  }),
  clinica: definePlan({
    label: "Clínica",
    priceInCents: 24_900_000,
    maxDoctors: 5,
    maxPatients: Infinity,
    transcriptionHours: 75,
    consultationsPerMonth: 75,
    ai: true,
    whatsapp: true,
  }),
  // Sin topes en la app: los fija el contrato con el que se asigna.
  enterprise: definePlan({
    label: "Enterprise",
    priceInCents: null,
    maxDoctors: Infinity,
    maxPatients: Infinity,
    transcriptionHours: Infinity,
    consultationsPerMonth: Infinity,
    ai: true,
    whatsapp: true,
  }),
};

export const PLAN_ORDER: Plan[] = ["free", "esencial", "pro", "clinica", "enterprise"];

/** Planes con precio fijo: los únicos que se compran y se renuevan por Wompi. */
export const PAID_PLANS: Plan[] = PLAN_ORDER.filter((plan) => {
  const cents = PLANS[plan].priceInCents;
  return cents !== null && cents > 0;
});

export function planLimits(plan: Plan): PlanLimits {
  return PLANS[plan];
}

export function canAddPatient(plan: Plan, currentCount: number): boolean {
  return currentCount < PLANS[plan].maxPatients;
}

export function canAddDoctor(plan: Plan, currentCount: number): boolean {
  return currentCount < PLANS[plan].maxDoctors;
}

/** El límite de consultas se aplica por ciclo de facturación (ver billingCycleBounds). */
export function canStartConsultation(plan: Plan, consultationsThisCycle: number): boolean {
  return consultationsThisCycle < PLANS[plan].consultationsPerMonth;
}

/** "5" o "Ilimitado" para mostrar límites. */
export function limitLabel(n: number): string {
  return Number.isFinite(n) ? String(n) : "Ilimitado";
}

/**
 * Cuota de transcripción por ciclo, en segundos; null = ilimitado (enterprise).
 * Es el valor que se pasa a begin_transcription_session (ver migración 0039):
 * el límite de cumplimiento vive aquí, no en la base de datos (criterio de la
 * migración 0014).
 */
export function transcriptionLimitSeconds(plan: Plan): number | null {
  const hours = PLANS[plan].transcriptionHours;
  return Number.isFinite(hours) ? hours * 3600 : null;
}

/** Segundos de transcripción → horas legibles: "0", "1,5", "20". */
export function transcriptionHoursLabel(seconds: number): string {
  return new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 }).format(seconds / 3600);
}

/** Contador de consumo del ciclo: "1,5 h / 2 h" o "3,2 h / Ilimitado". */
export function transcriptionUsageLabel(usedSeconds: number, plan: Plan): string {
  const used = transcriptionHoursLabel(usedSeconds);
  const max = PLANS[plan].transcriptionHours;
  return Number.isFinite(max) ? `${used} h / ${max} h` : `${used} h / Ilimitado`;
}

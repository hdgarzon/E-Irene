export type Plan = "free" | "pro" | "clinica" | "enterprise";

export interface PlanLimits {
  label: string;
  price: string;
  /** Precio mensual en centavos para Wompi (COP). 0 = gratis. */
  priceInCents: number;
  maxDoctors: number;
  maxPatients: number;
  transcriptionHours: number;
  consultationsPerMonth: number;
  ai: boolean;
  whatsapp: boolean;
}

// Nombres y precios vigentes desde 2026-07 (ver
// docs/E-Irene_Resumen_Ejecutivo_Integral). Los códigos internos
// (free/pro/clinica/enterprise) no cambian a propósito — son los que ya
// tienen 12 clínicas reales asignadas en producción; solo cambia lo que se
// muestra. maxDoctors/maxPatients/transcriptionHours/ai/whatsapp quedan
// igual que antes de este cambio de precios.
export const PLANS: Record<Plan, PlanLimits> = {
  free: {
    label: "Free",
    price: "$0/mes",
    priceInCents: 0,
    maxDoctors: 1,
    maxPatients: 5,
    transcriptionHours: 2,
    consultationsPerMonth: 5,
    ai: false,
    whatsapp: false,
  },
  pro: {
    label: "Professional",
    price: "$29/mes",
    priceInCents: 2_900_000,
    maxDoctors: 1,
    maxPatients: Infinity,
    transcriptionHours: 20,
    consultationsPerMonth: 20,
    ai: true,
    whatsapp: false,
  },
  clinica: {
    label: "Plus",
    price: "$59/mes",
    priceInCents: 5_900_000,
    maxDoctors: 5,
    maxPatients: Infinity,
    transcriptionHours: 100,
    consultationsPerMonth: 50,
    ai: true,
    whatsapp: true,
  },
  enterprise: {
    label: "Clinic",
    price: "$149/mes",
    priceInCents: 14_900_000,
    maxDoctors: Infinity,
    maxPatients: Infinity,
    transcriptionHours: Infinity,
    consultationsPerMonth: 120,
    ai: true,
    whatsapp: true,
  },
};

export const PLAN_ORDER: Plan[] = ["free", "pro", "clinica", "enterprise"];

export function planLimits(plan: Plan): PlanLimits {
  return PLANS[plan];
}

export function canAddPatient(plan: Plan, currentCount: number): boolean {
  return currentCount < PLANS[plan].maxPatients;
}

export function canAddDoctor(plan: Plan, currentCount: number): boolean {
  return currentCount < PLANS[plan].maxDoctors;
}

export function canStartConsultation(plan: Plan, consultationsThisMonth: number): boolean {
  return consultationsThisMonth < PLANS[plan].consultationsPerMonth;
}

/** "5" o "Ilimitado" para mostrar límites. */
export function limitLabel(n: number): string {
  return Number.isFinite(n) ? String(n) : "Ilimitado";
}

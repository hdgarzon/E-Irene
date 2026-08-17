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

/**
 * Cuota mensual de transcripción en segundos; null = ilimitado (enterprise).
 * Es el valor que se pasa a begin_transcription_session (ver migración 0038):
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

/** Contador de consumo mensual: "1,5 h / 2 h" o "3,2 h / Ilimitado". */
export function transcriptionUsageLabel(usedSeconds: number, plan: Plan): string {
  const used = transcriptionHoursLabel(usedSeconds);
  const max = PLANS[plan].transcriptionHours;
  return Number.isFinite(max) ? `${used} h / ${max} h` : `${used} h / Ilimitado`;
}

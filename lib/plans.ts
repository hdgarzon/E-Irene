export type Plan = "free" | "pro" | "clinica" | "enterprise";

export interface PlanLimits {
  label: string;
  price: string;
  maxDoctors: number;
  maxPatients: number;
  transcriptionHours: number;
  ai: boolean;
  whatsapp: boolean;
}

export const PLANS: Record<Plan, PlanLimits> = {
  free: {
    label: "Free",
    price: "$0/mes",
    maxDoctors: 1,
    maxPatients: 5,
    transcriptionHours: 2,
    ai: false,
    whatsapp: false,
  },
  pro: {
    label: "Pro",
    price: "$49/mes",
    maxDoctors: 1,
    maxPatients: Infinity,
    transcriptionHours: 20,
    ai: true,
    whatsapp: false,
  },
  clinica: {
    label: "Clínica",
    price: "$149/mes",
    maxDoctors: 5,
    maxPatients: Infinity,
    transcriptionHours: 100,
    ai: true,
    whatsapp: true,
  },
  enterprise: {
    label: "Enterprise",
    price: "Personalizado",
    maxDoctors: Infinity,
    maxPatients: Infinity,
    transcriptionHours: Infinity,
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

/** "5" o "Ilimitado" para mostrar límites. */
export function limitLabel(n: number): string {
  return Number.isFinite(n) ? String(n) : "Ilimitado";
}

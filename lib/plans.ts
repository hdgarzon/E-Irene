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
  /**
   * Videollamadas (migración 0058): "none" no las tiene; "addon" las compra por packs y
   * cada consulta por video descuenta una si el paciente se conecta; "included" las
   * tiene sin descuento.
   */
  video: "none" | "addon" | "included";
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
    video: "none",
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
    video: "addon",
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
    video: "addon",
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
    video: "addon",
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
    video: "included",
  }),
};

export const PLAN_ORDER: Plan[] = ["free", "esencial", "pro", "clinica", "enterprise"];

/** Planes con precio fijo: los únicos que se compran y se renuevan por Wompi. */
export const PAID_PLANS: Plan[] = PLAN_ORDER.filter((plan) => {
  const cents = PLANS[plan].priceInCents;
  return cents !== null && cents > 0;
});

/** true si el plan se compra y se renueva por Wompi: Esencial, Profesional o Clínica. */
export function isPaidPlan(plan: Plan): boolean {
  return PAID_PLANS.includes(plan);
}

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

/**
 * Bolsa de transcripción (migración 0057): horas que se suman al límite del plan
 * hasta el fin del ciclo en que se compran. El precio se cobra de aquí; las horas
 * que se otorgan salen de transcription_pack_seconds() en la base, y
 * tests/transcription-packs.test.ts exige que coincidan.
 */
export const TRANSCRIPTION_PACK = { hours: 5, priceInCents: 2_500_000 } as const;

/**
 * Precio de una videollamada adicional (migración 0058). Espejo de
 * video_call_price_cents() en la base, que valida el monto de cada pack.
 */
export const VIDEO_CALL_PRICE_IN_CENTS = 900_000;

/** Packs de videollamadas que se venden. No vencen. */
export const VIDEO_PACK_SIZES = [1, 5, 10] as const;
export type VideoPackSize = (typeof VIDEO_PACK_SIZES)[number];

export function isVideoPackSize(quantity: number): quantity is VideoPackSize {
  return (VIDEO_PACK_SIZES as readonly number[]).includes(quantity);
}

export function videoPackPriceInCents(quantity: VideoPackSize): number {
  return quantity * VIDEO_CALL_PRICE_IN_CENTS;
}

/**
 * Límite de transcripción del ciclo con las bolsas vigentes, en segundos; null =
 * ilimitado. Es el límite que se muestra: el que se aplica lo resuelve
 * begin_transcription_session con las mismas bolsas.
 */
export function effectiveTranscriptionLimitSeconds(plan: Plan, extraSeconds = 0): number | null {
  const base = transcriptionLimitSeconds(plan);
  return base === null ? null : base + extraSeconds;
}

/** Límite en horas para la barra de consumo, bolsas incluidas; Infinity = ilimitado. */
export function transcriptionLimitHours(plan: Plan, extraSeconds = 0): number {
  const limit = effectiveTranscriptionLimitSeconds(plan, extraSeconds);
  return limit === null ? Infinity : limit / 3600;
}

/** Contador de consumo del ciclo: "1,5 h / 2 h", "3 h / 25 h" con bolsa, o "3,2 h / Ilimitado". */
export function transcriptionUsageLabel(usedSeconds: number, plan: Plan, extraSeconds = 0): string {
  const used = transcriptionHoursLabel(usedSeconds);
  const limit = effectiveTranscriptionLimitSeconds(plan, extraSeconds);
  return limit === null ? `${used} h / Ilimitado` : `${used} h / ${transcriptionHoursLabel(limit)} h`;
}

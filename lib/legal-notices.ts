import { addBusinessDaysColombia } from "@/lib/dates";

/**
 * Antelación mínima de un aviso de cambios legales: quince (15) días hábiles
 * (Política de Tratamiento, sección 10; Términos de Vinculación, cláusula
 * décima).
 */
export const LEGAL_NOTICE_MIN_BUSINESS_DAYS = 15;

/**
 * Primer día en que puede entrar en vigor un cambio avisado hoy (YYYY-MM-DD,
 * Bogotá): el siguiente al decimoquinto día hábil, para que corran completos.
 */
export function earliestEffectiveDate(now: Date = new Date()): string {
  const fifteenth = addBusinessDaysColombia(now, LEGAL_NOTICE_MIN_BUSINESS_DAYS);
  const [y, m, d] = fifteenth.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** true si la fecha de vigencia (YYYY-MM-DD) respeta la antelación mínima. */
export function hasEnoughNotice(effectiveDate: string, now: Date = new Date()): boolean {
  return effectiveDate >= earliestEffectiveDate(now);
}

/** Medianoche de Bogotá del día de vigencia, como instante. */
export function effectiveAtFromDate(effectiveDate: string): string {
  return new Date(`${effectiveDate}T00:00:00-05:00`).toISOString();
}


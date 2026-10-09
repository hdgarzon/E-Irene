import { createHash } from "node:crypto";
import { CONSENTIMIENTO_PACIENTE, serializeDocument } from "@/lib/legal-documents";
import { dayKey } from "@/lib/dates";

/**
 * Edad en años a partir de la fecha de nacimiento (ISO yyyy-mm-dd), cumplida en
 * el día de hoy de Bogotá.
 *
 * Se compara como fecha de calendario, sin pasar por Date: `new Date("2012-10-11")`
 * es la medianoche UTC, que en Bogotá (UTC-5) cae el 10 a las 19:00, y con los
 * getters locales el cumpleaños se contaba un día antes. Con el umbral de 14
 * años, eso dejaba firmar solo a un paciente que aún tenía 13.
 */
export function calculateAge(birthDate: string, today: string = dayKey(new Date())): number {
  const [by, bm, bd] = birthDate.slice(0, 10).split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age--;
  return age;
}

/**
 * Edad desde la cual el paciente autoriza por sí mismo (Resolución 309 de 2025,
 * autonomía progresiva; cláusula octava del consentimiento). Por debajo, firma
 * el representante legal y el profesional registra el asentimiento del menor.
 */
export const SELF_CONSENT_MIN_AGE = 14;

/**
 * true si por la edad debe firmar el representante legal; false si el paciente
 * puede firmar por sí mismo; null si no hay fecha de nacimiento. Aun con false,
 * el profesional puede pedir consentimiento sustituto (p. ej. discapacidad).
 */
export function requiresRepresentativeByBirthDate(
  birthDate: string | null | undefined,
): boolean | null {
  if (!birthDate) return null;
  return calculateAge(birthDate) < SELF_CONSENT_MIN_AGE;
}

/** Versión del documento de consentimiento. Cambiar al modificar el texto. */
export const CONSENT_VERSION = "2026-10-v1";

/**
 * Texto del consentimiento informado (documento 05). Se deriva del mismo
 * documento que se muestra en pantalla, para que el hash guardado con la firma
 * corresponda exactamente a lo que el paciente leyó.
 */
export const CONSENT_TEXT = serializeDocument(CONSENTIMIENTO_PACIENTE);

/** SHA-256 hex de un texto (prueba de integridad del documento firmado). */
export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Hash del documento vigente (se guarda junto a la firma como prueba legal). */
export const CONSENT_HASH = sha256(`${CONSENT_VERSION}\n${CONSENT_TEXT}`);

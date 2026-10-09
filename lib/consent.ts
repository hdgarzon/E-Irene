import { createHash } from "node:crypto";
import { CONSENTIMIENTO_PACIENTE, serializeDocument } from "@/lib/legal-documents";

/** Edad en años a partir de la fecha de nacimiento (ISO yyyy-mm-dd). */
export function calculateAge(birthDate: string): number {
  const birth = new Date(birthDate);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const hasHadBirthdayThisYear =
    now.getMonth() > birth.getMonth() ||
    (now.getMonth() === birth.getMonth() && now.getDate() >= birth.getDate());
  if (!hasHadBirthdayThisYear) age--;
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

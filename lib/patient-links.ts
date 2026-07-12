import { randomBytes } from "node:crypto";
import { sha256 } from "@/lib/consent";

/** Días de validez de un link único de paciente antes de expirar. */
export const PATIENT_LINK_TTL_DAYS = 7;

/** Genera un token de 256 bits (URL-safe) y su hash SHA-256. El token crudo
 * solo existe en memoria por esta llamada — nunca se persiste. */
export function generatePatientLinkToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: sha256(token) };
}

/** Fecha de expiración a partir de `from` (por defecto, ahora). */
export function patientLinkExpiryDate(from: Date = new Date()): Date {
  return new Date(from.getTime() + PATIENT_LINK_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/** URL pública absoluta que se envía al paciente por correo. */
export function buildPatientLinkUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://e-irene.co";
  return `${base}/enlace/${token}`;
}

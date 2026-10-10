import { createHash } from "node:crypto";
import {
  POLITICA_DATOS,
  TERMINOS_USO,
  VINCULACION_PROFESIONAL,
  serializeDocument,
} from "@/lib/legal-documents";
import { PROFESSIONAL_ACCEPTANCE_TEXT } from "@/lib/legal-documents/acceptance";

export { MARKETING_OPT_IN_TEXT, PROFESSIONAL_ACCEPTANCE_TEXT } from "@/lib/legal-documents/acceptance";

/**
 * Aceptación del profesional (Pieza 2 de los documentos legales).
 *
 * Mismo esquema probatorio que lib/consent.ts (el consentimiento del paciente):
 * versión + hash del texto + IP + user-agent + marca temporal. El hash es lo
 * que permite demostrar QUÉ texto se aceptó, no solo que se aceptó algo.
 *
 * La casilla remite a tres documentos —Vinculación del Profesional, Términos y
 * Condiciones de Uso y Política de Tratamiento—, así que el texto hasheado es la
 * casilla más los tres, tal como se publican (lib/legal-documents). Cambiar
 * cualquiera de ellos sin subir POLICY_VERSION haría que el hash guardado ya no
 * corresponda a lo publicado.
 *
 * Al subir POLICY_VERSION, la compuerta de /terminos compara la versión vigente
 * contra la última aceptada y vuelve a pedir aceptación a todo el mundo. Es el
 * mecanismo que exige la sección 10 de la política para cambios sustanciales.
 */
export const POLICY_VERSION = "2026-10-v1";

export const POLICY_TEXT = [
  PROFESSIONAL_ACCEPTANCE_TEXT,
  serializeDocument(VINCULACION_PROFESIONAL),
  serializeDocument(TERMINOS_USO),
  serializeDocument(POLITICA_DATOS),
].join("\n\n---\n\n");

/** SHA-256 hex de un texto (prueba de integridad del documento aceptado). */
export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Hash del documento vigente; se guarda junto a la aceptación como prueba. */
export const POLICY_HASH = sha256(`${POLICY_VERSION}\n${POLICY_TEXT}`);

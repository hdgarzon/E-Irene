import { createHash } from "node:crypto";

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
 * true/false si se conoce la fecha de nacimiento; null si no se conoce (el
 * profesional debe indicarlo manualmente en ese caso).
 */
export function isMinorByBirthDate(birthDate: string | null | undefined): boolean | null {
  if (!birthDate) return null;
  return calculateAge(birthDate) < 18;
}

/** Versión del documento de consentimiento. Cambiar al modificar el texto. */
export const CONSENT_VERSION = "2026-07-v2";

/** Texto del consentimiento informado (salud mental, Colombia). */
export const CONSENT_TEXT = `CONSENTIMIENTO INFORMADO PARA LA ATENCIÓN PSICOLÓGICA Y EL TRATAMIENTO DE DATOS

1. Naturaleza del servicio. Declaro que recibo atención psicológica profesional de carácter
voluntario y comprendo que sus resultados dependen de múltiples factores.

2. Grabación y transcripción. Autorizo que mis sesiones —presenciales o por videollamada— sean
transcritas en tiempo real para fines clínicos. El audio y el video NO se almacenan ni se
graban en ningún momento: únicamente se conserva la transcripción en texto, cifrada. Cuando la
sesión es por videollamada, la conexión se realiza a través de un proveedor externo especializado
en videoconferencia, que únicamente transmite la llamada en vivo sin guardar ninguna copia.
Puedo revocar esta autorización en cualquier momento.

3. Análisis asistido por inteligencia artificial. Entiendo que la transcripción puede analizarse
con herramientas de IA para apoyar al profesional (resumen, sentimiento, patrones). Dichas
sugerencias NO constituyen un diagnóstico y son validadas por el profesional tratante.

4. Tratamiento de datos personales (Ley 1581 de 2012). Autorizo el tratamiento de mis datos
personales y sensibles de salud con fines de atención clínica, conforme a la política de
privacidad. Mis datos se almacenan cifrados y aislados. Conozco mis derechos a conocer,
actualizar, rectificar y suprimir mis datos.

5. Historia clínica electrónica (Ley 2015 de 2020, Decreto 580 de 2024). Comprendo que la
información se incorpora a una historia clínica electrónica con plena validez legal.

6. Confidencialidad. La información está protegida por el secreto profesional, salvo las
excepciones previstas por la ley.

Manifiesto que he leído y comprendido este documento y que mis preguntas han sido resueltas.`;

/** SHA-256 hex de un texto (prueba de integridad del documento firmado). */
export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Hash del documento vigente (se guarda junto a la firma como prueba legal). */
export const CONSENT_HASH = sha256(`${CONSENT_VERSION}\n${CONSENT_TEXT}`);

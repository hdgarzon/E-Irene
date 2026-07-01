/**
 * Utilidades sobre transcripciones con formato "Hablante: texto" por línea
 * (el mismo formato que produce `buildTranscript` en lib/db/consultations.ts).
 */

/**
 * Extrae las intervenciones del "Paciente", una por línea. Si la transcripción
 * no tiene líneas etiquetadas (texto plano sin diarización), devuelve la
 * transcripción completa como única línea — así el análisis sigue
 * funcionando aunque no haya distinción de hablantes.
 */
export function extractPatientLines(transcript: string): string[] {
  const patientLines = transcript
    .split("\n")
    .map((line) => line.match(/^paciente\s*:\s*(.*)$/i)?.[1])
    .filter((text): text is string => Boolean(text && text.trim()));

  return patientLines.length > 0 ? patientLines : [transcript];
}

/**
 * Extrae solo el texto dicho por "Paciente" (una línea por intervención).
 * Si la transcripción no tiene líneas etiquetadas como paciente (p. ej. texto
 * plano sin diarización), devuelve la transcripción completa sin cambios —
 * así el análisis sigue funcionando aunque no haya distinción de hablantes.
 */
export function extractPatientText(transcript: string): string {
  return extractPatientLines(transcript).join(" ");
}

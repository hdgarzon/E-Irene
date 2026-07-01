/** Lógica de diarización (mapeo de índice de hablante de Deepgram → rol). */

export interface DiarizedWord {
  speaker?: number;
}

/** Índice de hablante con más palabras en la intervención (diarización por palabra). */
export function majoritySpeaker(words: DiarizedWord[]): number | undefined {
  const counts = new Map<number, number>();
  for (const w of words) {
    if (w.speaker === undefined) continue;
    counts.set(w.speaker, (counts.get(w.speaker) ?? 0) + 1);
  }
  let best: number | undefined;
  let bestCount = 0;
  for (const [speaker, count] of counts) {
    if (count > bestCount) {
      best = speaker;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Traduce el índice numérico de hablante de Deepgram a una etiqueta legible.
 * Asume que el profesional abre la sesión (primer hablante nuevo = "Doctor",
 * segundo = "Paciente"); hablantes adicionales (poco común) se numeran aparte.
 * El mapa debe persistir (p. ej. en un ref) durante toda la sesión.
 */
export function labelForSpeaker(speakerIndex: number, labels: Map<number, string>): string {
  const existing = labels.get(speakerIndex);
  if (existing) return existing;
  const label =
    labels.size === 0 ? "Doctor" : labels.size === 1 ? "Paciente" : `Hablante ${labels.size + 1}`;
  labels.set(speakerIndex, label);
  return label;
}

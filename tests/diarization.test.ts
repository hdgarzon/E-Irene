import { describe, it, expect } from "vitest";
import { majoritySpeaker, labelForSpeaker } from "@/lib/diarization";

describe("majoritySpeaker", () => {
  it("devuelve el único hablante cuando todas las palabras coinciden", () => {
    expect(majoritySpeaker([{ speaker: 0 }, { speaker: 0 }, { speaker: 0 }])).toBe(0);
  });

  it("devuelve el hablante con más palabras", () => {
    expect(
      majoritySpeaker([{ speaker: 1 }, { speaker: 0 }, { speaker: 1 }, { speaker: 1 }]),
    ).toBe(1);
  });

  it("ignora palabras sin campo speaker", () => {
    expect(majoritySpeaker([{}, { speaker: 2 }, {}])).toBe(2);
  });

  it("devuelve undefined si no hay palabras con speaker", () => {
    expect(majoritySpeaker([{}, {}])).toBeUndefined();
    expect(majoritySpeaker([])).toBeUndefined();
  });
});

describe("labelForSpeaker", () => {
  it("asigna 'Doctor' al primer hablante nuevo", () => {
    const labels = new Map<number, string>();
    expect(labelForSpeaker(0, labels)).toBe("Doctor");
  });

  it("asigna 'Paciente' al segundo hablante nuevo", () => {
    const labels = new Map<number, string>();
    labelForSpeaker(0, labels);
    expect(labelForSpeaker(1, labels)).toBe("Paciente");
  });

  it("reutiliza la misma etiqueta para un hablante ya visto", () => {
    const labels = new Map<number, string>();
    labelForSpeaker(0, labels);
    labelForSpeaker(1, labels);
    expect(labelForSpeaker(0, labels)).toBe("Doctor");
    expect(labelForSpeaker(1, labels)).toBe("Paciente");
  });

  it("etiqueta hablantes adicionales como 'Hablante N'", () => {
    const labels = new Map<number, string>();
    labelForSpeaker(0, labels);
    labelForSpeaker(1, labels);
    expect(labelForSpeaker(2, labels)).toBe("Hablante 3");
  });

  it("respeta el orden real de aparición, no el índice numérico de Deepgram", () => {
    // Si el paciente habla primero (índice 1 aparece antes que el 0 en el audio),
    // igual se le asigna "Doctor" por ser el primero detectado en la conversación.
    const labels = new Map<number, string>();
    expect(labelForSpeaker(1, labels)).toBe("Doctor");
    expect(labelForSpeaker(0, labels)).toBe("Paciente");
  });

  it("simula una conversación completa alternando hablantes", () => {
    const labels = new Map<number, string>();
    const sequence = [0, 0, 1, 1, 0, 1, 1];
    const result = sequence.map((s) => labelForSpeaker(s, labels));
    expect(result).toEqual([
      "Doctor",
      "Doctor",
      "Paciente",
      "Paciente",
      "Doctor",
      "Paciente",
      "Paciente",
    ]);
  });
});

import { describe, it, expect } from "vitest";
import { extractPatientText } from "@/lib/transcript-utils";

describe("extractPatientText", () => {
  it("extrae solo las líneas del paciente", () => {
    const transcript =
      "Doctor: ¿Cómo te has sentido esta semana?\n" +
      "Paciente: Bastante ansioso por el trabajo.\n" +
      "Doctor: ¿En qué momentos aparece?\n" +
      "Paciente: Antes de las reuniones, sobre todo.";

    expect(extractPatientText(transcript)).toBe(
      "Bastante ansioso por el trabajo. Antes de las reuniones, sobre todo.",
    );
  });

  it("es insensible a mayúsculas/minúsculas en la etiqueta", () => {
    expect(extractPatientText("paciente: hola\nPACIENTE: adiós")).toBe("hola adiós");
  });

  it("ignora al doctor y a otros hablantes", () => {
    const transcript = "Doctor: Hola\nHablante 3: interrupción\nPaciente: Bien";
    expect(extractPatientText(transcript)).toBe("Bien");
  });

  it("cae de vuelta al texto completo si no hay líneas de paciente", () => {
    const raw = "Me siento ansioso por el trabajo, no puedo dormir.";
    expect(extractPatientText(raw)).toBe(raw);
  });

  it("cae de vuelta al texto completo si solo hay líneas del doctor", () => {
    const transcript = "Doctor: ¿Cómo estás?\nDoctor: ¿Todo bien?";
    expect(extractPatientText(transcript)).toBe(transcript);
  });

  it("ignora líneas de paciente vacías", () => {
    expect(extractPatientText("Paciente: \nPaciente: algo real")).toBe("algo real");
  });
});

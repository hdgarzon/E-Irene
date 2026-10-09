import { describe, it, expect } from "vitest";
import { calculateAge, requiresRepresentativeByBirthDate } from "@/lib/consent";
import { dayKey } from "@/lib/dates";

/** Fecha de hace `years` años (± días) contada desde el día de hoy en Bogotá. */
function isoDateYearsAgo(years: number, dayOffset = 0): string {
  const [y, m, d] = dayKey(new Date()).split("-").map(Number);
  return new Date(Date.UTC(y - years, m - 1, d + dayOffset)).toISOString().slice(0, 10);
}

describe("calculateAge", () => {
  it("cuenta el día de calendario de Bogotá, sin correrse un día por la zona horaria", () => {
    // Antes, "2012-10-11" se leía como 10-oct 19:00 en Bogotá: el cumpleaños
    // caía un día antes.
    expect(calculateAge("2012-10-11", "2026-10-10")).toBe(13);
    expect(calculateAge("2012-10-11", "2026-10-11")).toBe(14);
  });


  it("calcula la edad exacta para un cumpleaños ya pasado este año", () => {
    expect(calculateAge(isoDateYearsAgo(20, -10))).toBe(20);
  });

  it("no suma el año todavía si el cumpleaños de este año no ha llegado", () => {
    expect(calculateAge(isoDateYearsAgo(20, 10))).toBe(19);
  });

  it("cuenta el cumpleaños de hoy como ya cumplido", () => {
    expect(calculateAge(isoDateYearsAgo(20, 0))).toBe(20);
  });
});

// Resolución 309 de 2025 (cláusula octava del consentimiento): desde los 14
// años el paciente firma por sí mismo; por debajo firma el representante.
describe("requiresRepresentativeByBirthDate", () => {
  it("null si no hay fecha de nacimiento", () => {
    expect(requiresRepresentativeByBirthDate(null)).toBeNull();
    expect(requiresRepresentativeByBirthDate(undefined)).toBeNull();
  });

  it("true para un paciente de 13 años", () => {
    expect(requiresRepresentativeByBirthDate(isoDateYearsAgo(13, -5))).toBe(true);
  });

  it("true si cumple 14 mañana", () => {
    expect(requiresRepresentativeByBirthDate(isoDateYearsAgo(14, 1))).toBe(true);
  });

  it("false para un paciente que cumplió 14 hoy", () => {
    expect(requiresRepresentativeByBirthDate(isoDateYearsAgo(14, 0))).toBe(false);
  });

  it("false para un adolescente de 17: firma por sí mismo", () => {
    expect(requiresRepresentativeByBirthDate(isoDateYearsAgo(17, -5))).toBe(false);
  });

  it("false para un adulto", () => {
    expect(requiresRepresentativeByBirthDate(isoDateYearsAgo(35, -5))).toBe(false);
  });
});

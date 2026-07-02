import { describe, it, expect } from "vitest";
import { calculateAge, isMinorByBirthDate } from "@/lib/consent";

function isoDateYearsAgo(years: number, dayOffset = 0): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  d.setDate(d.getDate() + dayOffset);
  return d.toISOString().slice(0, 10);
}

describe("calculateAge", () => {
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

describe("isMinorByBirthDate", () => {
  it("null si no hay fecha de nacimiento", () => {
    expect(isMinorByBirthDate(null)).toBeNull();
    expect(isMinorByBirthDate(undefined)).toBeNull();
  });

  it("true para un paciente de 17 años", () => {
    expect(isMinorByBirthDate(isoDateYearsAgo(17, -5))).toBe(true);
  });

  it("false para un paciente que cumplió 18 hoy", () => {
    expect(isMinorByBirthDate(isoDateYearsAgo(18, 0))).toBe(false);
  });

  it("false para un adulto claramente mayor", () => {
    expect(isMinorByBirthDate(isoDateYearsAgo(35, -5))).toBe(false);
  });
});

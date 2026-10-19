import { describe, it, expect } from "vitest";
import {
  LEGACY_VERIFICATION_DEADLINE,
  daysUntilLegacyDeadline,
  legacyDeadlineUrgency,
} from "@/lib/verification";

/**
 * El plazo de las cuentas heredadas se comunica SOLO dentro de la app: el
 * correo no está configurado en producción, y esa es la razón por la que el
 * plazo ya se prorrogó una vez (migración 0043, "nadie les avisó"). Si el
 * aviso no escala al acercarse la fecha, el único canal disponible no cumple
 * su función.
 */
describe("plazo de las cuentas heredadas", () => {
  const enBogota = (iso: string) => new Date(iso);

  it("cuenta los días contra el plazo real (18-oct-2026)", () => {
    expect(daysUntilLegacyDeadline(enBogota("2026-10-11T12:00:00-05:00"))).toBe(7);
    expect(daysUntilLegacyDeadline(enBogota("2026-10-17T12:00:00-05:00"))).toBe(1);
    expect(daysUntilLegacyDeadline(enBogota("2026-10-18T08:00:00-05:00"))).toBe(0);
  });

  it("cuenta días de calendario en Bogotá, no según la zona del servidor", () => {
    // Mismo instante, escrito en UTC: a las 02:00Z del 12-oct en Bogotá aún
    // es 11-oct. Si se contara en UTC daría un día menos.
    expect(daysUntilLegacyDeadline(new Date("2026-10-12T02:00:00Z"))).toBe(7);
  });

  it("da negativo una vez vencido", () => {
    expect(daysUntilLegacyDeadline(enBogota("2026-10-20T12:00:00-05:00"))).toBe(-2);
  });

  it("escala la urgencia al acercarse la fecha", () => {
    expect(legacyDeadlineUrgency(enBogota("2026-09-01T12:00:00-05:00"))).toBe("lejano");
    expect(legacyDeadlineUrgency(enBogota("2026-10-11T12:00:00-05:00"))).toBe("proximo");
    expect(legacyDeadlineUrgency(enBogota("2026-10-17T12:00:00-05:00"))).toBe("inminente");
    expect(legacyDeadlineUrgency(enBogota("2026-10-18T08:00:00-05:00"))).toBe("inminente");
  });

  it("el plazo del código es el mismo que aplica la base de datos", () => {
    // verification-grandfather.test.ts ya compara contra la función SQL; acá
    // solo se fija el valor para que un cambio accidental salte.
    expect(LEGACY_VERIFICATION_DEADLINE).toBe("2026-10-18T23:59:00-05:00");
  });
});

import { describe, it, expect } from "vitest";
import {
  addMonthsBogota,
  billingCycleBounds,
  dayKey,
  formatDayLabel,
  formatLongDate,
  formatTime,
  groupByDay,
  toWompiUtcTimestamp,
} from "@/lib/dates";

describe("dates (zona Bogotá UTC-5)", () => {
  it("formatTime usa hora local de Bogotá", () => {
    // 19:30 UTC → 14:30 en Bogotá
    expect(formatTime("2026-06-23T19:30:00Z")).toBe("14:30");
  });

  it("dayKey ajusta el día según la zona", () => {
    // 02:00 UTC del 23 → 21:00 del 22 en Bogotá
    expect(dayKey("2026-06-23T02:00:00Z")).toBe("2026-06-22");
  });

  it("formatDayLabel reconoce Hoy y Mañana", () => {
    const now = new Date();
    const today = dayKey(now);
    const tomorrow = dayKey(new Date(now.getTime() + 86_400_000));
    expect(formatDayLabel(today)).toBe("Hoy");
    expect(formatDayLabel(tomorrow)).toBe("Mañana");
  });

  it("formatDayLabel de una fecha lejana muestra día y mes", () => {
    const label = formatDayLabel("2030-01-15");
    expect(label).toMatch(/15/);
    expect(label.toLowerCase()).toContain("ene");
  });

  it("groupByDay agrupa por día local y ordena", () => {
    const groups = groupByDay([
      { scheduledAt: "2026-06-24T15:00:00Z", id: "b" },
      { scheduledAt: "2026-06-23T14:00:00Z", id: "a1" },
      { scheduledAt: "2026-06-23T20:00:00Z", id: "a2" },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].key).toBe("2026-06-23");
    expect(groups[0].items).toHaveLength(2);
    expect(groups[1].key).toBe("2026-06-24");
  });
});

describe("ciclo de facturación (anclado, hora de Bogotá)", () => {
  it("addMonthsBogota conserva el día del origen y cae al último día si no existe", () => {
    // 31-ene 10:00 en Bogotá.
    expect(addMonthsBogota("2026-01-31T15:00:00Z", 1).toISOString()).toBe("2026-02-28T15:00:00.000Z");
    expect(addMonthsBogota("2026-01-31T15:00:00Z", 2).toISOString()).toBe("2026-03-31T15:00:00.000Z");
    expect(addMonthsBogota("2028-01-31T15:00:00Z", 1).toISOString()).toBe("2028-02-29T15:00:00.000Z");
    expect(addMonthsBogota("2026-03-31T15:00:00Z", -1).toISOString()).toBe("2026-02-28T15:00:00.000Z");
    expect(addMonthsBogota("2026-11-15T15:00:00Z", 2).toISOString()).toBe("2027-01-15T15:00:00.000Z");
  });

  it("addMonthsBogota razona en el día de Bogotá, no en el de UTC", () => {
    // 02:00 UTC del 31-ene son las 21:00 del 30-ene en Bogotá: el día que se
    // conserva es el 30 (→ 28-feb 21:00 Bogotá = 1-mar 02:00 UTC). Sumando en
    // UTC daría 28-feb 02:00 UTC y el ciclo terminaría un día antes en Colombia.
    expect(addMonthsBogota("2026-01-31T02:00:00Z", 1).toISOString()).toBe("2026-03-01T02:00:00.000Z");
  });

  it("billingCycleBounds devuelve el ciclo vigente contado desde el ancla", () => {
    const { start, end } = billingCycleBounds("2026-08-18T14:00:00Z", new Date("2026-09-10T12:00:00Z"));
    expect(start.toISOString()).toBe("2026-08-18T14:00:00.000Z");
    expect(end.toISOString()).toBe("2026-09-18T14:00:00.000Z");
  });

  it("el inicio del ciclo es inclusivo y el fin exclusivo", () => {
    const exact = billingCycleBounds("2026-08-18T14:00:00Z", new Date("2026-09-18T14:00:00.000Z"));
    expect(exact.start.toISOString()).toBe("2026-09-18T14:00:00.000Z");
    const before = billingCycleBounds("2026-08-18T14:00:00Z", new Date("2026-09-18T13:59:59.999Z"));
    expect(before.start.toISOString()).toBe("2026-08-18T14:00:00.000Z");
  });

  it("un ancla del 31 no se queda corrida al 28 después de febrero", () => {
    const march = billingCycleBounds("2026-01-31T15:00:00Z", new Date("2026-03-01T00:00:00Z"));
    expect(march.start.toISOString()).toBe("2026-02-28T15:00:00.000Z");
    expect(march.end.toISOString()).toBe("2026-03-31T15:00:00.000Z");
  });

  it("las 23:30 del 30-sep en Bogotá siguen siendo el ciclo de septiembre", () => {
    // Ancla: 1-sep 00:00 en Bogotá. Esa hora del 30-sep ya es 1-oct en UTC.
    const { start, end } = billingCycleBounds("2026-09-01T05:00:00Z", new Date("2026-10-01T04:30:00Z"));
    expect(start.toISOString()).toBe("2026-09-01T05:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-01T05:00:00.000Z");
  });

  it("funciona con un ancla futura (fin de un período pagado que aún no llega)", () => {
    const { start, end } = billingCycleBounds("2026-10-18T14:00:00Z", new Date("2026-09-20T00:00:00Z"));
    expect(start.toISOString()).toBe("2026-09-18T14:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-18T14:00:00.000Z");
  });

  it("formatLongDate muestra la fecha de Bogotá sin día de la semana", () => {
    // 02:00 UTC del 19-oct son las 21:00 del 18-oct en Bogotá.
    expect(formatLongDate("2026-10-19T02:00:00Z")).toBe("18 de octubre de 2026");
  });
});

describe("expires_at de los links de Wompi", () => {
  it("es el instante en UTC, sin zona ni milisegundos", () => {
    expect(toWompiUtcTimestamp(new Date("2026-09-15T15:30:45.678Z"))).toBe("2026-09-15T15:30:45");
    // No se convierte a Bogotá: 02:00 UTC sigue siendo 02:00.
    expect(toWompiUtcTimestamp(new Date("2026-09-16T02:00:00Z"))).toBe("2026-09-16T02:00:00");
  });
});

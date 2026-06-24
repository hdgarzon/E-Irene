import { describe, it, expect } from "vitest";
import { dayKey, formatTime, formatDayLabel, groupByDay } from "@/lib/dates";

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

import { describe, it, expect } from "vitest";
import { isJoinWindowOpen } from "@/lib/video/join-token";

const MIN = 60_000;

describe("isJoinWindowOpen", () => {
  const scheduledAt = "2026-07-08T15:00:00.000Z"; // 3:00pm UTC, duración 50min

  it("false más de 15 minutos antes de la hora agendada", () => {
    const now = new Date("2026-07-08T14:44:00.000Z"); // 16 min antes
    expect(isJoinWindowOpen({ scheduledAt, durationMin: 50, now })).toBe(false);
  });

  it("true exactamente 15 minutos antes", () => {
    const now = new Date("2026-07-08T14:45:00.000Z"); // 15 min antes
    expect(isJoinWindowOpen({ scheduledAt, durationMin: 50, now })).toBe(true);
  });

  it("true durante la duración de la cita", () => {
    const now = new Date("2026-07-08T15:20:00.000Z"); // 20 min dentro de 50
    expect(isJoinWindowOpen({ scheduledAt, durationMin: 50, now })).toBe(true);
  });

  it("true hasta 15 minutos después de terminada (margen de cierre)", () => {
    const now = new Date("2026-07-08T16:00:00.000Z"); // 10 min después de terminar (15:50)
    expect(isJoinWindowOpen({ scheduledAt, durationMin: 50, now })).toBe(true);
  });

  it("false más de 15 minutos después de terminada", () => {
    const now = new Date("2026-07-08T16:06:00.000Z"); // 16 min después de terminar
    expect(isJoinWindowOpen({ scheduledAt, durationMin: 50, now })).toBe(false);
  });
});

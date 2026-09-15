import { describe, it, expect } from "vitest";
import {
  PACK_MIN_REMAINING_MS,
  transcriptionPackAvailability,
} from "@/lib/billing/transcription-pack";
import {
  TRANSCRIPTION_PACK,
  effectiveTranscriptionLimitSeconds,
  transcriptionLimitHours,
  transcriptionUsageLabel,
} from "@/lib/plans";

// Cuándo se vende la bolsa de transcripción y cómo se muestra el límite con ella
// (migración 0057). Lo que la base otorga y aplica: transcription-packs.test.ts.

const NOW = new Date("2026-09-15T15:00:00Z");
const HOUR = 60 * 60 * 1000;

function at(offsetMs: number): string {
  return new Date(NOW.getTime() + offsetMs).toISOString();
}

describe("bolsa de transcripción", () => {
  it("5 h por $25.000", () => {
    expect(TRANSCRIPTION_PACK).toEqual({ hours: 5, priceInCents: 2_500_000 });
  });

  it("se vende a los planes pagos con período vigente", () => {
    for (const plan of ["esencial", "pro", "clinica"] as const) {
      expect(
        transcriptionPackAvailability({ plan, hasPaidPeriod: true, cycleEnd: at(72 * HOUR), now: NOW }),
      ).toBe("available");
    }
  });

  it("no se vende a Free, a Enterprise ni sin período pagado", () => {
    const cycleEnd = at(72 * HOUR);
    expect(transcriptionPackAvailability({ plan: "free", hasPaidPeriod: true, cycleEnd, now: NOW })).toBe(
      "not_eligible",
    );
    expect(
      transcriptionPackAvailability({ plan: "enterprise", hasPaidPeriod: true, cycleEnd, now: NOW }),
    ).toBe("not_eligible");
    expect(
      transcriptionPackAvailability({ plan: "pro", hasPaidPeriod: false, cycleEnd, now: NOW }),
    ).toBe("not_eligible");
  });

  it("no vende horas que vencerían en menos de 24 horas", () => {
    const check = (offsetMs: number) =>
      transcriptionPackAvailability({ plan: "pro", hasPaidPeriod: true, cycleEnd: at(offsetMs), now: NOW });
    expect(check(PACK_MIN_REMAINING_MS)).toBe("available");
    expect(check(PACK_MIN_REMAINING_MS - 1000)).toBe("cycle_ending");
    expect(check(HOUR)).toBe("cycle_ending");
  });

  it("el límite mostrado suma las bolsas vigentes al del plan", () => {
    const pack = TRANSCRIPTION_PACK.hours * 3600;
    expect(effectiveTranscriptionLimitSeconds("esencial")).toBe(20 * 3600);
    expect(effectiveTranscriptionLimitSeconds("esencial", pack)).toBe(25 * 3600);
    expect(transcriptionLimitHours("pro", 2 * pack)).toBe(40);
    expect(transcriptionUsageLabel(3 * 3600, "esencial", pack)).toBe("3 h / 25 h");
    // Sin bolsa, igual que antes.
    expect(transcriptionUsageLabel(5400, "free")).toBe("1,5 h / 2 h");
  });

  it("un plan ilimitado sigue ilimitado, con o sin bolsa", () => {
    expect(effectiveTranscriptionLimitSeconds("enterprise", 18_000)).toBeNull();
    expect(transcriptionLimitHours("enterprise", 18_000)).toBe(Infinity);
    expect(transcriptionUsageLabel(3600, "enterprise", 18_000)).toBe("1 h / Ilimitado");
  });
});

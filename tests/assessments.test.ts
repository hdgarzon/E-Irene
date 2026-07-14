import { describe, it, expect } from "vitest";
import { selectPhq9RiskAlerts, type Phq9RiskCandidate } from "@/lib/db/assessments";

function candidate(overrides: Partial<Phq9RiskCandidate> = {}): Phq9RiskCandidate {
  return {
    assessmentId: "a1",
    patientId: "p1",
    patientName: "Ana",
    date: "2026-07-01T10:00:00.000Z",
    type: "phq9",
    answers: [0, 0, 0, 0, 0, 0, 0, 0, 1],
    ...overrides,
  };
}

describe("selectPhq9RiskAlerts", () => {
  it("incluye un PHQ-9 con el ítem de autolesión > 0", () => {
    const result = selectPhq9RiskAlerts([candidate()]);
    expect(result).toEqual([
      { assessmentId: "a1", patientId: "p1", patientName: "Ana", date: "2026-07-01T10:00:00.000Z" },
    ]);
  });

  it("excluye un PHQ-9 con el ítem de autolesión en 0", () => {
    const result = selectPhq9RiskAlerts([
      candidate({ answers: [3, 3, 3, 3, 3, 3, 3, 3, 0] }),
    ]);
    expect(result).toEqual([]);
  });

  it("excluye GAD-7 aunque el índice 8 no exista", () => {
    const result = selectPhq9RiskAlerts([
      candidate({ type: "gad7", answers: [3, 3, 3, 3, 3, 3, 3] }),
    ]);
    expect(result).toEqual([]);
  });

  it("conserva el orden de entrada y filtra varias filas mixtas", () => {
    const risky = candidate({ assessmentId: "a1" });
    const safe = candidate({ assessmentId: "a2", answers: [0, 0, 0, 0, 0, 0, 0, 0, 0] });
    const alsoRisky = candidate({ assessmentId: "a3", answers: [0, 0, 0, 0, 0, 0, 0, 0, 2] });
    const result = selectPhq9RiskAlerts([risky, safe, alsoRisky]);
    expect(result.map((r) => r.assessmentId)).toEqual(["a1", "a3"]);
  });
});

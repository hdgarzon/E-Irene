import { describe, it, expect } from "vitest";
import { computeTreatmentTrend, MCID } from "@/lib/treatment-trend";
import type { AssessmentResult, AssessmentType } from "@/lib/psychometrics";

function assessment(type: AssessmentType, totalScore: number, administeredAt: string) {
  return {
    type,
    result: { answers: [], totalScore, severity: "" } as AssessmentResult,
    administeredAt,
  };
}

describe("computeTreatmentTrend — datos insuficientes", () => {
  it("sin ninguna medición, devuelve insufficient_data con todo en null", () => {
    const trend = computeTreatmentTrend([], "phq9");
    expect(trend.status).toBe("insufficient_data");
    expect(trend.assessmentCount).toBe(0);
    expect(trend.baseline).toBeNull();
    expect(trend.latest).toBeNull();
    expect(trend.change).toBeNull();
  });

  it("con 1 o 2 mediciones (menos del mínimo), sigue siendo insufficient_data aunque haya una diferencia grande", () => {
    const assessments = [assessment("phq9", 20, "2026-01-01"), assessment("phq9", 5, "2026-02-01")];
    const trend = computeTreatmentTrend(assessments, "phq9");
    expect(trend.status).toBe("insufficient_data");
    expect(trend.assessmentCount).toBe(2);
    // No calcula "change" con datos insuficientes — sería sugerir una tendencia que no está sostenida.
    expect(trend.change).toBeNull();
  });
});

describe("computeTreatmentTrend — clasificación con datos suficientes (≥3 mediciones)", () => {
  it("una caída de puntaje mayor o igual al MCID se clasifica como 'improving'", () => {
    const assessments = [
      assessment("phq9", 20, "2026-01-01"),
      assessment("phq9", 15, "2026-01-15"),
      assessment("phq9", 20 - MCID.phq9, "2026-02-01"),
    ];
    const trend = computeTreatmentTrend(assessments, "phq9");
    expect(trend.status).toBe("improving");
    expect(trend.change).toBe(MCID.phq9);
  });

  it("una subida de puntaje mayor o igual al MCID se clasifica como 'worsening'", () => {
    const assessments = [
      assessment("gad7", 8, "2026-01-01"),
      assessment("gad7", 10, "2026-01-15"),
      assessment("gad7", 8 + MCID.gad7, "2026-02-01"),
    ];
    const trend = computeTreatmentTrend(assessments, "gad7");
    expect(trend.status).toBe("worsening");
    expect(trend.change).toBe(-MCID.gad7);
  });

  it("un cambio por debajo del MCID (en cualquier dirección) se clasifica como 'stable', no como mejora ni empeoramiento", () => {
    const assessments = [
      assessment("phq9", 12, "2026-01-01"),
      assessment("phq9", 13, "2026-01-15"),
      assessment("phq9", 12 - (MCID.phq9 - 1), "2026-02-01"), // por debajo del umbral
    ];
    const trend = computeTreatmentTrend(assessments, "phq9");
    expect(trend.status).toBe("stable");
  });

  it("compara contra la línea base (primera medición), NO contra la medición inmediatamente anterior", () => {
    // Baseline 20 → última 10 = mejora de 10 (≥ MCID), aunque la penúltima
    // medición haya subido respecto a la anterior — el ruido sesión a sesión
    // no debe hacer perder la tendencia real desde el inicio.
    const assessments = [
      assessment("phq9", 20, "2026-01-01"),
      assessment("phq9", 22, "2026-01-15"), // sube respecto a la anterior
      assessment("phq9", 10, "2026-02-01"),
    ];
    const trend = computeTreatmentTrend(assessments, "phq9");
    expect(trend.baseline?.score).toBe(20);
    expect(trend.latest?.score).toBe(10);
    expect(trend.change).toBe(10);
    expect(trend.status).toBe("improving");
  });

  it("ordena por fecha aunque las mediciones lleguen desordenadas", () => {
    const assessments = [
      assessment("gad7", 5, "2026-03-01"),
      assessment("gad7", 15, "2026-01-01"),
      assessment("gad7", 10, "2026-02-01"),
    ];
    const trend = computeTreatmentTrend(assessments, "gad7");
    expect(trend.baseline?.administeredAt).toBe("2026-01-01");
    expect(trend.latest?.administeredAt).toBe("2026-03-01");
  });

  it("filtra por tipo de escala — no mezcla PHQ-9 con GAD-7", () => {
    const assessments = [
      assessment("phq9", 20, "2026-01-01"),
      assessment("gad7", 15, "2026-01-05"),
      assessment("phq9", 15, "2026-01-15"),
      assessment("gad7", 10, "2026-01-20"),
      assessment("phq9", 10, "2026-02-01"),
    ];
    const trend = computeTreatmentTrend(assessments, "phq9");
    expect(trend.assessmentCount).toBe(3);
    expect(trend.type).toBe("phq9");
  });
});

import { describe, it, expect } from "vitest";
import {
  canAddPatient,
  canAddDoctor,
  canStartConsultation,
  limitLabel,
  planLimits,
  transcriptionLimitSeconds,
  transcriptionHoursLabel,
  transcriptionUsageLabel,
} from "@/lib/plans";

describe("plans (límites por plan)", () => {
  it("Free limita pacientes a 5", () => {
    expect(canAddPatient("free", 4)).toBe(true);
    expect(canAddPatient("free", 5)).toBe(false);
  });

  it("Pro permite pacientes ilimitados", () => {
    expect(canAddPatient("pro", 9999)).toBe(true);
  });

  it("Free limita doctores a 1; Clínica a 5", () => {
    expect(canAddDoctor("free", 1)).toBe(false);
    expect(canAddDoctor("clinica", 4)).toBe(true);
    expect(canAddDoctor("clinica", 5)).toBe(false);
  });

  it("limitLabel muestra número o Ilimitado", () => {
    expect(limitLabel(5)).toBe("5");
    expect(limitLabel(Infinity)).toBe("Ilimitado");
  });

  it("planLimits expone precio y features", () => {
    expect(planLimits("free").ai).toBe(false);
    expect(planLimits("clinica").whatsapp).toBe(true);
    expect(planLimits("pro").price).toContain("29");
  });

  it("Free limita a 5 consultas/mes; Clinic (enterprise) a 120", () => {
    expect(canStartConsultation("free", 4)).toBe(true);
    expect(canStartConsultation("free", 5)).toBe(false);
    expect(canStartConsultation("enterprise", 119)).toBe(true);
    expect(canStartConsultation("enterprise", 120)).toBe(false);
  });

  it("transcriptionLimitSeconds convierte horas del plan; enterprise es null (ilimitado)", () => {
    expect(transcriptionLimitSeconds("free")).toBe(2 * 3600);
    expect(transcriptionLimitSeconds("pro")).toBe(20 * 3600);
    expect(transcriptionLimitSeconds("clinica")).toBe(100 * 3600);
    expect(transcriptionLimitSeconds("enterprise")).toBeNull();
  });

  it("transcriptionHoursLabel formatea horas con coma decimal (es-CO)", () => {
    expect(transcriptionHoursLabel(0)).toBe("0");
    expect(transcriptionHoursLabel(5400)).toBe("1,5");
    expect(transcriptionHoursLabel(20 * 3600)).toBe("20");
  });

  it("transcriptionUsageLabel muestra 'usado / límite' o Ilimitado", () => {
    expect(transcriptionUsageLabel(5400, "free")).toBe("1,5 h / 2 h");
    expect(transcriptionUsageLabel(0, "pro")).toBe("0 h / 20 h");
    expect(transcriptionUsageLabel(5400, "enterprise")).toBe("1,5 h / Ilimitado");
  });
});

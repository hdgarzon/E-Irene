import { describe, it, expect } from "vitest";
import { canAddPatient, canAddDoctor, limitLabel, planLimits } from "@/lib/plans";

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
    expect(planLimits("pro").price).toContain("49");
  });
});

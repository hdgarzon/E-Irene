import { describe, it, expect } from "vitest";
import {
  PAID_PLANS,
  PLANS,
  PLAN_ORDER,
  canAddPatient,
  canAddDoctor,
  canStartConsultation,
  formatCop,
  limitLabel,
  planLimits,
  priceLabel,
  transcriptionLimitSeconds,
  transcriptionHoursLabel,
  transcriptionUsageLabel,
} from "@/lib/plans";

describe("plans (límites por plan)", () => {
  it("Free limita pacientes a 5", () => {
    expect(canAddPatient("free", 4)).toBe(true);
    expect(canAddPatient("free", 5)).toBe(false);
  });

  it("los planes pagos permiten pacientes ilimitados", () => {
    expect(canAddPatient("esencial", 9999)).toBe(true);
    expect(canAddPatient("pro", 9999)).toBe(true);
  });

  it("Free, Esencial y Profesional son de 1 profesional; Clínica llega a 5", () => {
    expect(canAddDoctor("free", 1)).toBe(false);
    expect(canAddDoctor("esencial", 1)).toBe(false);
    expect(canAddDoctor("pro", 1)).toBe(false);
    expect(canAddDoctor("clinica", 4)).toBe(true);
    expect(canAddDoctor("clinica", 5)).toBe(false);
  });

  it("limitLabel muestra número o Ilimitado", () => {
    expect(limitLabel(5)).toBe("5");
    expect(limitLabel(Infinity)).toBe("Ilimitado");
  });

  it("planLimits expone las funciones de cada plan", () => {
    // El análisis con IA no es una función del plan: está en todos, porque genera las
    // alertas de riesgo al profesional (lib/plans.ts).
    expect(planLimits("free")).not.toHaveProperty("ai");
    expect(planLimits("esencial").whatsapp).toBe(false);
    expect(planLimits("clinica").whatsapp).toBe(true);
  });

  it("topes de consultas por ciclo: 5 / 20 / 30 / 75, y Enterprise sin tope en la app", () => {
    expect(canStartConsultation("free", 4)).toBe(true);
    expect(canStartConsultation("free", 5)).toBe(false);
    expect(canStartConsultation("esencial", 19)).toBe(true);
    expect(canStartConsultation("esencial", 20)).toBe(false);
    expect(canStartConsultation("pro", 29)).toBe(true);
    expect(canStartConsultation("pro", 30)).toBe(false);
    expect(canStartConsultation("clinica", 74)).toBe(true);
    expect(canStartConsultation("clinica", 75)).toBe(false);
    expect(canStartConsultation("enterprise", 10_000)).toBe(true);
  });

  it("transcriptionLimitSeconds convierte horas del plan; enterprise es null (ilimitado)", () => {
    expect(transcriptionLimitSeconds("free")).toBe(2 * 3600);
    expect(transcriptionLimitSeconds("esencial")).toBe(20 * 3600);
    expect(transcriptionLimitSeconds("pro")).toBe(30 * 3600);
    expect(transcriptionLimitSeconds("clinica")).toBe(75 * 3600);
    expect(transcriptionLimitSeconds("enterprise")).toBeNull();
  });

  it("en los planes pagos la bolsa de horas es consultas × 1 h, la promesa comercial", () => {
    for (const plan of PAID_PLANS) {
      expect(PLANS[plan].transcriptionHours).toBe(PLANS[plan].consultationsPerMonth);
    }
  });

  it("transcriptionHoursLabel formatea horas con coma decimal (es-CO)", () => {
    expect(transcriptionHoursLabel(0)).toBe("0");
    expect(transcriptionHoursLabel(5400)).toBe("1,5");
    expect(transcriptionHoursLabel(20 * 3600)).toBe("20");
  });

  it("transcriptionUsageLabel muestra 'usado / límite' o Ilimitado", () => {
    expect(transcriptionUsageLabel(5400, "free")).toBe("1,5 h / 2 h");
    expect(transcriptionUsageLabel(0, "pro")).toBe("0 h / 30 h");
    expect(transcriptionUsageLabel(5400, "enterprise")).toBe("1,5 h / Ilimitado");
  });
});

describe("precios en pesos colombianos", () => {
  it("cobra COP 59.000 / 99.000 / 249.000, en centavos como los recibe Wompi", () => {
    expect(PLANS.esencial.priceInCents).toBe(5_900_000);
    expect(PLANS.pro.priceInCents).toBe(9_900_000);
    expect(PLANS.clinica.priceInCents).toBe(24_900_000);
  });

  it("muestra el precio en pesos con la moneda explícita", () => {
    expect(PLANS.free.price).toBe("$0 COP/mes");
    expect(PLANS.esencial.price).toBe("$59.000 COP/mes");
    expect(PLANS.pro.price).toBe("$99.000 COP/mes");
    expect(PLANS.clinica.price).toBe("$249.000 COP/mes");
  });

  it("Enterprise es a convenir: no tiene precio fijo", () => {
    expect(PLANS.enterprise.priceInCents).toBeNull();
    expect(PLANS.enterprise.price).toBe("A convenir");
  });

  it("formatCop agrupa los miles con punto", () => {
    expect(formatCop(0)).toBe("$0");
    expect(formatCop(900_000)).toBe("$9.000");
    expect(formatCop(24_900_000)).toBe("$249.000");
    expect(formatCop(150_000_000)).toBe("$1.500.000");
  });

  it("el precio visible sale siempre del monto que se cobra", () => {
    for (const plan of PLAN_ORDER) {
      expect(PLANS[plan].price).toBe(priceLabel(PLANS[plan].priceInCents));
    }
  });

  it("solo Esencial, Profesional y Clínica se compran y se renuevan por Wompi", () => {
    expect(PAID_PLANS).toEqual(["esencial", "pro", "clinica"]);
  });
});

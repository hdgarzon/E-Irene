import { describe, it, expect } from "vitest";
import { extractRiskAlertCategories, RISK_CATEGORY_LABEL } from "@/lib/risk-flags";
import type { RiskFlags } from "@/lib/providers/types";

function riskFlags(overrides: Partial<RiskFlags>): RiskFlags {
  const none = { level: "ninguno" as const, evidence: "" };
  return {
    suicidal_ideation: none,
    self_harm: none,
    substance_use: none,
    risk_to_others: none,
    ...overrides,
  };
}

describe("extractRiskAlertCategories", () => {
  it("sin riskFlags, no hay alerta", () => {
    expect(extractRiskAlertCategories(undefined)).toEqual([]);
  });

  it("todas las categorías en 'ninguno' no producen alerta", () => {
    expect(extractRiskAlertCategories(riskFlags({}))).toEqual([]);
  });

  it("'bajo' no amerita alerta al doctor — solo moderado/alto", () => {
    const flags = riskFlags({
      substance_use: { level: "bajo", evidence: "tomo de vez en cuando" },
    });
    expect(extractRiskAlertCategories(flags)).toEqual([]);
  });

  it("'moderado' produce una entrada con su evidencia", () => {
    const flags = riskFlags({
      self_harm: { level: "moderado", evidence: "a veces me hago daño" },
    });
    const categories = extractRiskAlertCategories(flags);
    expect(categories).toEqual([
      { key: "self_harm", level: "moderado", evidence: "a veces me hago daño" },
    ]);
  });

  it("'alto' produce una entrada", () => {
    const flags = riskFlags({
      suicidal_ideation: { level: "alto", evidence: "tengo un plan" },
    });
    expect(extractRiskAlertCategories(flags)).toEqual([
      { key: "suicidal_ideation", level: "alto", evidence: "tengo un plan" },
    ]);
  });

  it("varias categorías simultáneas producen varias entradas", () => {
    const flags = riskFlags({
      suicidal_ideation: { level: "alto", evidence: "quiero morir" },
      substance_use: { level: "moderado", evidence: "tomo todos los días" },
    });
    const categories = extractRiskAlertCategories(flags);
    expect(categories).toHaveLength(2);
    expect(categories.map((c) => c.key).sort()).toEqual(["substance_use", "suicidal_ideation"]);
  });

  it("cada categoría tiene una etiqueta legible en español", () => {
    for (const key of Object.keys(RISK_CATEGORY_LABEL) as (keyof RiskFlags)[]) {
      expect(RISK_CATEGORY_LABEL[key].length).toBeGreaterThan(0);
    }
  });
});

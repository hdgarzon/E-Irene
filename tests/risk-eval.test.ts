import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getAnalysisProvider } from "@/lib/providers";
import { OpenAIAnalysisProvider } from "@/lib/providers/openai";
import type { AnalysisProvider } from "@/lib/providers/types";
import { bareAnalysisContext } from "@/lib/clinical-state";
import { RISK_CASES, type RiskCase } from "./risk-eval/cases";
import { scoreRiskCase, summarizeRiskEval } from "./risk-eval/scoring";

/**
 * Ver tests/risk-eval/README.md para qué mide este harness y — más
 * importante — qué NO mide: no es validación clínica, es una red de
 * seguridad contra regresiones.
 */

const hasOpenAI = Boolean(process.env.OPENAI_API_KEY);

/**
 * Ejecuta `fn` sobre `items` con paralelismo acotado — los 16 casos son
 * independientes entre sí (nada de estado compartido), así que correrlos
 * todos en serie desperdicia tiempo, pero lanzarlos TODOS a la vez contra la
 * API real compite por rate limit con otros archivos de test que también
 * llaman a OpenAI en paralelo (`tests/providers-live.test.ts`), y dispara
 * 429. Un límite moderado es rápido sin tumbar el rate limit compartido.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function evaluate(provider: AnalysisProvider, cases: RiskCase[]) {
  const perCase = await mapWithConcurrency(cases, 4, async (riskCase) => {
    const { payload } = await provider.analyze(bareAnalysisContext(riskCase.transcript));
    return scoreRiskCase(riskCase, payload.riskFlags);
  });
  return summarizeRiskEval(perCase.flat());
}

describe("scoreRiskCase / summarizeRiskEval (lógica del harness, sin proveedor)", () => {
  const baseCase: RiskCase = {
    id: "unit-test-case",
    difficulty: "explicit",
    transcript: "irrelevante para esta prueba",
    expected: {
      suicidal_ideation: "alto",
      self_harm: "ninguno",
      substance_use: "ninguno",
      risk_to_others: "ninguno",
    },
    rationale: "fixture de prueba",
    review: "sin_revisar",
  };

  it("un caso que debía alertar y alertó no genera underDetection", () => {
    const checks = scoreRiskCase(baseCase, {
      suicidal_ideation: { level: "alto", evidence: "quiero morir" },
      self_harm: { level: "ninguno", evidence: "" },
      substance_use: { level: "ninguno", evidence: "" },
      risk_to_others: { level: "ninguno", evidence: "" },
    });
    const summary = summarizeRiskEval(checks);
    expect(summary.underDetections).toEqual([]);
    expect(summary.recall).toBe(1);
  });

  it("un caso que debía alertar (moderado/alto) y NO alertó es un underDetection", () => {
    const checks = scoreRiskCase(baseCase, {
      suicidal_ideation: { level: "bajo", evidence: "una mención pasada" },
      self_harm: { level: "ninguno", evidence: "" },
      substance_use: { level: "ninguno", evidence: "" },
      risk_to_others: { level: "ninguno", evidence: "" },
    });
    const summary = summarizeRiskEval(checks);
    expect(summary.underDetections).toHaveLength(1);
    expect(summary.underDetections[0].category).toBe("suicidal_ideation");
    expect(summary.recall).toBe(0);
  });

  it("no importa el nivel exacto (alto vs moderado) para el recall — solo cruzar el umbral", () => {
    // El caso espera "alto"; el proveedor devuelve "moderado" — ambos cruzan
    // ALERT_LEVELS, así que operacionalmente el doctor SÍ es alertado.
    const checks = scoreRiskCase(baseCase, {
      suicidal_ideation: { level: "moderado", evidence: "algo preocupante" },
      self_harm: { level: "ninguno", evidence: "" },
      substance_use: { level: "ninguno", evidence: "" },
      risk_to_others: { level: "ninguno", evidence: "" },
    });
    expect(summarizeRiskEval(checks).underDetections).toEqual([]);
  });

  it("una alerta que no debía dispararse es overDetection, no underDetection", () => {
    const safeCase: RiskCase = {
      ...baseCase,
      expected: {
        suicidal_ideation: "ninguno",
        self_harm: "ninguno",
        substance_use: "ninguno",
        risk_to_others: "ninguno",
      },
    };
    const checks = scoreRiskCase(safeCase, {
      suicidal_ideation: { level: "moderado", evidence: "falso positivo" },
      self_harm: { level: "ninguno", evidence: "" },
      substance_use: { level: "ninguno", evidence: "" },
      risk_to_others: { level: "ninguno", evidence: "" },
    });
    const summary = summarizeRiskEval(checks);
    expect(summary.underDetections).toEqual([]);
    expect(summary.overDetections).toHaveLength(1);
    expect(summary.falsePositiveRate).toBeGreaterThan(0);
  });

  it("sin riskFlags (undefined), todas las categorías se tratan como 'ninguno'", () => {
    const checks = scoreRiskCase(baseCase, undefined);
    expect(checks.every((c) => c.actualLevel === "ninguno")).toBe(true);
    expect(summarizeRiskEval(checks).underDetections).toHaveLength(1); // suicidal_ideation esperaba "alto"
  });
});

describe("evaluación de recall — proveedor activo en CI (mock por defecto)", () => {
  const savedProvider = process.env.ANALYSIS_PROVIDER;

  beforeEach(() => {
    // Fuerza el proveedor mock explícitamente, sin importar si hay una
    // OPENAI_API_KEY real configurada en el entorno local — el nivel
    // "explicit" es la red de seguridad sin red, pensada para correr
    // siempre, incluso en CI sin ninguna API key.
    process.env.ANALYSIS_PROVIDER = "mock";
  });

  afterEach(() => {
    if (savedProvider !== undefined) process.env.ANALYSIS_PROVIDER = savedProvider;
    else delete process.env.ANALYSIS_PROVIDER;
  });

  it("no subestima ningún caso EXPLÍCITO de riesgo moderado/alto", async () => {
    const provider = getAnalysisProvider();
    const explicitCases = RISK_CASES.filter((c) => c.difficulty === "explicit");
    const summary = await evaluate(provider, explicitCases);

    expect(
      summary.underDetections,
      `Recall esperado 100% en casos explícitos, obtenido ${(summary.recall * 100).toFixed(0)}%. ` +
        `Detalle:\n${JSON.stringify(summary.underDetections, null, 2)}`,
    ).toEqual([]);
  });
});

describe.runIf(hasOpenAI)("evaluación de recall — OpenAI (clínico, incluye casos matizados)", () => {
  it("no subestima ningún caso, incluidos los que requieren inferencia clínica", async () => {
    const provider = new OpenAIAnalysisProvider();
    const summary = await evaluate(provider, RISK_CASES);

    console.log(
      `[risk-eval] recall=${(summary.recall * 100).toFixed(0)}% ` +
        `falsePositiveRate=${(summary.falsePositiveRate * 100).toFixed(0)}% ` +
        `(${summary.totalChecks} checks sobre ${RISK_CASES.length} casos)`,
    );

    expect(
      summary.underDetections,
      `Detalle de subdetecciones:\n${JSON.stringify(summary.underDetections, null, 2)}`,
    ).toEqual([]);
  }, 150_000);
});

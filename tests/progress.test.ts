import { describe, it, expect } from "vitest";
import {
  sentimentTrend,
  aggregateKeywords,
  patternTrend,
  averageSentiment,
  type SessionReport,
} from "@/lib/progress";
import type { ReportPayload } from "@/lib/providers/types";

function payload(score: number, keywords: [string, number][], patterns: Record<string, number> = {}): ReportPayload {
  return {
    summary: "s",
    sentiment: { score, label: score > 0 ? "positivo" : score < 0 ? "negativo" : "neutral", timeline: [] },
    keywords: keywords.map(([term, weight]) => ({ term, weight })),
    topics: [],
    patterns,
    suggestion: "Sugerencia de prueba.",
  };
}

const sessions: SessionReport[] = [
  { date: "2026-01-01", payload: payload(-0.6, [["ansiedad", 1], ["trabajo", 0.6]], { intensidad_emocional: 0.3 }) },
  { date: "2026-01-08", payload: payload(-0.2, [["trabajo", 0.8], ["sueño", 0.4]], { intensidad_emocional: 0.2 }) },
  { date: "2026-01-15", payload: payload(0.5, [["calma", 1], ["trabajo", 0.5]], { intensidad_emocional: 0.1 }) },
];

describe("progress (historial comparativo)", () => {
  it("sentimentTrend conserva el orden cronológico", () => {
    const t = sentimentTrend(sessions);
    expect(t.map((p) => p.score)).toEqual([-0.6, -0.2, 0.5]);
    expect(t[2].label).toBe("positivo");
  });

  it("aggregateKeywords suma pesos entre sesiones y normaliza", () => {
    const agg = aggregateKeywords(sessions, 5);
    // 'trabajo' aparece en las 3 (0.6+0.8+0.5=1.9) → el más frecuente
    expect(agg[0].term).toBe("trabajo");
    expect(agg[0].weight).toBe(1);
    expect(agg.find((k) => k.term === "ansiedad")).toBeTruthy();
  });

  it("patternTrend extrae la métrica por sesión", () => {
    const tr = patternTrend(sessions, "intensidad_emocional");
    expect(tr.map((p) => p.value)).toEqual([0.3, 0.2, 0.1]);
  });

  it("averageSentiment promedia los puntajes", () => {
    expect(averageSentiment(sessions)).toBeCloseTo(-0.1, 5);
    expect(averageSentiment([])).toBe(0);
  });
});

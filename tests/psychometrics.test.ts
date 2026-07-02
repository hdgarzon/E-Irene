import { describe, it, expect } from "vitest";
import {
  scoreAssessment,
  severityFor,
  PHQ9_QUESTIONS,
  GAD7_QUESTIONS,
  PHQ9_SELF_HARM_ITEM_INDEX,
} from "@/lib/psychometrics";

describe("scoreAssessment", () => {
  it("suma las respuestas del PHQ-9 (9 ítems)", () => {
    const answers = [1, 1, 1, 1, 1, 1, 1, 1, 1];
    const result = scoreAssessment("phq9", answers);
    expect(result.totalScore).toBe(9);
    expect(result.severity).toBe("Leve");
  });

  it("suma las respuestas del GAD-7 (7 ítems)", () => {
    const answers = [3, 3, 3, 3, 3, 3, 3];
    const result = scoreAssessment("gad7", answers);
    expect(result.totalScore).toBe(21);
    expect(result.severity).toBe("Severa");
  });

  it("rechaza un número de respuestas incorrecto", () => {
    expect(() => scoreAssessment("phq9", [1, 2, 3])).toThrow();
  });

  it("rechaza respuestas fuera de rango", () => {
    expect(() => scoreAssessment("gad7", [0, 0, 0, 0, 0, 0, 4])).toThrow();
    expect(() => scoreAssessment("gad7", [0, 0, 0, 0, 0, 0, -1])).toThrow();
  });

  it("PHQ9_QUESTIONS tiene 9 ítems y GAD7_QUESTIONS tiene 7", () => {
    expect(PHQ9_QUESTIONS.length).toBe(9);
    expect(GAD7_QUESTIONS.length).toBe(7);
  });

  it("el ítem de ideación suicida es el último del PHQ-9", () => {
    expect(PHQ9_QUESTIONS[PHQ9_SELF_HARM_ITEM_INDEX]).toMatch(/mejor muerto|lastimarse/i);
  });
});

describe("severityFor", () => {
  it("bandas de severidad del PHQ-9", () => {
    expect(severityFor("phq9", 0)).toBe("Mínima");
    expect(severityFor("phq9", 4)).toBe("Mínima");
    expect(severityFor("phq9", 5)).toBe("Leve");
    expect(severityFor("phq9", 9)).toBe("Leve");
    expect(severityFor("phq9", 10)).toBe("Moderada");
    expect(severityFor("phq9", 14)).toBe("Moderada");
    expect(severityFor("phq9", 15)).toBe("Moderadamente severa");
    expect(severityFor("phq9", 19)).toBe("Moderadamente severa");
    expect(severityFor("phq9", 20)).toBe("Severa");
    expect(severityFor("phq9", 27)).toBe("Severa");
  });

  it("bandas de severidad del GAD-7", () => {
    expect(severityFor("gad7", 0)).toBe("Mínima");
    expect(severityFor("gad7", 4)).toBe("Mínima");
    expect(severityFor("gad7", 5)).toBe("Leve");
    expect(severityFor("gad7", 9)).toBe("Leve");
    expect(severityFor("gad7", 10)).toBe("Moderada");
    expect(severityFor("gad7", 14)).toBe("Moderada");
    expect(severityFor("gad7", 15)).toBe("Severa");
    expect(severityFor("gad7", 21)).toBe("Severa");
  });
});

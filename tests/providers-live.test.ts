import { describe, it, expect } from "vitest";
import { OpenAIAnalysisProvider } from "@/lib/providers/openai";
import { DeepgramTranscriptionProvider } from "@/lib/providers/deepgram";
import { reportSchema } from "@/lib/providers/types";

/**
 * Pruebas contra las APIs REALES de OpenAI/Deepgram. Se saltan si la key no
 * está configurada (CI/regresión normal usa el mock). Corren si hay
 * OPENAI_API_KEY / DEEPGRAM_API_KEY en .env.local (cargado por vitest.config.ts).
 */

const hasOpenAI = Boolean(process.env.OPENAI_API_KEY);
const hasDeepgram = Boolean(process.env.DEEPGRAM_API_KEY);

describe.runIf(hasOpenAI)("OpenAIAnalysisProvider (real)", () => {
  it("analiza una transcripción en español y cumple el schema", async () => {
    const transcript =
      "Doctor: ¿Cómo te has sentido esta semana?\n" +
      "Paciente: Bastante ansioso, sobre todo antes de las reuniones de trabajo, " +
      "siento que no soy capaz y que voy a fallar.\n" +
      "Doctor: ¿Y lograste identificar qué lo dispara?\n" +
      "Paciente: Creo que es el miedo a que los demás noten que no soy suficiente, " +
      "aunque esta semana logré hablar en una reunión y me sentí más tranquilo después.";

    const provider = new OpenAIAnalysisProvider();
    const report = await provider.analyze(transcript);

    expect(() => reportSchema.parse(report)).not.toThrow();
    expect(report.summary.length).toBeGreaterThan(10);
    expect(report.keywords.length).toBeGreaterThan(0);
    expect(["negativo", "neutral", "positivo"]).toContain(report.sentiment.label);
    expect(report.suggestion.length).toBeGreaterThan(10);
    expect(report.riskFlags).toBeDefined();
    expect(report.riskFlags!.suicidal_ideation.level).toBe("ninguno");
  }, 30_000);
});

describe.runIf(hasDeepgram)("DeepgramTranscriptionProvider (real)", () => {
  it("acuña una API key efímera y de alcance limitado (Project Keys)", async () => {
    const provider = new DeepgramTranscriptionProvider();
    const session = await provider.createSession("test-consultation");

    expect(session.mode).toBe("deepgram");
    expect(session.sessionToken.length).toBeGreaterThan(20);
    expect(session.expiresInMs).toBeGreaterThan(0);
  }, 15_000);
});

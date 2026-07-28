import { describe, it, expect } from "vitest";
import { OpenAIAnalysisProvider } from "@/lib/providers/openai";
import { DeepgramTranscriptionProvider } from "@/lib/providers/deepgram";
import { reportSchema } from "@/lib/providers/types";
import { bareAnalysisContext, clinicalStateDeltaSchema } from "@/lib/clinical-state";

/**
 * Pruebas contra las APIs REALES de OpenAI/Deepgram. Se saltan si la key no
 * está configurada (CI/regresión normal usa el mock). Corren si hay
 * OPENAI_API_KEY / DEEPGRAM_API_KEY en .env.local (cargado por vitest.config.ts).
 */

const hasOpenAI = Boolean(process.env.OPENAI_API_KEY);
const hasDeepgram = Boolean(process.env.DEEPGRAM_API_KEY);

describe.runIf(hasOpenAI)("OpenAIAnalysisProvider (real)", () => {
  it("analiza una transcripción en español, cumple el schema y devuelve un stateDelta válido", async () => {
    const transcript =
      "Doctor: ¿Cómo te has sentido esta semana?\n" +
      "Paciente: Bastante ansioso, sobre todo antes de las reuniones de trabajo, " +
      "siento que no soy capaz y que voy a fallar.\n" +
      "Doctor: ¿Y lograste identificar qué lo dispara?\n" +
      "Paciente: Creo que es el miedo a que los demás noten que no soy suficiente, " +
      "aunque esta semana logré hablar en una reunión y me sentí más tranquilo después.";

    const provider = new OpenAIAnalysisProvider();
    const { payload: report, provenance, stateDelta } = await provider.analyze(
      bareAnalysisContext(transcript),
    );

    expect(provenance.model).toBe("gpt-4o");
    expect(provenance.promptVersion).toBeTruthy();

    expect(() => reportSchema.parse(report)).not.toThrow();
    expect(report.summary.length).toBeGreaterThan(10);
    expect(report.keywords.length).toBeGreaterThan(0);
    expect(["negativo", "neutral", "positivo"]).toContain(report.sentiment.label);
    expect(report.suggestion.length).toBeGreaterThan(10);
    expect(report.riskFlags).toBeDefined();
    expect(report.riskFlags!.suicidal_ideation.level).toBe("ninguno");

    // El shape ya viene validado por el provider (clinicalStateDeltaSchema.parse
    // dentro de OpenAIAnalysisProvider) — re-validar aquí confirma que la
    // respuesta real de la API sigue cumpliendo el esquema tras cambios de prompt.
    expect(() => clinicalStateDeltaSchema.parse(stateDelta)).not.toThrow();
    // Sin riesgo activo en la transcripción, no debería reportar un riesgo "activo".
    expect(stateDelta.riesgos.every((r) => r.estado !== "activo")).toBe(true);
  }, 30_000);

  it("reusa el texto exacto de un objetivo existente en vez de parafrasearlo", async () => {
    const provider = new OpenAIAnalysisProvider();
    const context = bareAnalysisContext(
      "Doctor: ¿Cómo te fue esta semana practicando lo que hablamos?\n" +
        "Paciente: Mejor. Volví a intentar hablar en las reuniones de trabajo sin sentir " +
        "que iba a fallar, y esta vez me sentí bien conmigo mismo.",
    );
    context.previousState = {
      ...context.previousState,
      objetivos: [
        {
          id: "obj-1",
          texto: "Reducir la ansiedad al hablar en reuniones de trabajo",
          estado: "activo",
          sesionOrigen: "consulta-anterior",
          ultimaMencion: "consulta-anterior",
          evidencia: "me pone muy ansioso hablar frente a mis compañeros",
          confianza: 0.8,
        },
      ],
    };

    const { stateDelta } = await provider.analyze(context);
    const texts = stateDelta.objetivos.map((o) => o.texto.toLowerCase());
    expect(
      texts,
      "el modelo debía reusar el texto EXACTO del objetivo existente para que el merge lo reconozca como continuación, no como uno nuevo",
    ).toContain("reducir la ansiedad al hablar en reuniones de trabajo");
  }, 60_000);
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

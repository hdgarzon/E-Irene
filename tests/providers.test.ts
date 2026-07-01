import { describe, it, expect, beforeEach } from "vitest";
import { getAnalysisProvider, getTranscriptionProvider } from "@/lib/providers";
import { reportSchema } from "@/lib/providers/types";

describe("providers (mock por defecto)", () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.DEEPGRAM_API_KEY;
    delete process.env.ANALYSIS_PROVIDER;
    delete process.env.TRANSCRIPTION_PROVIDER;
  });

  it("sin OPENAI_API_KEY usa el mock de análisis", () => {
    expect(getAnalysisProvider().mode).toBe("mock");
  });

  it("el análisis mock cumple el reportSchema", async () => {
    const r = await getAnalysisProvider().analyze(
      "Me siento muy ansioso por el trabajo, no puedo dormir bien y eso me preocupa mucho.",
    );
    expect(() => reportSchema.parse(r)).not.toThrow();
    expect(r.sentiment.label).toBe("negativo");
    expect(r.keywords.length).toBeGreaterThan(0);
  });

  it("detecta tono positivo", async () => {
    const r = await getAnalysisProvider().analyze(
      "Esta semana me sentí mucho mejor, más tranquilo y feliz; logré un buen avance.",
    );
    expect(r.sentiment.score).toBeGreaterThan(0);
  });

  it("sin indicios de riesgo, todas las categorías quedan en 'ninguno'", async () => {
    const r = await getAnalysisProvider().analyze(
      "Paciente: Esta semana me sentí mucho mejor, más tranquilo y feliz; logré un buen avance.",
    );
    expect(r.riskFlags).toBeDefined();
    for (const flag of Object.values(r.riskFlags!)) {
      expect(flag.level).toBe("ninguno");
      expect(flag.evidence).toBe("");
    }
  });

  it("detecta ideación suicida en las palabras del paciente y adjunta evidencia", async () => {
    const r = await getAnalysisProvider().analyze(
      "Doctor: ¿Cómo te has sentido?\n" +
        "Paciente: La verdad ya no le veo sentido a nada, a veces pienso que quiero morir.",
    );
    expect(r.riskFlags!.suicidal_ideation.level).not.toBe("ninguno");
    expect(r.riskFlags!.suicidal_ideation.evidence).toMatch(/quiero morir/i);
    expect(r.riskFlags!.self_harm.level).toBe("ninguno");
  });

  it("no confunde la pregunta del doctor con una alerta del paciente", async () => {
    const r = await getAnalysisProvider().analyze(
      "Doctor: ¿Alguna vez has pensado en hacerte daño o en el suicidio?\n" +
        "Paciente: No, para nada, nunca he pensado en eso.",
    );
    expect(r.riskFlags!.suicidal_ideation.level).toBe("ninguno");
    expect(r.riskFlags!.self_harm.level).toBe("ninguno");
  });

  it("la sesión de transcripción mock entrega token efímero", async () => {
    const s = await getTranscriptionProvider().createSession("consulta-1");
    expect(s.mode).toBe("mock");
    expect(s.sessionToken).toMatch(/^mock_/);
    expect(s.expiresInMs).toBeGreaterThan(0);
  });
});

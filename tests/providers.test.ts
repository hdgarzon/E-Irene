import { describe, it, expect, beforeEach } from "vitest";
import { getAnalysisProvider, getTranscriptionProvider } from "@/lib/providers";
import { DEEPGRAM_LISTEN_URL, DEEPGRAM_LISTEN_URL_VIDEO } from "@/lib/providers/deepgram";
import { reportSchema } from "@/lib/providers/types";
import { bareAnalysisContext } from "@/lib/clinical-state";

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
    const { payload: r } = await getAnalysisProvider().analyze(
      bareAnalysisContext(
        "Me siento muy ansioso por el trabajo, no puedo dormir bien y eso me preocupa mucho.",
      ),
    );
    expect(() => reportSchema.parse(r)).not.toThrow();
    expect(r.sentiment.label).toBe("negativo");
    expect(r.keywords.length).toBeGreaterThan(0);
  });

  it("detecta tono positivo", async () => {
    const { payload: r } = await getAnalysisProvider().analyze(
      bareAnalysisContext("Esta semana me sentí mucho mejor, más tranquilo y feliz; logré un buen avance."),
    );
    expect(r.sentiment.score).toBeGreaterThan(0);
  });

  it("sin indicios de riesgo, todas las categorías quedan en 'ninguno'", async () => {
    const { payload: r } = await getAnalysisProvider().analyze(
      bareAnalysisContext(
        "Paciente: Esta semana me sentí mucho mejor, más tranquilo y feliz; logré un buen avance.",
      ),
    );
    expect(r.riskFlags).toBeDefined();
    for (const flag of Object.values(r.riskFlags!)) {
      expect(flag.level).toBe("ninguno");
      expect(flag.evidence).toBe("");
    }
  });

  it("detecta ideación suicida en las palabras del paciente y adjunta evidencia", async () => {
    const { payload: r } = await getAnalysisProvider().analyze(
      bareAnalysisContext(
        "Doctor: ¿Cómo te has sentido?\n" +
          "Paciente: La verdad ya no le veo sentido a nada, a veces pienso que quiero morir.",
      ),
    );
    expect(r.riskFlags!.suicidal_ideation.level).not.toBe("ninguno");
    expect(r.riskFlags!.suicidal_ideation.evidence).toMatch(/quiero morir/i);
    expect(r.riskFlags!.self_harm.level).toBe("ninguno");
  });

  it("no confunde la pregunta del doctor con una alerta del paciente", async () => {
    const { payload: r } = await getAnalysisProvider().analyze(
      bareAnalysisContext(
        "Doctor: ¿Alguna vez has pensado en hacerte daño o en el suicidio?\n" +
          "Paciente: No, para nada, nunca he pensado en eso.",
      ),
    );
    expect(r.riskFlags!.suicidal_ideation.level).toBe("ninguno");
    expect(r.riskFlags!.self_harm.level).toBe("ninguno");
  });

  it("todo análisis declara su procedencia (modelo + versión de prompt)", async () => {
    const { provenance } = await getAnalysisProvider().analyze(
      bareAnalysisContext("Paciente: Hola, me siento bien."),
    );
    expect(provenance.model).toBe("mock");
    expect(provenance.promptVersion).toBeTruthy();
    // generatedAt debe ser una fecha ISO parseable — es lo que permite auditar
    // cuándo se produjo la conclusión, distinto de cuándo se escribió en BD.
    expect(Number.isNaN(Date.parse(provenance.generatedAt))).toBe(false);
  });

  it("todo análisis declara un stateDelta (aunque esté vacío)", async () => {
    const { stateDelta } = await getAnalysisProvider().analyze(
      bareAnalysisContext("Paciente: Hola, me siento bien."),
    );
    expect(stateDelta.objetivos).toBeInstanceOf(Array);
    expect(stateDelta.riesgos).toBeInstanceOf(Array);
    expect(stateDelta.temas).toBeInstanceOf(Array);
    expect(stateDelta.hipotesis).toBeInstanceOf(Array);
    expect(stateDelta.tecnicas).toBeInstanceOf(Array);
  });

  it("el mock traduce un riskFlag distinto de 'ninguno' en un riesgo activo del stateDelta", async () => {
    const { stateDelta } = await getAnalysisProvider().analyze(
      bareAnalysisContext(
        "Doctor: ¿Cómo te has sentido?\n" +
          "Paciente: La verdad ya no le veo sentido a nada, a veces pienso que quiero morir.",
      ),
    );
    const riesgo = stateDelta.riesgos.find((r) => r.categoria === "suicidal_ideation");
    expect(riesgo).toBeDefined();
    expect(riesgo!.estado).toBe("activo");
  });

  it("la sesión de transcripción mock entrega token efímero", async () => {
    const s = await getTranscriptionProvider().createSession("consulta-1");
    expect(s.mode).toBe("mock");
    expect(s.sessionToken).toMatch(/^mock_/);
    expect(s.expiresInMs).toBeGreaterThan(0);
  });
});

/**
 * Sin el opt-out, Deepgram persiste el audio para entrenar sus modelos y el
 * consentimiento que firma el paciente pasa a ser falso. Es una garantía legal,
 * no una preferencia: si alguien reescribe la URL, esto tiene que romperse.
 */
describe("Deepgram: opt-out del Model Improvement Program", () => {
  it("la URL de audio in-person no envía datos al programa de mejora", () => {
    expect(DEEPGRAM_LISTEN_URL).toContain("mip_opt_out=true");
  });

  it("la URL de videollamada no envía datos al programa de mejora", () => {
    expect(DEEPGRAM_LISTEN_URL_VIDEO).toContain("mip_opt_out=true");
  });
});

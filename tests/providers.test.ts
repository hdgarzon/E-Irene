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

  it("la sesión de transcripción mock entrega token efímero", async () => {
    const s = await getTranscriptionProvider().createSession("consulta-1");
    expect(s.mode).toBe("mock");
    expect(s.sessionToken).toMatch(/^mock_/);
    expect(s.expiresInMs).toBeGreaterThan(0);
  });
});

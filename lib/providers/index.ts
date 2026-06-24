import type { AnalysisProvider, TranscriptionProvider } from "./types";
import { MockAnalysisProvider, MockTranscriptionProvider } from "./mock";

export * from "./types";

/**
 * Factories env-driven. Por defecto devuelven el mock (la app corre sin keys).
 * Los adaptadores reales (Deepgram/OpenAI) se conectan en planes posteriores:
 * cuando existan, se eligen aquí según `*_PROVIDER` o la presencia de la API key.
 */

export function getAnalysisProvider(): AnalysisProvider {
  const forced = process.env.ANALYSIS_PROVIDER;
  const hasKey = Boolean(process.env.OPENAI_API_KEY);
  if (forced === "mock" || (!hasKey && forced !== "openai")) {
    return new MockAnalysisProvider();
  }
  // TODO(plan-2): return new OpenAIAnalysisProvider() cuando esté implementado.
  return new MockAnalysisProvider();
}

export function getTranscriptionProvider(): TranscriptionProvider {
  const forced = process.env.TRANSCRIPTION_PROVIDER;
  const hasKey = Boolean(process.env.DEEPGRAM_API_KEY);
  if (forced === "mock" || (!hasKey && forced !== "deepgram")) {
    return new MockTranscriptionProvider();
  }
  // TODO(plan-2): return new DeepgramTranscriptionProvider() cuando esté implementado.
  return new MockTranscriptionProvider();
}

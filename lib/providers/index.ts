import type { AnalysisProvider, TranscriptionProvider } from "./types";
import { MockAnalysisProvider, MockTranscriptionProvider } from "./mock";
import { OpenAIAnalysisProvider } from "./openai";
import { DeepgramTranscriptionProvider } from "./deepgram";

export * from "./types";

/**
 * Factories env-driven. Por defecto devuelven el mock (la app corre sin keys).
 * Con `OPENAI_API_KEY`/`DEEPGRAM_API_KEY` configuradas se activan los
 * proveedores reales automáticamente; `*_PROVIDER=mock` fuerza el mock
 * (usado por la suite de regresión E2E para que sea determinista y gratis).
 */

export function getAnalysisProvider(): AnalysisProvider {
  const forced = process.env.ANALYSIS_PROVIDER;
  const hasKey = Boolean(process.env.OPENAI_API_KEY);
  if (forced === "mock" || (!hasKey && forced !== "openai")) {
    return new MockAnalysisProvider();
  }
  return new OpenAIAnalysisProvider();
}

export function getTranscriptionProvider(): TranscriptionProvider {
  const forced = process.env.TRANSCRIPTION_PROVIDER;
  const hasKey = Boolean(process.env.DEEPGRAM_API_KEY);
  if (forced === "mock" || (!hasKey && forced !== "deepgram")) {
    return new MockTranscriptionProvider();
  }
  return new DeepgramTranscriptionProvider();
}

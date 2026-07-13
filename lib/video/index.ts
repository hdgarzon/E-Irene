import type { VideoProvider } from "./types";
import { MockVideoProvider } from "./mock";
import { DailyVideoProvider } from "./daily";

export * from "./types";

/**
 * Sin DAILY_API_KEY: MockVideoProvider (la app corre sin keys). Con la key,
 * se activa Daily.co automáticamente; VIDEO_PROVIDER=mock lo fuerza (usado
 * por la suite E2E, igual que TRANSCRIPTION_PROVIDER/ANALYSIS_PROVIDER).
 */
export function getVideoProvider(): VideoProvider {
  const forced = process.env.VIDEO_PROVIDER;
  const hasKey = Boolean(process.env.DAILY_API_KEY);
  if (forced === "mock" || (!hasKey && forced !== "daily")) {
    return new MockVideoProvider();
  }
  return new DailyVideoProvider();
}

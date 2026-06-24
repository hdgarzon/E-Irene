import type { ReportPayload } from "@/lib/providers/types";

export interface SessionReport {
  date: string;
  payload: ReportPayload;
  consultationId?: string;
}

export interface TrendPoint {
  date: string;
  score: number;
  label: string;
}

/** Puntaje de sentimiento por sesión, en orden cronológico. */
export function sentimentTrend(sessions: SessionReport[]): TrendPoint[] {
  return sessions.map((s) => ({
    date: s.date,
    score: s.payload.sentiment.score,
    label: s.payload.sentiment.label,
  }));
}

/** Keywords agregadas entre sesiones (suma de pesos, normalizado a 0..1). */
export function aggregateKeywords(
  sessions: SessionReport[],
  topN = 15,
): { term: string; weight: number }[] {
  const map = new Map<string, number>();
  for (const s of sessions) {
    for (const k of s.payload.keywords) {
      map.set(k.term, (map.get(k.term) ?? 0) + k.weight);
    }
  }
  const entries = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN);
  const max = entries[0]?.[1] ?? 1;
  return entries.map(([term, w]) => ({ term, weight: Number((w / max).toFixed(2)) }));
}

/** Evolución de una métrica de patrón lingüístico por sesión. */
export function patternTrend(
  sessions: SessionReport[],
  key: string,
): { date: string; value: number }[] {
  return sessions.map((s) => ({ date: s.date, value: s.payload.patterns[key] ?? 0 }));
}

/** Promedio del puntaje de sentimiento. */
export function averageSentiment(sessions: SessionReport[]): number {
  if (sessions.length === 0) return 0;
  const sum = sessions.reduce((acc, s) => acc + s.payload.sentiment.score, 0);
  return Number((sum / sessions.length).toFixed(2));
}

import { randomUUID } from "node:crypto";
import { extractPatientLines, extractPatientText } from "@/lib/transcript-utils";
import type { AnalysisContext, ClinicalStateDelta } from "@/lib/clinical-state";
import type {
  AnalysisProvider,
  AnalysisResult,
  ReportPayload,
  RiskFlags,
  TranscriptionProvider,
  TranscriptionSession,
} from "./types";

/** Bump obligatorio si cambia la heurística de `mockAnalyze` o `mockStateDelta`. */
const MOCK_PROMPT_VERSION = "mock-heuristic-v2";

const POSITIVE = ["bien", "mejor", "tranquilo", "feliz", "logré", "avance", "calma", "esperanza"];
const NEGATIVE = ["ansioso", "triste", "miedo", "angustia", "no puedo", "cansado", "solo", "preocupa"];
const STOPWORDS = new Set([
  "el","la","los","las","un","una","de","del","y","o","a","en","que","se","me","mi","es","con",
  "por","para","su","lo","al","como","más","pero","sus","le","ya","muy","sí","no","yo","te","si",
]);

const RISK_KEYWORDS: Record<keyof RiskFlags, string[]> = {
  suicidal_ideation: [
    "quiero morir", "no quiero vivir", "quitarme la vida", "acabar con todo",
    "suicid", "no vale la pena vivir", "mejor estaria muerto", "mejor estaria muerta",
  ],
  self_harm: ["cortarme", "hacerme daño", "hacerme dano", "autolesion", "lastimarme"],
  substance_use: ["consumo mucho", "trago todos los dias", "cocaina", "marihuana a diario", "borracho todos los dias"],
  risk_to_others: ["hacerle daño a", "hacerle dano a", "matar a", "lastimar a alguien"],
};

function normalizeForMatch(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Detección determinista por palabras clave — solo para el modo demo, sin
 * llamar a ninguna API. El proveedor real (OpenAI) hace el análisis clínico
 * matizado; este mock existe para que la UI y los tests tengan datos
 * consistentes sin depender de una API externa.
 */
function detectRiskFlags(patientLines: string[]): RiskFlags {
  const result = {} as RiskFlags;
  for (const category of Object.keys(RISK_KEYWORDS) as (keyof RiskFlags)[]) {
    const keywords = RISK_KEYWORDS[category];
    const hit = patientLines.find((line) =>
      keywords.some((kw) => normalizeForMatch(line).includes(kw)),
    );
    result[category] = hit
      ? { level: "moderado", evidence: hit.trim() }
      : { level: "ninguno", evidence: "" };
  }
  return result;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zñ\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Genera un reporte plausible y determinista a partir del texto (sin llamar a
 * ninguna API). El análisis se basa en lo que dice el PACIENTE — las
 * intervenciones del doctor (preguntas, indicaciones) se excluyen para que
 * el sentimiento/keywords/patrones reflejen al paciente, no a quien pregunta.
 */
export function mockAnalyze(transcript: string): ReportPayload {
  const patientLines = extractPatientLines(transcript);
  const patientText = extractPatientText(transcript);
  const tokens = tokenize(patientText);
  const total = Math.max(tokens.length, 1);

  let pos = 0;
  let neg = 0;
  let firstPerson = 0;
  let negations = 0;
  let doubts = 0;
  for (const t of tokens) {
    if (POSITIVE.some((w) => t.includes(w))) pos++;
    if (NEGATIVE.some((w) => t.includes(w))) neg++;
    if (["yo", "mi", "me", "conmigo", "mio"].includes(t)) firstPerson++;
    if (["no", "nunca", "nada", "tampoco", "jamas"].includes(t)) negations++;
    if (["quiza", "tal", "creo", "supongo", "no se", "puede"].includes(t)) doubts++;
  }

  const score = Math.max(-1, Math.min(1, (pos - neg) / Math.max(pos + neg, 1)));
  const label = score > 0.15 ? "positivo" : score < -0.15 ? "negativo" : "neutral";

  // Timeline: divide el texto en 5 tramos y puntúa cada uno.
  const chunkSize = Math.ceil(total / 5);
  const timeline = Array.from({ length: 5 }, (_, i) => {
    const slice = tokens.slice(i * chunkSize, (i + 1) * chunkSize);
    const p = slice.filter((t) => POSITIVE.some((w) => t.includes(w))).length;
    const n = slice.filter((t) => NEGATIVE.some((w) => t.includes(w))).length;
    return { position: i / 4, score: Math.max(-1, Math.min(1, (p - n) / Math.max(p + n, 1))) };
  });

  // Keywords por frecuencia (excluyendo stopwords).
  const freq = new Map<string, number>();
  for (const t of tokens) {
    if (t.length < 4 || STOPWORDS.has(t)) continue;
    freq.set(t, (freq.get(t) ?? 0) + 1);
  }
  const ranked = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  const maxFreq = ranked[0]?.[1] ?? 1;
  const keywords = ranked.map(([term, f]) => ({ term, weight: Number((f / maxFreq).toFixed(2)) }));
  const topics = ranked.slice(0, 4).map(([term]) => term);

  return {
    summary:
      `Según lo expresado por el paciente (${total} palabras), el tono general es ${label}. ` +
      `Se identifican ${ranked.length} temas recurrentes` +
      (topics.length ? `, destacando: ${topics.join(", ")}. ` : ". ") +
      "Resumen generado en modo demo; conecta una API de IA para análisis clínico real.",
    sentiment: { score: Number(score.toFixed(2)), label, timeline },
    keywords,
    topics,
    patterns: {
      primera_persona: Number((firstPerson / total).toFixed(3)),
      negaciones: Number((negations / total).toFixed(3)),
      dudas: Number((doubts / total).toFixed(3)),
      intensidad_emocional: Number(((pos + neg) / total).toFixed(3)),
    },
    riskFlags: detectRiskFlags(patientLines),
    suggestion:
      "Sugerencia preliminar (modo demo): observar la evolución del estado de ánimo a lo largo " +
      "de las sesiones y profundizar en los temas recurrentes detectados. " +
      "Esta sugerencia NO constituye un diagnóstico y debe ser validada por el profesional.",
  };
}

/**
 * Delta de estado clínico plausible pero simplista, derivado de lo que el
 * mock ya calculó — no hay inferencia real de objetivos/hipótesis/técnicas
 * (el mock no tiene el juicio clínico para eso), solo riesgos (reusa
 * `detectRiskFlags`) y temas (reusa los `topics` por frecuencia). Suficiente
 * para que el pipeline de estado funcione en modo demo sin API keys.
 */
function mockStateDelta(payload: ReportPayload): ClinicalStateDelta {
  const riesgos = payload.riskFlags
    ? (Object.entries(payload.riskFlags) as [keyof RiskFlags, RiskFlags[keyof RiskFlags]][])
        .filter(([, v]) => v.level !== "ninguno")
        .map(([categoria, v]) => ({
          categoria,
          nivel: v.level,
          evidencia: v.evidence,
          estado: "activo" as const,
        }))
    : [];
  const temas = payload.topics.map((tema) => ({
    tema,
    tendencia: "estable" as const,
    evidencia: "Detectado por frecuencia de palabras (modo demo, sin juicio clínico real).",
  }));
  return { objetivos: [], riesgos, temas, hipotesis: [], tecnicas: [] };
}

export class MockAnalysisProvider implements AnalysisProvider {
  readonly mode = "mock" as const;
  async analyze(context: AnalysisContext): Promise<AnalysisResult> {
    const payload = mockAnalyze(context.transcript);
    return {
      payload,
      stateDelta: mockStateDelta(payload),
      provenance: {
        model: "mock",
        promptVersion: MOCK_PROMPT_VERSION,
        generatedAt: new Date().toISOString(),
      },
    };
  }
}

export class MockTranscriptionProvider implements TranscriptionProvider {
  readonly mode = "mock" as const;
  async createSession(): Promise<TranscriptionSession> {
    return { sessionToken: `mock_${randomUUID()}`, mode: "mock", expiresInMs: 15 * 60 * 1000 };
  }
}

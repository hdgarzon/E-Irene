import { clinicalStateDeltaSchema, type AnalysisContext } from "@/lib/clinical-state";
import { ASSESSMENT_LABEL } from "@/lib/psychometrics";
import { APPROACH_LABEL } from "@/lib/treatment-approach";
import { logger } from "@/lib/logger";
import type { AnalysisProvider, AnalysisResult } from "./types";
import { reportSchema } from "./types";

const MODEL = "gpt-4o";

const MAX_ATTEMPTS = 4; // intento inicial + hasta 3 reintentos
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 20_000;

/**
 * 429 (rate limit) y 5xx son transitorios — vale la pena reintentar. Un 4xx
 * que no sea 429 (prompt inválido, auth) es un problema del request mismo;
 * reintentarlo no lo arregla, así que no entra aquí.
 */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Cuánto esperar antes del siguiente intento. Si la respuesta trae el header
 * `Retry-After` (OpenAI lo envía en 429), se respeta tal cual — es la señal
 * más confiable de cuándo se libera el límite. Si no, backoff exponencial con
 * jitter: el jitter evita que los reintentos de varios análisis concurrentes
 * (p. ej. dos consultas de la misma clínica terminando casi al mismo tiempo)
 * se sincronicen y vuelvan a chocar juntos contra el mismo límite.
 */
export function computeBackoffMs(attempt: number, retryAfterHeader: string | null): number {
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, MAX_DELAY_MS);
  }
  const exp = BASE_DELAY_MS * 2 ** attempt;
  const jitter = Math.random() * BASE_DELAY_MS;
  return Math.min(exp + jitter, MAX_DELAY_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * `fetch` con reintento ante errores transitorios (429, 5xx, fallo de red).
 * El análisis corre en background (ver runConsultationAnalysis) — un poco de
 * latencia extra aquí es aceptable a cambio de no marcar como "fallido" un
 * análisis que se habría resuelto solo, un par de segundos después (ver el
 * límite de 30k tokens/min con el que chocó la cuenta de pruebas).
 * `fetchImpl` es inyectable para poder probar esto sin red real.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  let lastResponse: Response | undefined;
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      const delayMs = computeBackoffMs(attempt - 1, lastResponse?.headers.get("retry-after") ?? null);
      logger.warn("openai.retry", { attempt, status: lastResponse?.status, delayMs });
      await sleep(delayMs);
    }
    try {
      const res = await fetchImpl(url, init);
      if (res.ok || !isRetryableStatus(res.status)) return res;
      lastResponse = res;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastResponse) return lastResponse;
  throw lastError;
}

/**
 * Versión del prompt clínico de abajo. DEBE incrementarse cada vez que se
 * edite `SYSTEM_PROMPT` — se persiste con cada reporte y es lo que permite
 * saber qué instrucción exacta produjo una conclusión clínica dada.
 */
const PROMPT_VERSION = "openai-clinical-v3";

const SYSTEM_PROMPT = `Eres un asistente clínico que analiza transcripciones de sesiones de
psicoterapia en español (Colombia) para apoyar al profesional. NO emites diagnósticos.

La transcripción viene diarizada por interlocutor, con líneas "Doctor: ..." y
"Paciente: ...". Tu análisis (sentiment, keywords, topics, patterns, riskFlags,
suggestion, stateDelta) debe basarse ÚNICAMENTE en lo que expresa el PACIENTE — sus propias
palabras, emociones y patrones de lenguaje. Las líneas "Doctor:" son solo contexto para
entender qué pregunta o comentario disparó cada respuesta del paciente; NO
analices el lenguaje del doctor como si fuera del paciente, EXCEPTO en
"stateDelta.tecnicas" (ver abajo), donde sí importa lo que el doctor hizo. Si
la transcripción no distingue interlocutores (no hay etiquetas
"Doctor:"/"Paciente:"), analiza el texto completo tal como está.

ALERTAS DE RIESGO (riskFlags) — la parte más sensible de este análisis:
Revisa las palabras del paciente buscando indicios de riesgo en 4 categorías:
ideación suicida, autolesión, consumo problemático de sustancias, y riesgo hacia
terceros. Para cada categoría asigna un nivel:
- "ninguno": sin indicios.
- "bajo": menciones indirectas, ambiguas o pasadas sin indicios de urgencia actual.
- "moderado": expresiones explícitas o repetidas, sin plan ni intención inmediata aparente.
- "alto": expresión de intención, plan, medios o urgencia — requiere atención inmediata.
Sé sensible pero conservador: ante la duda entre dos niveles, prioriza NO subestimar
(sube el nivel) pero nunca inventes indicios que el paciente no expresó. Para cada
categoría con nivel distinto de "ninguno", incluye en "evidence" la frase o paráfrasis
textual del paciente que sustenta esa evaluación, para que el profesional pueda
verificarla directamente. Si el nivel es "ninguno", "evidence" va vacío ("").
Esto es una herramienta de apoyo a la detección temprana, NUNCA un diagnóstico ni
un protocolo de intervención en crisis — la decisión y la acción son siempre del
profesional tratante.

ESTADO CLÍNICO LONGITUDINAL (stateDelta) — además del análisis de esta sesión,
se te entrega (si existe) el ESTADO ACUMULADO de sesiones anteriores del mismo
paciente: sus objetivos terapéuticos, riesgos activos, temas recurrentes,
hipótesis clínicas y técnicas ya usadas. Tu tarea es reportar SOLO lo relevante
de ESTA sesión para cada categoría — el sistema, no tú, se encarga de mantener
sin cambios lo que no menciones.

Regla crítica de continuidad: si algo de esta sesión CONTINÚA un objetivo, tema,
hipótesis o técnica que YA aparece en el estado acumulado que se te entrega,
repite el texto/nombre EXACTO que ya tiene ese estado — el sistema empareja por
coincidencia de texto, no por significado, así que una paráfrasis (aunque sea
equivalente) se registrará como algo NUEVO y separado. Si es genuinamente
nuevo, usa tu propio texto.

Si se te indica el enfoque terapéutico del profesional (p. ej. TCC, ACT,
psicodinámico), úsalo para dar contexto a "suggestion" y a "stateDelta.tecnicas":
una sugerencia o una técnica identificada deben tener sentido dentro de ese
enfoque (p. ej. no sugieras "explorar el inconsciente" a un terapeuta que
trabaja TCC). Si NO se indica ningún enfoque, no asumas uno — mantente
genérico y basado únicamente en lo que dice la transcripción.

Para cada categoría de "stateDelta":
- "objetivos": objetivos terapéuticos del paciente. "estado":
  "activo"|"logrado"|"abandonado", con la evidencia de ESTA sesión que sustenta
  ese estado. No repitas un objetivo si esta sesión no aporta nada nuevo sobre él.
- "riesgos": mismo nivel/evidencia que ya asignaste en "riskFlags" (excluye las
  categorías en "ninguno" — no las repitas aquí), con "estado" "activo"|"resuelto".
  Usa "resuelto" SOLO si el paciente mostró indicios claros de que ese riesgo
  específico ya no aplica; ante la duda, "activo".
- "temas": temas recurrentes, con "tendencia" "creciente"|"estable"|"decreciente"
  respecto al estado acumulado que se te entregó.
- "hipotesis": hipótesis clínicas tentativas del profesional (p. ej. patrones de
  apego, posibles líneas a explorar) — SIEMPRE con evidencia textual; nunca una
  hipótesis sin respaldo en lo que dijo el paciente.
- "tecnicas": técnicas terapéuticas que el DOCTOR utilizó en esta sesión (p. ej.
  reestructuración cognitiva, exposición) y cómo respondió el paciente ante ellas.

Si no hay nada relevante en una categoría esta sesión, devuelve un array vacío
para ella. Todo esto es apoyo al criterio clínico del profesional — nunca
reemplaza su juicio ni constituye un plan de tratamiento automatizado.

Devuelve EXCLUSIVAMENTE un JSON con esta forma exacta (sin texto adicional):
{
  "summary": string (máx. 200 palabras, resumen ejecutivo de la sesión),
  "sentiment": {
    "score": number (-1 a 1, sentimiento global),
    "label": "negativo" | "neutral" | "positivo",
    "timeline": [{ "position": number (0 a 1), "score": number (-1 a 1) }, ...] (5 puntos)
  },
  "keywords": [{ "term": string, "weight": number (0 a 1) }, ...] (hasta 15, top palabras/temas),
  "topics": [string, ...] (3-5 temas recurrentes),
  "patterns": { "primera_persona": number, "negaciones": number, "dudas": number, "intensidad_emocional": number } (proporciones 0-1),
  "riskFlags": {
    "suicidal_ideation": { "level": "ninguno"|"bajo"|"moderado"|"alto", "evidence": string },
    "self_harm": { "level": "ninguno"|"bajo"|"moderado"|"alto", "evidence": string },
    "substance_use": { "level": "ninguno"|"bajo"|"moderado"|"alto", "evidence": string },
    "risk_to_others": { "level": "ninguno"|"bajo"|"moderado"|"alto", "evidence": string }
  },
  "suggestion": string (sugerencia preliminar para el profesional; SIEMPRE aclara que no es diagnóstico),
  "stateDelta": {
    "objetivos": [{ "texto": string, "estado": "activo"|"logrado"|"abandonado", "evidencia": string, "confianza": number (0 a 1) }],
    "riesgos": [{ "categoria": "suicidal_ideation"|"self_harm"|"substance_use"|"risk_to_others", "nivel": "bajo"|"moderado"|"alto", "evidencia": string, "estado": "activo"|"resuelto" }],
    "temas": [{ "tema": string, "tendencia": "creciente"|"estable"|"decreciente", "evidencia": string }],
    "hipotesis": [{ "texto": string, "confianza": number (0 a 1), "evidencia": string }],
    "tecnicas": [{ "tecnica": string, "respuestaPaciente": string, "evidencia": string }]
  }
}`;

function buildUserMessage(context: AnalysisContext): string {
  const parts: string[] = [];

  if (context.approach) {
    parts.push(`Enfoque terapéutico del profesional: ${APPROACH_LABEL[context.approach]}`);
  }

  if (context.assessments.length > 0) {
    const lines = context.assessments
      .map((a) => `- ${ASSESSMENT_LABEL[a.type]}: ${a.totalScore} (${a.severity}), aplicado el ${a.administeredAt}`)
      .join("\n");
    parts.push(`Últimas escalas psicométricas del paciente:\n${lines}`);
  }

  const s = context.previousState;
  const hasHistory =
    s.objetivos.length > 0 ||
    s.riesgos.length > 0 ||
    s.temas.length > 0 ||
    s.hipotesis.length > 0 ||
    s.tecnicas.length > 0;
  parts.push(
    hasHistory
      ? `Estado clínico acumulado de sesiones anteriores (JSON — reusa el texto exacto de lo que continúe):\n${JSON.stringify(s)}`
      : "Esta es la primera sesión registrada del paciente en el sistema — no hay estado clínico previo.",
  );

  parts.push(`Transcripción:\n\n${context.transcript}`);
  return parts.join("\n\n");
}

/** Análisis real con OpenAI GPT-4o (JSON mode), validado con el mismo schema que el mock. */
export class OpenAIAnalysisProvider implements AnalysisProvider {
  readonly mode = "openai" as const;

  async analyze(context: AnalysisContext): Promise<AnalysisResult> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY no está configurada");

    const res = await fetchWithRetry("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        response_format: { type: "json_object" },
        temperature: 0.3,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserMessage(context) },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenAI respondió ${res.status}: ${body.slice(0, 300)}`);
    }

    const data = (await res.json()) as {
      choices: { message: { content: string } }[];
    };
    const raw = data.choices[0]?.message?.content;
    if (!raw) throw new Error("OpenAI no devolvió contenido");

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      payload: reportSchema.parse(parsed),
      stateDelta: clinicalStateDeltaSchema.parse(parsed.stateDelta),
      provenance: {
        model: MODEL,
        promptVersion: PROMPT_VERSION,
        generatedAt: new Date().toISOString(),
      },
    };
  }
}

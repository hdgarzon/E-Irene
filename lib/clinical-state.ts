import { randomUUID } from "node:crypto";
import { z } from "zod";
import { riskLevelSchema, type RiskCategory } from "@/lib/risk-levels";
import { normalizeSearchText } from "@/lib/text-normalize";
import type { AssessmentType } from "@/lib/psychometrics";
import type { TherapeuticApproach } from "@/lib/treatment-approach";

const riskCategorySchema = z.enum([
  "suicidal_ideation",
  "self_harm",
  "substance_use",
  "risk_to_others",
]);
const objetivoEstadoSchema = z.enum(["activo", "logrado", "abandonado"]);
const riesgoEstadoSchema = z.enum(["activo", "resuelto"]);
const temaTendenciaSchema = z.enum(["creciente", "estable", "decreciente"]);

// ── Delta: lo que el proveedor de IA observa/reporta de ESTA sesión ───────
//
// Deliberadamente NO incluye ids, sesionOrigen, ultimaMencion ni sesiones
// acumuladas — esos campos son bookkeeping determinista que calcula
// `mergeClinicalState`, nunca algo que se le pida a un LLM. Pedirle a un
// modelo que preserve un id opaco exactamente igual entre llamadas es fráil
// (puede alucinarlo o no repetirlo con precisión); pedirle que repita el
// mismo TEXTO cuando algo continúa es una tarea mucho más natural para él, y
// es lo que el emparejamiento por texto normalizado explota (ver merge más
// abajo).

export const clinicalStateDeltaSchema = z.object({
  objetivos: z.array(
    z.object({
      texto: z.string().min(1),
      estado: objetivoEstadoSchema,
      evidencia: z.string(),
      confianza: z.number().min(0).max(1),
    }),
  ),
  riesgos: z.array(
    z.object({
      categoria: riskCategorySchema,
      nivel: riskLevelSchema,
      evidencia: z.string(),
      estado: riesgoEstadoSchema,
    }),
  ),
  temas: z.array(
    z.object({
      tema: z.string().min(1),
      tendencia: temaTendenciaSchema,
      evidencia: z.string(),
    }),
  ),
  hipotesis: z.array(
    z.object({
      texto: z.string().min(1),
      confianza: z.number().min(0).max(1),
      evidencia: z.string(),
    }),
  ),
  tecnicas: z.array(
    z.object({
      tecnica: z.string().min(1),
      respuestaPaciente: z.string(),
      evidencia: z.string(),
    }),
  ),
});
export type ClinicalStateDelta = z.infer<typeof clinicalStateDeltaSchema>;
type DeltaObjetivo = ClinicalStateDelta["objetivos"][number];
type DeltaRiesgo = ClinicalStateDelta["riesgos"][number];
type DeltaTema = ClinicalStateDelta["temas"][number];
type DeltaHipotesis = ClinicalStateDelta["hipotesis"][number];
type DeltaTecnica = ClinicalStateDelta["tecnicas"][number];

// ── Estado persistido: acumulado a través de todas las sesiones del paciente ──

export const clinicalStateSchema = z.object({
  objetivos: z.array(
    z.object({
      id: z.string(),
      texto: z.string(),
      estado: objetivoEstadoSchema,
      sesionOrigen: z.string(),
      ultimaMencion: z.string(),
      evidencia: z.string(),
      confianza: z.number().min(0).max(1),
    }),
  ),
  riesgos: z.array(
    z.object({
      categoria: riskCategorySchema,
      nivel: riskLevelSchema,
      evidencia: z.string(),
      sesion: z.string(),
      estado: riesgoEstadoSchema,
    }),
  ),
  temas: z.array(
    z.object({
      tema: z.string(),
      sesiones: z.array(z.string()),
      tendencia: temaTendenciaSchema,
      evidencia: z.string(),
    }),
  ),
  hipotesis: z.array(
    z.object({
      texto: z.string(),
      confianza: z.number().min(0).max(1),
      evidencia: z.array(z.string()),
      sesionOrigen: z.string(),
      // A diferencia de objetivos/temas/técnicas, la evidencia de una
      // hipótesis se ACUMULA (array) en vez de reemplazarse — por eso
      // necesita su propio campo de "última sesión que la tocó", separado
      // de `sesionOrigen`. Sin esto no hay forma de saber, dado solo el
      // estado ya materializado, si una hipótesis fue reafirmada en la
      // sesión más reciente (la pregunta que responde el Brief Pre-Sesión).
      ultimaReafirmacion: z.string(),
    }),
  ),
  tecnicas: z.array(
    z.object({
      tecnica: z.string(),
      sesiones: z.array(z.string()),
      respuestaPaciente: z.string(),
      evidencia: z.string(),
    }),
  ),
});
export type ClinicalState = z.infer<typeof clinicalStateSchema>;

export const EMPTY_CLINICAL_STATE: ClinicalState = {
  objetivos: [],
  riesgos: [],
  temas: [],
  hipotesis: [],
  tecnicas: [],
};

// ── Contexto de entrada para el análisis ───────────────────────────────────

export interface LatestAssessment {
  type: AssessmentType;
  totalScore: number;
  severity: string;
  administeredAt: string;
}

export interface AnalysisContext {
  transcript: string;
  /** Estado acumulado hasta ANTES de esta sesión. Vacío en la primera sesión del paciente. */
  previousState: ClinicalState;
  /** Última puntuación de cada escala (PHQ-9/GAD-7) que tenga el paciente, si existen. */
  assessments: LatestAssessment[];
  /** Enfoque terapéutico del plan de tratamiento vigente, si el doctor lo definió (ver lib/treatment-approach.ts). */
  approach?: TherapeuticApproach;
}

/** Contexto mínimo sin historial previo — primera sesión del paciente, o
 * para código que solo necesita analizar una transcripción aislada. */
export function bareAnalysisContext(transcript: string): AnalysisContext {
  return { transcript, previousState: EMPTY_CLINICAL_STATE, assessments: [] };
}

// ── Merge puro: estado anterior + delta de esta sesión → estado nuevo ─────
//
// Identidad de cada entidad = su texto normalizado (minúsculas, sin tildes,
// ver lib/text-normalize.ts), EXCEPTO riesgos, que se identifican por
// `categoria` (hay solo 4, fijas). Es una coincidencia aproximada, no
// semántica: "trabajar la autoestima" y "mejorar la autoestima" se tratan
// como objetivos DISTINTOS si el modelo no repite el texto exacto. El prompt
// (lib/providers/openai.ts) le pide explícitamente al modelo reusar el texto
// tal cual cuando algo continúa — ver la nota en `clinicalStateDeltaSchema`
// arriba. Mejorar esto a un emparejamiento semántico queda para una
// iteración futura, no para esta fase.

export function mergeClinicalState(
  previous: ClinicalState,
  delta: ClinicalStateDelta,
  consultationId: string,
): ClinicalState {
  return {
    objetivos: mergeObjetivos(previous.objetivos, delta.objetivos, consultationId),
    riesgos: mergeRiesgos(previous.riesgos, delta.riesgos, consultationId),
    temas: mergeTemas(previous.temas, delta.temas, consultationId),
    hipotesis: mergeHipotesis(previous.hipotesis, delta.hipotesis, consultationId),
    tecnicas: mergeTecnicas(previous.tecnicas, delta.tecnicas, consultationId),
  };
}

function mergeObjetivos(
  previous: ClinicalState["objetivos"],
  delta: DeltaObjetivo[],
  consultationId: string,
): ClinicalState["objetivos"] {
  const byKey = new Map(previous.map((o) => [normalizeSearchText(o.texto), o] as const));
  for (const d of delta) {
    const key = normalizeSearchText(d.texto);
    const existing = byKey.get(key);
    byKey.set(key, {
      id: existing?.id ?? randomUUID(),
      texto: existing?.texto ?? d.texto,
      estado: d.estado,
      evidencia: d.evidencia,
      confianza: d.confianza,
      sesionOrigen: existing?.sesionOrigen ?? consultationId,
      ultimaMencion: consultationId,
    });
  }
  return [...byKey.values()];
}

function mergeRiesgos(
  previous: ClinicalState["riesgos"],
  delta: DeltaRiesgo[],
  consultationId: string,
): ClinicalState["riesgos"] {
  const byCategory = new Map(previous.map((r) => [r.categoria, r] as const));
  for (const d of delta) {
    byCategory.set(d.categoria, {
      categoria: d.categoria,
      nivel: d.nivel,
      evidencia: d.evidencia,
      estado: d.estado,
      sesion: consultationId,
    });
  }
  return [...byCategory.values()];
}

function mergeTemas(
  previous: ClinicalState["temas"],
  delta: DeltaTema[],
  consultationId: string,
): ClinicalState["temas"] {
  const byKey = new Map(previous.map((t) => [normalizeSearchText(t.tema), t] as const));
  for (const d of delta) {
    const key = normalizeSearchText(d.tema);
    const existing = byKey.get(key);
    const sesiones = existing ? [...existing.sesiones] : [];
    if (!sesiones.includes(consultationId)) sesiones.push(consultationId);
    byKey.set(key, {
      tema: existing?.tema ?? d.tema,
      sesiones,
      tendencia: d.tendencia,
      evidencia: d.evidencia,
    });
  }
  return [...byKey.values()];
}

function mergeHipotesis(
  previous: ClinicalState["hipotesis"],
  delta: DeltaHipotesis[],
  consultationId: string,
): ClinicalState["hipotesis"] {
  const byKey = new Map(previous.map((h) => [normalizeSearchText(h.texto), h] as const));
  for (const d of delta) {
    const key = normalizeSearchText(d.texto);
    const existing = byKey.get(key);
    byKey.set(key, {
      texto: existing?.texto ?? d.texto,
      confianza: d.confianza,
      evidencia: existing ? [...existing.evidencia, d.evidencia] : [d.evidencia],
      sesionOrigen: existing?.sesionOrigen ?? consultationId,
      ultimaReafirmacion: consultationId,
    });
  }
  return [...byKey.values()];
}

function mergeTecnicas(
  previous: ClinicalState["tecnicas"],
  delta: DeltaTecnica[],
  consultationId: string,
): ClinicalState["tecnicas"] {
  const byKey = new Map(previous.map((t) => [normalizeSearchText(t.tecnica), t] as const));
  for (const d of delta) {
    const key = normalizeSearchText(d.tecnica);
    const existing = byKey.get(key);
    const sesiones = existing ? [...existing.sesiones] : [];
    if (!sesiones.includes(consultationId)) sesiones.push(consultationId);
    byKey.set(key, {
      tecnica: existing?.tecnica ?? d.tecnica,
      sesiones,
      respuestaPaciente: d.respuestaPaciente,
      evidencia: d.evidencia,
    });
  }
  return [...byKey.values()];
}

// ── Lectura para el Brief Pre-Sesión ───────────────────────────────────────

export interface ClinicalStateChanges {
  objetivos: ClinicalState["objetivos"];
  riesgos: ClinicalState["riesgos"];
  temas: ClinicalState["temas"];
  hipotesis: ClinicalState["hipotesis"];
  tecnicas: ClinicalState["tecnicas"];
}

/**
 * Filtra el estado acumulado a solo lo que se tocó en `consultationId` —
 * "qué cambió desde la sesión anterior", el primer bloque del Brief
 * Pre-Sesión. Es una lectura PURA del estado ya materializado: no llama a
 * ningún proveedor de IA (decisión locked del spec §2 — el brief lee, no
 * genera) ni recalcula nada, solo separa "tocado en la última sesión" de
 * "acumulado de antes".
 */
export function whatsNewInSession(state: ClinicalState, consultationId: string): ClinicalStateChanges {
  return {
    objetivos: state.objetivos.filter((o) => o.ultimaMencion === consultationId),
    riesgos: state.riesgos.filter((r) => r.sesion === consultationId),
    temas: state.temas.filter((t) => t.sesiones[t.sesiones.length - 1] === consultationId),
    hipotesis: state.hipotesis.filter((h) => h.ultimaReafirmacion === consultationId),
    tecnicas: state.tecnicas.filter((t) => t.sesiones[t.sesiones.length - 1] === consultationId),
  };
}

// Re-exportado por conveniencia — módulos que solo necesitan la categoría de
// riesgo no deberían tener que saber que vive en lib/risk-levels.ts.
export type { RiskCategory };

import { describe, it, expect } from "vitest";
import {
  mergeClinicalState,
  whatsNewInSession,
  bareAnalysisContext,
  EMPTY_CLINICAL_STATE,
  type ClinicalState,
  type ClinicalStateDelta,
} from "@/lib/clinical-state";

function delta(overrides: Partial<ClinicalStateDelta>): ClinicalStateDelta {
  return { objetivos: [], riesgos: [], temas: [], hipotesis: [], tecnicas: [], ...overrides };
}

describe("mergeClinicalState — objetivos", () => {
  it("un objetivo nuevo se agrega con id propio y ambas fechas de sesión iguales a la consulta actual", () => {
    const next = mergeClinicalState(
      EMPTY_CLINICAL_STATE,
      delta({
        objetivos: [
          { texto: "Reducir la ansiedad social", estado: "activo", evidencia: "me cuesta hablar en público", confianza: 0.7 },
        ],
      }),
      "consulta-1",
    );
    expect(next.objetivos).toHaveLength(1);
    expect(next.objetivos[0].id).toBeTruthy();
    expect(next.objetivos[0].sesionOrigen).toBe("consulta-1");
    expect(next.objetivos[0].ultimaMencion).toBe("consulta-1");
  });

  it("un objetivo con el MISMO texto normalizado (mayúsculas/tildes distintas) se trata como continuación, no como uno nuevo", () => {
    const first = mergeClinicalState(
      EMPTY_CLINICAL_STATE,
      delta({
        objetivos: [
          { texto: "Reducir la ansiedad social", estado: "activo", evidencia: "evidencia 1", confianza: 0.6 },
        ],
      }),
      "consulta-1",
    );
    const second = mergeClinicalState(
      first,
      delta({
        // Mismo objetivo, mayúsculas/acentuación distinta — debe matchear por normalizeSearchText.
        objetivos: [
          { texto: "REDUCIR LA ANSIEDAD SÓCIAL", estado: "logrado", evidencia: "evidencia 2", confianza: 0.9 },
        ],
      }),
      "consulta-2",
    );
    expect(second.objetivos).toHaveLength(1);
    expect(second.objetivos[0].id).toBe(first.objetivos[0].id);
    // El texto ORIGINAL se preserva — no se sobreescribe con la variante del delta.
    expect(second.objetivos[0].texto).toBe("Reducir la ansiedad social");
    expect(second.objetivos[0].sesionOrigen).toBe("consulta-1");
    expect(second.objetivos[0].ultimaMencion).toBe("consulta-2");
    expect(second.objetivos[0].estado).toBe("logrado");
  });

  it("un objetivo del estado anterior que NO aparece en el delta se preserva sin cambios", () => {
    const first = mergeClinicalState(
      EMPTY_CLINICAL_STATE,
      delta({ objetivos: [{ texto: "Dormir mejor", estado: "activo", evidencia: "e", confianza: 0.5 }] }),
      "consulta-1",
    );
    const second = mergeClinicalState(first, delta({}), "consulta-2");
    expect(second.objetivos).toEqual(first.objetivos);
  });
});

describe("mergeClinicalState — riesgos", () => {
  it("se identifica por categoría — como máximo una entrada activa por categoría", () => {
    const first = mergeClinicalState(
      EMPTY_CLINICAL_STATE,
      delta({
        riesgos: [{ categoria: "suicidal_ideation", nivel: "moderado", evidencia: "e1", estado: "activo" }],
      }),
      "consulta-1",
    );
    const second = mergeClinicalState(
      first,
      delta({
        riesgos: [{ categoria: "suicidal_ideation", nivel: "alto", evidencia: "e2", estado: "activo" }],
      }),
      "consulta-2",
    );
    expect(second.riesgos).toHaveLength(1);
    expect(second.riesgos[0].nivel).toBe("alto");
    expect(second.riesgos[0].sesion).toBe("consulta-2");
  });

  it("un riesgo se marca 'resuelto' explícitamente, no se asume por defecto", () => {
    const first = mergeClinicalState(
      EMPTY_CLINICAL_STATE,
      delta({ riesgos: [{ categoria: "self_harm", nivel: "moderado", evidencia: "e1", estado: "activo" }] }),
      "consulta-1",
    );
    // Sesión siguiente no menciona el riesgo — debe seguir "activo" (nunca se asume resuelto).
    const untouched = mergeClinicalState(first, delta({}), "consulta-2");
    expect(untouched.riesgos[0].estado).toBe("activo");

    const resolved = mergeClinicalState(
      untouched,
      delta({ riesgos: [{ categoria: "self_harm", nivel: "ninguno", evidencia: "e3", estado: "resuelto" }] }),
      "consulta-3",
    );
    expect(resolved.riesgos[0].estado).toBe("resuelto");
  });
});

describe("mergeClinicalState — temas y técnicas (acumulan sesiones)", () => {
  it("un tema mencionado en dos sesiones acumula ambos ids sin duplicarse si se repite en la misma sesión", () => {
    const first = mergeClinicalState(
      EMPTY_CLINICAL_STATE,
      delta({ temas: [{ tema: "trabajo", tendencia: "estable", evidencia: "e1" }] }),
      "consulta-1",
    );
    const second = mergeClinicalState(
      first,
      delta({ temas: [{ tema: "Trabajo", tendencia: "creciente", evidencia: "e2" }] }),
      "consulta-2",
    );
    expect(second.temas[0].sesiones).toEqual(["consulta-1", "consulta-2"]);
    expect(second.temas[0].tendencia).toBe("creciente");
  });

  it("una técnica acumula sesiones en orden cronológico (el merge nunca reordena)", () => {
    const first = mergeClinicalState(
      EMPTY_CLINICAL_STATE,
      delta({
        tecnicas: [{ tecnica: "Reestructuración cognitiva", respuestaPaciente: "receptivo", evidencia: "e1" }],
      }),
      "consulta-1",
    );
    const second = mergeClinicalState(
      first,
      delta({
        tecnicas: [{ tecnica: "reestructuración cognitiva", respuestaPaciente: "muy receptivo", evidencia: "e2" }],
      }),
      "consulta-2",
    );
    expect(second.tecnicas[0].sesiones).toEqual(["consulta-1", "consulta-2"]);
    expect(second.tecnicas[0].respuestaPaciente).toBe("muy receptivo");
  });
});

describe("mergeClinicalState — hipótesis (evidencia acumulativa)", () => {
  it("una hipótesis reafirmada ACUMULA evidencia en vez de reemplazarla, y actualiza ultimaReafirmacion", () => {
    const first = mergeClinicalState(
      EMPTY_CLINICAL_STATE,
      delta({ hipotesis: [{ texto: "Posible patrón de apego evitativo", confianza: 0.4, evidencia: "e1" }] }),
      "consulta-1",
    );
    const second = mergeClinicalState(
      first,
      delta({ hipotesis: [{ texto: "posible patrón de apego evitativo", confianza: 0.7, evidencia: "e2" }] }),
      "consulta-2",
    );
    expect(second.hipotesis).toHaveLength(1);
    expect(second.hipotesis[0].evidencia).toEqual(["e1", "e2"]);
    expect(second.hipotesis[0].confianza).toBe(0.7);
    expect(second.hipotesis[0].sesionOrigen).toBe("consulta-1");
    expect(second.hipotesis[0].ultimaReafirmacion).toBe("consulta-2");
  });
});

describe("whatsNewInSession", () => {
  const baseState: ClinicalState = {
    objetivos: [
      {
        id: "o1",
        texto: "Objetivo viejo",
        estado: "activo",
        sesionOrigen: "consulta-1",
        ultimaMencion: "consulta-1",
        evidencia: "e",
        confianza: 0.5,
      },
      {
        id: "o2",
        texto: "Objetivo tocado hoy",
        estado: "activo",
        sesionOrigen: "consulta-1",
        ultimaMencion: "consulta-2",
        evidencia: "e",
        confianza: 0.5,
      },
    ],
    riesgos: [
      { categoria: "substance_use", nivel: "moderado", evidencia: "e", sesion: "consulta-2", estado: "activo" },
    ],
    temas: [
      { tema: "familia", sesiones: ["consulta-1"], tendencia: "estable", evidencia: "e" },
      { tema: "trabajo", sesiones: ["consulta-1", "consulta-2"], tendencia: "creciente", evidencia: "e" },
    ],
    hipotesis: [
      {
        texto: "hipótesis vieja",
        confianza: 0.5,
        evidencia: ["e1"],
        sesionOrigen: "consulta-1",
        ultimaReafirmacion: "consulta-1",
      },
    ],
    tecnicas: [],
  };

  it("filtra cada categoría a solo lo tocado en la consulta indicada", () => {
    const changes = whatsNewInSession(baseState, "consulta-2");
    expect(changes.objetivos.map((o) => o.id)).toEqual(["o2"]);
    expect(changes.riesgos).toHaveLength(1);
    expect(changes.temas.map((t) => t.tema)).toEqual(["trabajo"]);
    expect(changes.hipotesis).toEqual([]);
  });

  it("una consulta que no tocó nada devuelve todas las categorías vacías", () => {
    const changes = whatsNewInSession(baseState, "consulta-inexistente");
    expect(changes.objetivos).toEqual([]);
    expect(changes.riesgos).toEqual([]);
    expect(changes.temas).toEqual([]);
    expect(changes.hipotesis).toEqual([]);
    expect(changes.tecnicas).toEqual([]);
  });
});

describe("bareAnalysisContext", () => {
  it("produce un contexto sin historial previo", () => {
    const ctx = bareAnalysisContext("hola");
    expect(ctx.transcript).toBe("hola");
    expect(ctx.previousState).toEqual(EMPTY_CLINICAL_STATE);
    expect(ctx.assessments).toEqual([]);
  });
});

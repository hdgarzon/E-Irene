import { describe, it, expect } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { classifyAnalysisError, summarizeAnalysisHealth } from "@/lib/analysis-health";
import { getAnalysisHealth } from "@/lib/db/analysis-health";

// Guarda de entorno: aborta si NEXT_PUBLIC_SUPABASE_URL no apunta a un stack local.
import "./helpers/supabase-env";

// El mensaje tal como lo guardó runConsultationAnalysis el 14-sep-2026, cuando la
// cuenta de OpenAI se quedó sin créditos.
const SIN_CREDITOS = `OpenAI respondió 429: {
    "error": {
        "message": "You have no credits remaining. Add credits to continue using the API.",
        "type": "insufficient_quota",
        "param": null,
        "code": "credit_balance_exhausted"
    }
}`;
const LIMITE_POR_MINUTO = `OpenAI respondió 429: {"error":{"message":"Rate limit reached for gpt-4o on tokens per min (TPM)","type":"tokens","code":"rate_limit_exceeded"}}`;

describe("causa de un análisis fallido", () => {
  it("distingue la cuota agotada del límite por minuto, aunque los dos lleguen como 429", () => {
    expect(classifyAnalysisError(SIN_CREDITOS)).toBe("quota");
    expect(classifyAnalysisError(LIMITE_POR_MINUTO)).toBe("rate_limit");
  });

  it("reconoce clave rechazada, proveedor caído y clave sin configurar", () => {
    expect(classifyAnalysisError("OpenAI respondió 401: invalid_api_key")).toBe("credentials");
    expect(classifyAnalysisError("OpenAI respondió 503: upstream")).toBe("provider_error");
    expect(classifyAnalysisError("OpenAI no devolvió contenido")).toBe("provider_error");
    expect(classifyAnalysisError("fetch failed")).toBe("provider_error");
    expect(classifyAnalysisError("OPENAI_API_KEY no está configurada")).toBe("not_configured");
  });

  it("lo que no reconoce queda como otro error", () => {
    expect(classifyAnalysisError("No hay transcripción para analizar.")).toBe("other");
    expect(classifyAnalysisError(null)).toBe("other");
  });
});

describe("resumen de la salud del análisis", () => {
  const base = {
    failedLast24h: 0,
    failedLast7d: 0,
    recentErrors: [] as string[],
    lastFailureAt: null,
    lastSuccessAt: null,
  };

  it("sin fallos, todo en orden", () => {
    const health = summarizeAnalysisHealth({ ...base, lastSuccessAt: "2026-09-14T10:00:00Z" });
    expect(health.state).toBe("ok");
    expect(health.causes).toEqual([]);
  });

  it("si el último intento falló después del último éxito, está fallando", () => {
    const health = summarizeAnalysisHealth({
      ...base,
      failedLast24h: 2,
      failedLast7d: 3,
      recentErrors: [SIN_CREDITOS, SIN_CREDITOS, "OpenAI respondió 503: upstream"],
      lastFailureAt: "2026-09-14T12:00:00.123456+00:00",
      lastSuccessAt: "2026-09-12T08:00:00.654321+00:00",
    });
    expect(health.state).toBe("failing");
    expect(health.causes).toEqual([
      { cause: "quota", count: 2 },
      { cause: "provider_error", count: 1 },
    ]);
    expect(health.causesSampled).toBe(false);
  });

  it("un fallo sin ningún éxito en la historia también es estar fallando", () => {
    const health = summarizeAnalysisHealth({
      ...base,
      failedLast7d: 1,
      recentErrors: [SIN_CREDITOS],
      lastFailureAt: "2026-09-14T12:00:00Z",
    });
    expect(health.state).toBe("failing");
  });

  it("el último fallo cuenta aunque haya quedado fuera de la ventana de 7 días", () => {
    const health = summarizeAnalysisHealth({
      ...base,
      lastFailureAt: "2026-09-01T12:00:00Z",
      lastSuccessAt: "2026-08-30T12:00:00Z",
    });
    expect(health.state).toBe("failing");
  });

  it("con un éxito posterior al último fallo, se recuperó", () => {
    const health = summarizeAnalysisHealth({
      ...base,
      failedLast7d: 1,
      recentErrors: [LIMITE_POR_MINUTO],
      lastFailureAt: "2026-09-13T12:00:00Z",
      lastSuccessAt: "2026-09-14T09:00:00Z",
    });
    expect(health.state).toBe("recovered");
  });

  it("avisa cuando las causas salen de una muestra", () => {
    const health = summarizeAnalysisHealth({
      ...base,
      failedLast7d: 900,
      recentErrors: Array(500).fill(SIN_CREDITOS),
      lastFailureAt: "2026-09-14T12:00:00Z",
    });
    expect(health.causesSampled).toBe(true);
  });

  it("nunca devuelve el texto del error: puede traer contenido clínico", () => {
    const health = summarizeAnalysisHealth({
      ...base,
      failedLast7d: 1,
      recentErrors: ["Respuesta inválida del modelo: 'Paciente Demo refiere ideación'"],
      lastFailureAt: "2026-09-14T12:00:00Z",
    });
    expect(JSON.stringify(health)).not.toContain("Paciente Demo");
    expect(health.causes).toEqual([{ cause: "other", count: 1 }]);
  });
});

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const d = URL && SERVICE ? describe : describe.skip;

function svc(): SupabaseClient {
  return createClient(URL!, SERVICE!, { auth: { autoRefreshToken: false, persistSession: false } });
}

const hace = (horas: number) => new Date(Date.now() - horas * 3600000).toISOString();

async function clinicaDePrueba(s: SupabaseClient): Promise<string> {
  const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { data, error } = await s
    .from("clinics")
    .insert({ name: "Clínica Análisis", slug: `analisis-${sufijo}` })
    .select("id")
    .single();
  expect(error).toBeNull();
  return data!.id as string;
}

async function evento(
  s: SupabaseClient,
  clinicId: string,
  action: "report.generated" | "report.generation_failed",
  createdAt: string,
  error?: string,
) {
  const { error: insertError } = await s.from("audit_logs").insert({
    clinic_id: clinicId,
    action,
    entity_type: "consultation",
    metadata: error ? { error } : {},
    created_at: createdAt,
  });
  expect(insertError).toBeNull();
}

// Cada prueba lee solo su clínica: otras suites escriben en audit_logs en paralelo.
d("salud del análisis leída de audit_logs", () => {
  it("cuenta por ventana, clasifica la causa y detecta que sigue fallando", async () => {
    const s = svc();
    const clinicId = await clinicaDePrueba(s);
    await evento(s, clinicId, "report.generated", hace(72));
    await evento(s, clinicId, "report.generation_failed", hace(48), "OpenAI respondió 503: upstream");
    await evento(s, clinicId, "report.generation_failed", hace(2), SIN_CREDITOS);
    await evento(s, clinicId, "report.generation_failed", hace(1), SIN_CREDITOS);
    // Fuera de la ventana de 7 días.
    await evento(s, clinicId, "report.generation_failed", hace(24 * 9), SIN_CREDITOS);

    const health = await getAnalysisHealth({ clinicId });

    expect(health.failedLast24h).toBe(2);
    expect(health.failedLast7d).toBe(3);
    expect(health.state).toBe("failing");
    expect(health.causes[0]).toEqual({ cause: "quota", count: 2 });
    expect(health.lastSuccessAt).not.toBeNull();
  }, 30000);

  it("un análisis exitoso después del último fallo deja el estado en recuperado", async () => {
    const s = svc();
    const clinicId = await clinicaDePrueba(s);
    await evento(s, clinicId, "report.generation_failed", hace(5), LIMITE_POR_MINUTO);
    await evento(s, clinicId, "report.generated", hace(1));

    const health = await getAnalysisHealth({ clinicId });

    expect(health.state).toBe("recovered");
    expect(health.failedLast24h).toBe(1);
  }, 30000);

  it("sin eventos no hay nada que reportar", async () => {
    const s = svc();
    const clinicId = await clinicaDePrueba(s);

    const health = await getAnalysisHealth({ clinicId });

    expect(health).toMatchObject({
      state: "ok",
      failedLast24h: 0,
      failedLast7d: 0,
      lastFailureAt: null,
      lastSuccessAt: null,
    });
  }, 30000);
});

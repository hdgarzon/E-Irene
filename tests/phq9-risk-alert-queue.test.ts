import { describe, it, expect, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { encrypt } from "@/lib/crypto";
import {
  acknowledgeRiskAlert,
  alertOnRiskyAssessment,
  listOpenRiskAlerts,
  reconcilePendingPhq9RiskAlerts,
} from "@/lib/db/risk-alerts";

// Guarda de entorno: importar esto aborta la corrida si NEXT_PUBLIC_SUPABASE_URL
// no apunta a un stack local. Estas pruebas escriben con service-role y algunas
// purgan datos clínicos: contra producción serían destructivas.
import "./helpers/supabase-env";

/**
 * Alertas PHQ-9 autorreportadas en `risk_alerts` (migraciones 0026 y 0045):
 * la conciliación que las registra, la cola del dashboard y el acuse de recibo.
 * Igual que rls.test.ts, solo corre contra un Supabase local con migraciones.
 *
 * listOpenRiskAlerts y acknowledgeRiskAlert usan el cliente de sesión (cookies
 * de Next). Aquí esa sesión es la del usuario de prueba asignado en cada caso:
 * mismo JWT y mismas políticas RLS que en la app.
 */
const session = vi.hoisted(() => ({ client: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    if (!session.client) throw new Error("Prueba sin sesión asignada");
    return session.client;
  },
}));

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const d = URL && ANON && SERVICE ? describe : describe.skip;

const SIN_RIESGO = [2, 2, 2, 1, 1, 1, 0, 0, 0];
const CON_RIESGO = [1, 1, 1, 1, 1, 1, 1, 1, 2];

const hace = (dias: number) => new Date(Date.now() - dias * 86400000).toISOString();

function anon(): SupabaseClient {
  return createClient(URL!, ANON!, { auth: { autoRefreshToken: false, persistSession: false } });
}

function service(): SupabaseClient {
  return createClient(URL!, SERVICE!, { auth: { autoRefreshToken: false, persistSession: false } });
}

interface Clinica {
  clinicId: string;
  patientId: string;
  linkId: string;
}

interface ClinicaConSesion extends Clinica {
  client: SupabaseClient;
  userId: string;
}

/** Paciente sintético y un link de PHQ-9 ya respondido. */
async function pacienteConLink(clinicId: string, createdBy: string): Promise<Clinica> {
  const s = service();
  const { data: patient, error: pErr } = await s
    .from("patients")
    .insert({ clinic_id: clinicId, full_name_enc: encrypt("Paciente Demo") })
    .select("id")
    .single();
  expect(pErr).toBeNull();
  const { data: link, error: lErr } = await s
    .from("patient_links")
    .insert({
      clinic_id: clinicId,
      patient_id: patient!.id,
      purpose: "assessment",
      assessment_type: "phq9",
      token_hash: createHash("sha256").update(randomUUID()).digest("hex"),
      expires_at: hace(-7),
      completed_at: new Date().toISOString(),
      created_by: createdBy,
    })
    .select("id")
    .single();
  expect(lErr).toBeNull();
  return { clinicId, patientId: patient!.id as string, linkId: link!.id as string };
}

/** Clínica con su admin verificado: RLS solo deja acusar recibo a admin/doctor. */
async function clinica(nombre: string): Promise<ClinicaConSesion> {
  const client = anon();
  const email = `phq9_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@e-irene.test`;
  const { data: signUp, error: signErr } = await client.auth.signUp({ email, password: "Password123!" });
  expect(signErr).toBeNull();
  const userId = signUp.user!.id;
  const { data: clinicId, error: rpcErr } = await client.rpc("create_clinic_and_admin", {
    clinic_name: nombre,
    full_name: "Doctor Demo",
  });
  expect(rpcErr).toBeNull();
  const { error: vErr } = await service()
    .from("users")
    .update({ verification_status: "verified" })
    .eq("id", userId);
  expect(vErr).toBeNull();
  return { ...(await pacienteConLink(clinicId as string, userId)), client, userId };
}

/** Clínica con solo secretaría: no hay admin ni doctor a quien avisar por correo. */
async function clinicaSinDoctores(): Promise<Clinica> {
  const s = service();
  const email = `phq9_sec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@e-irene.test`;
  const { data: auth, error: authErr } = await s.auth.admin.createUser({
    email,
    password: "Password123!",
    email_confirm: true,
  });
  expect(authErr).toBeNull();
  const { data: clinic, error: cErr } = await s
    .from("clinics")
    .insert({
      name: "Clínica Demo sin doctores",
      slug: `sin-doctores-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    })
    .select("id")
    .single();
  expect(cErr).toBeNull();
  const { error: uErr } = await s.from("users").insert({
    id: auth.user!.id,
    clinic_id: clinic!.id,
    role: "secretaria",
    full_name: "Secretaría Demo",
    email,
  });
  expect(uErr).toBeNull();
  return pacienteConLink(clinic!.id as string, auth.user!.id);
}

async function phq9(
  c: Clinica,
  answers: number[],
  opts: { viaLink?: boolean; administeredAt?: string; payloadEnc?: string } = {},
): Promise<string> {
  const { data, error } = await service()
    .from("psychometric_assessments")
    .insert({
      clinic_id: c.clinicId,
      patient_id: c.patientId,
      link_id: opts.viaLink === false ? null : c.linkId,
      type: "phq9",
      payload_enc:
        opts.payloadEnc ??
        encrypt(
          JSON.stringify({ answers, totalScore: answers.reduce((a, b) => a + b, 0), severity: "Demo" }),
        ),
      administered_at: opts.administeredAt ?? new Date().toISOString(),
    })
    .select("id")
    .single();
  expect(error).toBeNull();
  return data!.id as string;
}

async function alertasDe(clinicId: string) {
  const { data, error } = await service()
    .from("risk_alerts")
    .select("id, source, assessment_id, consultation_id, doctor_id, created_at, acknowledged_at, acknowledged_by")
    .eq("clinic_id", clinicId);
  expect(error).toBeNull();
  return data!;
}

async function marcaDe(assessmentId: string): Promise<string | null> {
  const { data, error } = await service()
    .from("psychometric_assessments")
    .select("risk_evaluated_at")
    .eq("id", assessmentId)
    .single();
  expect(error).toBeNull();
  return data!.risk_evaluated_at as string | null;
}

d("conciliación de alertas PHQ-9 (backfill)", () => {
  it("registra una alerta por cada PHQ-9 de riesgo pendiente, y una segunda pasada no crea nada", async () => {
    const c = await clinica("Clínica Demo Conciliación");
    const fechaHistorico = hace(40);
    const historico = await phq9(c, CON_RIESGO, { administeredAt: fechaHistorico });
    const sinRiesgo = await phq9(c, SIN_RIESGO);
    const presencial = await phq9(c, CON_RIESGO, { viaLink: false });
    const ilegible = await phq9(c, CON_RIESGO, { payloadEnc: "no-es-un-payload-cifrado" });
    // Ya tenía su alerta pero no la marca: todo lo enviado entre 0026 y 0045.
    const yaAlertado = await phq9(c, CON_RIESGO);
    const { data: previa, error } = await service()
      .from("risk_alerts")
      .insert({
        clinic_id: c.clinicId,
        source: "phq9_self_report",
        assessment_id: yaAlertado,
        patient_id: c.patientId,
        doctor_id: c.userId,
        categories_enc: encrypt(JSON.stringify([{ key: "self_harm", level: "alto", evidence: "Demo" }])),
      })
      .select("id")
      .single();
    expect(error).toBeNull();

    expect(await reconcilePendingPhq9RiskAlerts(c.clinicId)).toEqual({
      evaluated: 3,
      created: 1,
      failed: 1,
    });

    const alertas = await alertasDe(c.clinicId);
    expect(alertas).toHaveLength(2);
    const nueva = alertas.find((a) => a.assessment_id === historico)!;
    expect(nueva).toMatchObject({
      source: "phq9_self_report",
      consultation_id: null,
      doctor_id: null,
      acknowledged_at: null,
    });
    // Conserva la fecha del envío del paciente, no la de la conciliación.
    expect(new Date(nueva.created_at).getTime()).toBe(new Date(fechaHistorico).getTime());
    expect(alertas.find((a) => a.assessment_id === yaAlertado)!.id).toBe(previa!.id);

    expect(await marcaDe(historico)).not.toBeNull();
    expect(await marcaDe(sinRiesgo)).not.toBeNull();
    expect(await marcaDe(yaAlertado)).not.toBeNull();
    // Ilegible: sigue pendiente. Nunca se da por "sin riesgo".
    expect(await marcaDe(ilegible)).toBeNull();
    // Aplicado por el personal, sin link: fuera de esta fuente, igual que antes.
    expect(await marcaDe(presencial)).toBeNull();

    expect(await reconcilePendingPhq9RiskAlerts(c.clinicId)).toEqual({
      evaluated: 0,
      created: 0,
      failed: 1,
    });
    expect(await alertasDe(c.clinicId)).toHaveLength(2);
  }, 30000);

  it("no reabre ni duplica una alerta acusada aunque su PHQ-9 vuelva a quedar pendiente", async () => {
    const c = await clinica("Clínica Demo Acusada");
    const evaluacion = await phq9(c, CON_RIESGO);
    expect(await reconcilePendingPhq9RiskAlerts(c.clinicId)).toMatchObject({ created: 1 });
    const [alerta] = await alertasDe(c.clinicId);

    const s = service();
    await s
      .from("risk_alerts")
      .update({ acknowledged_at: new Date().toISOString(), acknowledged_by: c.userId })
      .eq("id", alerta.id);
    // Caída entre registrar la alerta y poner la marca.
    await s.from("psychometric_assessments").update({ risk_evaluated_at: null }).eq("id", evaluacion);

    expect(await reconcilePendingPhq9RiskAlerts(c.clinicId)).toEqual({
      evaluated: 1,
      created: 0,
      failed: 0,
    });
    const alertas = await alertasDe(c.clinicId);
    expect(alertas).toHaveLength(1);
    expect(alertas[0]).toMatchObject({ id: alerta.id, acknowledged_by: c.userId });
    expect(alertas[0].acknowledged_at).not.toBeNull();
  }, 30000);

  it("solo concilia la clínica indicada", async () => {
    const propia = await clinica("Clínica Demo Propia");
    const ajena = await clinica("Clínica Demo Ajena");
    const deAjena = await phq9(ajena, CON_RIESGO);
    await phq9(propia, CON_RIESGO);

    await reconcilePendingPhq9RiskAlerts(propia.clinicId);
    expect(await marcaDe(deAjena)).toBeNull();
    expect(await alertasDe(ajena.clinicId)).toHaveLength(0);

    expect(await reconcilePendingPhq9RiskAlerts(ajena.clinicId)).toMatchObject({ created: 1 });
  }, 30000);
});

d("alertOnRiskyAssessment", () => {
  it("registra la alerta aunque no haya a quién avisar por correo", async () => {
    const c = await clinicaSinDoctores();
    const conRiesgo = await phq9(c, CON_RIESGO);
    await alertOnRiskyAssessment({
      clinicId: c.clinicId,
      patientId: c.patientId,
      assessmentId: conRiesgo,
      type: "phq9",
      answers: CON_RIESGO,
    });

    const alertas = await alertasDe(c.clinicId);
    expect(alertas).toHaveLength(1);
    expect(alertas[0]).toMatchObject({
      assessment_id: conRiesgo,
      source: "phq9_self_report",
      doctor_id: null,
    });
    expect(await marcaDe(conRiesgo)).not.toBeNull();

    const sinRiesgo = await phq9(c, SIN_RIESGO);
    await alertOnRiskyAssessment({
      clinicId: c.clinicId,
      patientId: c.patientId,
      assessmentId: sinRiesgo,
      type: "phq9",
      answers: SIN_RIESGO,
    });
    expect(await alertasDe(c.clinicId)).toHaveLength(1);
    expect(await marcaDe(sinRiesgo)).not.toBeNull();

    // No le deja nada pendiente a la conciliación.
    expect(await reconcilePendingPhq9RiskAlerts(c.clinicId)).toEqual({
      evaluated: 0,
      created: 0,
      failed: 0,
    });
  }, 30000);
});

d("cola de alertas PHQ-9 del dashboard", () => {
  it("una alerta PHQ-9 acusada sale de la cola abierta", async () => {
    const c = await clinica("Clínica Demo Cola");
    await phq9(c, CON_RIESGO);
    await reconcilePendingPhq9RiskAlerts(c.clinicId);
    session.client = c.client;

    const antes = await listOpenRiskAlerts("phq9_self_report", 5);
    expect(antes.total).toBe(1);
    expect(antes.alerts).toHaveLength(1);
    const [alerta] = antes.alerts;
    expect(alerta).toMatchObject({
      source: "phq9_self_report",
      patientId: c.patientId,
      patientName: "Paciente Demo",
      consultationId: null,
      categories: [{ key: "self_harm", level: "alto" }],
    });
    // La lista de consultas (IA) no la trae: nunca termina en /consultations/null.
    expect((await listOpenRiskAlerts("session_analysis", 5)).total).toBe(0);

    await acknowledgeRiskAlert(alerta.id, c.userId);

    expect(await listOpenRiskAlerts("phq9_self_report", 5)).toEqual({ alerts: [], total: 0 });
    const [fila] = await alertasDe(c.clinicId);
    expect(fila.acknowledged_by).toBe(c.userId);
    expect(fila.acknowledged_at).not.toBeNull();
  }, 30000);

  it("el total cuenta todas las alertas abiertas aunque la lista venga recortada", async () => {
    const c = await clinica("Clínica Demo Desborde");
    const fechas = [7, 6, 5, 4, 3, 2, 1].map(hace);
    for (const fecha of fechas) await phq9(c, CON_RIESGO, { administeredAt: fecha });
    await reconcilePendingPhq9RiskAlerts(c.clinicId);
    session.client = c.client;

    const cola = await listOpenRiskAlerts("phq9_self_report", 5);
    expect(cola.total).toBe(7);
    expect(cola.alerts).toHaveLength(5);
    // Más recientes primero: una alerta nueva nunca queda detrás de las viejas.
    expect(cola.alerts.map((a) => new Date(a.date).getTime())).toEqual(
      fechas
        .slice(2)
        .reverse()
        .map((f) => new Date(f).getTime()),
    );
  }, 30000);

  it("lista una alerta cuyas categorías no descifran, en vez de ocultarla", async () => {
    const c = await clinica("Clínica Demo Descifrado");
    const evaluacion = await phq9(c, CON_RIESGO);
    const { error } = await service().from("risk_alerts").insert({
      clinic_id: c.clinicId,
      source: "phq9_self_report",
      assessment_id: evaluacion,
      patient_id: c.patientId,
      categories_enc: "no-descifra",
    });
    expect(error).toBeNull();
    session.client = c.client;

    const cola = await listOpenRiskAlerts("phq9_self_report", 5);
    expect(cola.total).toBe(1);
    expect(cola.alerts).toHaveLength(1);
    expect(cola.alerts[0].categories).toBeNull();
  }, 30000);

  it("otra clínica no ve ni puede acusar la alerta PHQ-9", async () => {
    const duena = await clinica("Clínica Demo Dueña");
    const otra = await clinica("Clínica Demo Otra");
    await phq9(duena, CON_RIESGO);
    await reconcilePendingPhq9RiskAlerts(duena.clinicId);
    const [alerta] = await alertasDe(duena.clinicId);

    session.client = otra.client;
    expect((await listOpenRiskAlerts("phq9_self_report", 5)).total).toBe(0);
    // RLS filtra el UPDATE: no hay error, pero la fila no cambia.
    await acknowledgeRiskAlert(alerta.id, otra.userId);
    const [fila] = await alertasDe(duena.clinicId);
    expect(fila.acknowledged_at).toBeNull();
  }, 30000);
});

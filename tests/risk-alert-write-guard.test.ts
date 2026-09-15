import { describe, it, expect, beforeAll, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { encrypt } from "@/lib/crypto";
import type { RiskAlertCategory } from "@/lib/risk-flags";
import { acknowledgeRiskAlert, createRiskAlert } from "@/lib/db/risk-alerts";

// Guarda de entorno: importar esto aborta la corrida si NEXT_PUBLIC_SUPABASE_URL
// no apunta a un stack local. Estas pruebas escriben con service-role.
import "./helpers/supabase-env";

/**
 * Lo que la sesión puede escribir en `risk_alerts` (migración 0046): el acuse
 * de recibo, y nada más.
 *
 * La política `risk_alerts_update` decide qué filas toca un admin/doctor, no
 * qué columnas. Estas pruebas hacen lo que haría alguien con su JWT: un PATCH
 * directo a /rest/v1/risk_alerts, sin pasar por acknowledgeRiskAlert. Cada
 * rechazo se comprueba por código y mensaje —no solo que hubo error— y contra
 * la fila completa, leída con service-role antes y después.
 */

// createRiskAlert (fuente IA) y acknowledgeRiskAlert usan el cliente de sesión
// de Next (cookies). Aquí esa sesión es la del doctor de la prueba: mismo JWT y
// mismas políticas que en la app.
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

// El raise del trigger. Un 23514 (check) o un 42501 (RLS) también serían un
// error, pero no probarían este control.
const RAISE_EXCEPTION = "P0001";

const CATEGORIAS: RiskAlertCategory[] = [{ key: "self_harm", level: "alto", evidence: "Texto de prueba." }];

function anon(): SupabaseClient {
  return createClient(URL!, ANON!, { auth: { autoRefreshToken: false, persistSession: false } });
}

function service(): SupabaseClient {
  return createClient(URL!, SERVICE!, { auth: { autoRefreshToken: false, persistSession: false } });
}

interface Profesional {
  client: SupabaseClient;
  userId: string;
  email: string;
}

async function signUp(): Promise<Profesional> {
  const client = anon();
  const email = `guard_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@e-irene.test`;
  const { data, error } = await client.auth.signUp({ email, password: "Password123!" });
  expect(error).toBeNull();
  return { client, userId: data.user!.id, email };
}

d("risk_alerts: con sesión solo se acusa recibo (0046)", () => {
  let clinicId: string;
  let admin: Profesional;
  let doctor: Profesional;

  beforeAll(async () => {
    admin = await signUp();
    const { data, error } = await admin.client.rpc("create_clinic_and_admin", {
      clinic_name: "Clínica Demo Alertas",
      full_name: "Admin Demo",
    });
    expect(error).toBeNull();
    clinicId = data as string;

    // El perfil del doctor lo crea el servidor (service-role), como addMember.
    doctor = await signUp();
    const { error: insertErr } = await service().from("users").insert({
      id: doctor.userId,
      clinic_id: clinicId,
      role: "doctor",
      full_name: "Doctor Demo",
      email: doctor.email,
    });
    expect(insertErr).toBeNull();
    const { error: verifyErr } = await service()
      .from("users")
      .update({ verification_status: "verified" })
      .in("id", [admin.userId, doctor.userId]);
    expect(verifyErr).toBeNull();
  }, 30000);

  async function paciente(nombre = "Paciente Demo"): Promise<string> {
    const { data, error } = await service()
      .from("patients")
      .insert({ clinic_id: clinicId, full_name_enc: encrypt(nombre) })
      .select("id")
      .single();
    expect(error).toBeNull();
    return data!.id as string;
  }

  async function consulta(patientId: string): Promise<string> {
    const { data, error } = await service()
      .from("consultations")
      .insert({ clinic_id: clinicId, patient_id: patientId, doctor_id: doctor.userId })
      .select("id")
      .single();
    expect(error).toBeNull();
    return data!.id as string;
  }

  async function escala(patientId: string): Promise<string> {
    const answers = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    const { data, error } = await service()
      .from("psychometric_assessments")
      .insert({
        clinic_id: clinicId,
        patient_id: patientId,
        type: "phq9",
        payload_enc: encrypt(JSON.stringify({ answers, totalScore: 0, severity: "Demo" })),
        administered_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    return data!.id as string;
  }

  /** Alerta abierta de análisis de sesión, registrada por el servidor. */
  async function alertaAbierta(): Promise<string> {
    const patientId = await paciente();
    const consultationId = await consulta(patientId);
    const { data, error } = await service()
      .from("risk_alerts")
      .insert({
        clinic_id: clinicId,
        source: "session_analysis",
        consultation_id: consultationId,
        patient_id: patientId,
        doctor_id: doctor.userId,
        categories_enc: encrypt(JSON.stringify(CATEGORIAS)),
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    return data!.id as string;
  }

  /** El PATCH de acuse, con el mismo cuerpo que manda acknowledgeRiskAlert. */
  function acusar(quien: Profesional, alertId: string) {
    return quien.client
      .from("risk_alerts")
      .update({ acknowledged_by: quien.userId, acknowledged_at: new Date().toISOString() })
      .eq("id", alertId)
      .select("id");
  }

  async function alertaAcusada(): Promise<string> {
    const alertId = await alertaAbierta();
    const { data, error } = await acusar(doctor, alertId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    return alertId;
  }

  async function fila(alertId: string) {
    const { data, error } = await service().from("risk_alerts").select("*").eq("id", alertId).single();
    expect(error).toBeNull();
    return data!;
  }

  /**
   * PATCH directo con la sesión que tiene que rechazar el trigger. Se pide la
   * fila de vuelta: si RLS la filtrara, no habría error sino 0 filas, y la
   * prueba fallaría en vez de pasar por la razón equivocada.
   */
  async function rechazado(
    quien: Profesional,
    alertId: string,
    patch: Record<string, unknown>,
    mensaje: RegExp,
  ) {
    const { data, error } = await quien.client.from("risk_alerts").update(patch).eq("id", alertId).select("id");
    expect(error?.code, JSON.stringify(patch)).toBe(RAISE_EXCEPTION);
    expect(error?.message, JSON.stringify(patch)).toMatch(mensaje);
    expect(data).toBeNull();
  }

  // ── Lo que la sesión sigue pudiendo hacer ─────────────────────────────────

  it("el doctor acusa recibo a su nombre con un PATCH directo, sin cambiar nada más", async () => {
    const alertId = await alertaAbierta();
    const antes = await fila(alertId);

    const { data, error } = await acusar(doctor, alertId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);

    const despues = await fila(alertId);
    expect(despues.acknowledged_by).toBe(doctor.userId);
    expect(despues.acknowledged_at).not.toBeNull();
    expect({ ...despues, acknowledged_at: null, acknowledged_by: null }).toEqual(antes);
  }, 30000);

  it("la fecha del acuse la pone la base: la sesión no puede antedatarlo", async () => {
    const alertId = await alertaAbierta();
    const { error } = await doctor.client
      .from("risk_alerts")
      .update({ acknowledged_by: doctor.userId, acknowledged_at: "2020-01-01T00:00:00Z" })
      .eq("id", alertId);
    expect(error).toBeNull();

    const { acknowledged_at } = await fila(alertId);
    // Margen amplio por la diferencia de reloj con el contenedor.
    expect(Math.abs(new Date(acknowledged_at).getTime() - Date.now())).toBeLessThan(5 * 60_000);
  }, 30000);

  it("createRiskAlert (fuente IA) y acknowledgeRiskAlert siguen funcionando con la sesión", async () => {
    session.client = doctor.client;
    const patientId = await paciente();
    const consultationId = await consulta(patientId);
    const input = {
      source: "session_analysis" as const,
      consultationId,
      patientId,
      doctorId: doctor.userId,
      categories: CATEGORIAS,
    };

    const creada = await createRiskAlert(clinicId, input);
    expect(creada.isNew).toBe(true);
    // Un reintento del análisis relee la alerta existente, no la actualiza.
    expect(await createRiskAlert(clinicId, input)).toEqual({ id: creada.id, isNew: false });

    await acknowledgeRiskAlert(creada.id, doctor.userId);
    const row = await fila(creada.id);
    expect(row.acknowledged_by).toBe(doctor.userId);
    expect(row.acknowledged_at).not.toBeNull();
  }, 30000);

  it("un acuse que filtra por alertas abiertas no choca con el control: gana uno y el otro no toca la fila", async () => {
    const alertId = await alertaAbierta();
    const acuseFiltrado = (quien: Profesional) =>
      quien.client
        .from("risk_alerts")
        .update({ acknowledged_by: quien.userId, acknowledged_at: new Date().toISOString() })
        .eq("id", alertId)
        .is("acknowledged_at", null)
        .select("id");

    // Doble clic o dos profesionales a la vez: Postgres reevalúa el filtro tras
    // el bloqueo de la fila, así que el perdedor no llega al trigger.
    const resultados = await Promise.all([acuseFiltrado(doctor), acuseFiltrado(admin)]);
    expect(resultados.map((r) => r.error)).toEqual([null, null]);
    expect(resultados.map((r) => r.data!.length).sort()).toEqual([0, 1]);

    const ganador = resultados[0].data!.length === 1 ? doctor : admin;
    const despues = await fila(alertId);
    expect(despues.acknowledged_by).toBe(ganador.userId);

    const tarde = await acuseFiltrado(doctor);
    expect(tarde.error).toBeNull();
    expect(tarde.data).toEqual([]);
    expect(await fila(alertId)).toEqual(despues);
  }, 30000);

  // ── Reabrir ───────────────────────────────────────────────────────────────

  it("NO puede reabrir una alerta acusada", async () => {
    const alertId = await alertaAcusada();
    const antes = await fila(alertId);

    await rechazado(doctor, alertId, { acknowledged_at: null }, /ya tiene acuse de recibo/i);
    await rechazado(doctor, alertId, { acknowledged_at: null, acknowledged_by: null }, /ya tiene acuse de recibo/i);

    expect(await fila(alertId)).toEqual(antes);
  }, 30000);

  // ── El acuse ──────────────────────────────────────────────────────────────

  it("NO puede reescribir un acuse previo: ni la fecha, ni quién, ni acusar encima", async () => {
    const alertId = await alertaAcusada();
    const antes = await fila(alertId);
    const otraFecha = new Date(Date.now() + 3600_000).toISOString();

    await rechazado(doctor, alertId, { acknowledged_at: otraFecha }, /ya tiene acuse de recibo/i);
    await rechazado(doctor, alertId, { acknowledged_by: admin.userId }, /ya tiene acuse de recibo/i);
    // El admin llega después y acusa a su nombre sobre el acuse del doctor.
    await rechazado(
      admin,
      alertId,
      { acknowledged_by: admin.userId, acknowledged_at: otraFecha },
      /ya tiene acuse de recibo/i,
    );

    expect(await fila(alertId)).toEqual(antes);
  }, 30000);

  it("NO puede acusar a nombre de otro usuario, ni sin nombre", async () => {
    const alertId = await alertaAbierta();
    const antes = await fila(alertId);
    const ahora = new Date().toISOString();

    await rechazado(doctor, alertId, { acknowledged_by: admin.userId, acknowledged_at: ahora }, /a tu nombre/i);
    await rechazado(doctor, alertId, { acknowledged_at: ahora }, /a tu nombre/i);

    expect(await fila(alertId)).toEqual(antes);
  }, 30000);

  // ── El resto de la alerta ─────────────────────────────────────────────────

  it("NO puede cambiar contenido, paciente, doctor, fuente, consulta ni escala de una alerta abierta", async () => {
    const alertId = await alertaAbierta();
    const antes = await fila(alertId);
    // Referencias válidas de la misma clínica: sin el trigger, casi todos estos
    // cambios pasarían, y los que no, fallarían con otro código.
    const otroPaciente = await paciente("Paciente Demo Dos");
    const otraConsulta = await consulta(otroPaciente);
    const unaEscala = await escala(otroPaciente);

    const patches: Record<string, unknown>[] = [
      { categories_enc: encrypt("[]") },
      { patient_id: otroPaciente },
      { doctor_id: admin.userId },
      { doctor_id: null },
      { consultation_id: otraConsulta },
      { source: "phq9_self_report" },
      { assessment_id: unaEscala },
      { source: "phq9_self_report", consultation_id: null, assessment_id: unaEscala },
      { created_at: "2020-01-01T00:00:00Z" },
    ];
    const acuse = { acknowledged_by: doctor.userId, acknowledged_at: new Date().toISOString() };
    for (const patch of patches) {
      await rechazado(doctor, alertId, patch, /solo puedes acusar recibo/i);
      // Tampoco colado junto a un acuse válido.
      await rechazado(doctor, alertId, { ...patch, ...acuse }, /solo puedes acusar recibo/i);
    }

    expect(await fila(alertId)).toEqual(antes);
  }, 30000);

  it("NO puede cambiar el contenido ni el paciente de una alerta ya acusada", async () => {
    const alertId = await alertaAcusada();
    const antes = await fila(alertId);
    const otroPaciente = await paciente("Paciente Demo Tres");

    await rechazado(doctor, alertId, { categories_enc: encrypt("[]") }, /ya tiene acuse de recibo/i);
    await rechazado(doctor, alertId, { patient_id: otroPaciente }, /ya tiene acuse de recibo/i);

    expect(await fila(alertId)).toEqual(antes);
  }, 30000);
});

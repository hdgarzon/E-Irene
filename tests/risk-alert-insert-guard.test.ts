import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { encrypt } from "@/lib/crypto";
import type { RiskAlertCategory } from "@/lib/risk-flags";
import { createRiskAlert, listOpenRiskAlerts } from "@/lib/db/risk-alerts";
import { runConsultationAnalysis } from "@/lib/consultation-analysis";

// Guarda de entorno: importar esto aborta la corrida si NEXT_PUBLIC_SUPABASE_URL
// no apunta a un stack local. Estas pruebas escriben con service-role.
import "./helpers/supabase-env";

/**
 * Lo que la sesión puede insertar en `risk_alerts`: nada (migraciones 0047 y
 * 0049).
 *
 * La política `risk_alerts_insert` (0023) solo exigía la clínica. Con su JWT,
 * cualquier miembro —también la secretaria— podía insertar la alerta de una
 * consulta antes que el análisis: ya acusada, de la fuente PHQ-9, con paciente
 * o doctor de otra clínica, o abierta e inventada. El análisis real chocaba
 * con el índice único y no avisaba al doctor. La 0047 acotó ese insert y la
 * 0049 lo retira: las alertas las registra el servidor (createRiskAlert con
 * service-role).
 *
 * Cada intento se hace como lo haría alguien con su sesión: un POST directo a
 * /rest/v1/risk_alerts. Cada rechazo se comprueba por código y mensaje —no solo
 * que hubo error—, y después corre el escritor real para comprobar que la
 * alerta se registra como nueva y queda abierta.
 */

// El análisis y la cola usan el cliente de sesión de Next (cookies); los
// intentos directos, el cliente de cada usuario. Mismo JWT y mismas políticas
// que en la app.
const session = vi.hoisted(() => ({ client: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    if (!session.client) throw new Error("Prueba sin sesión asignada");
    return session.client;
  },
}));

// El aviso al doctor queda registrado aquí en vez de salir.
const correos = vi.hoisted(() => ({ enviados: [] as { to: string; subject: string }[] }));
vi.mock("@/lib/email/providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email/providers")>()),
  getEmailProvider: () => ({
    mode: "log" as const,
    send: async (msg: { to: string; subject: string }) => {
      correos.enviados.push({ to: msg.to, subject: msg.subject });
      return { id: "log_prueba" };
    },
  }),
}));

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const d = URL && ANON && SERVICE ? describe : describe.skip;

// Sin permiso de INSERT. Una política de fila responde con el mismo código, así
// que también se comprueba el mensaje.
const INSUFFICIENT_PRIVILEGE = "42501";
const SIN_PERMISO = /permission denied for table risk_alerts/i;

const CATEGORIAS: RiskAlertCategory[] = [
  { key: "suicidal_ideation", level: "alto", evidence: "Texto de prueba." },
];

function anon(): SupabaseClient {
  return createClient(URL!, ANON!, { auth: { autoRefreshToken: false, persistSession: false } });
}

function service(): SupabaseClient {
  return createClient(URL!, SERVICE!, { auth: { autoRefreshToken: false, persistSession: false } });
}

interface Miembro {
  client: SupabaseClient;
  userId: string;
  email: string;
}

interface Clinica {
  clinicId: string;
  admin: Miembro;
}

async function cuenta(prefijo: string): Promise<Miembro> {
  const client = anon();
  const email = `${prefijo}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@e-irene.test`;
  const { data, error } = await client.auth.signUp({ email, password: "Password123!" });
  expect(error).toBeNull();
  return { client, userId: data.user!.id, email };
}

async function verificar(userId: string): Promise<void> {
  const { error } = await service().from("users").update({ verification_status: "verified" }).eq("id", userId);
  expect(error).toBeNull();
}

/** Clínica con su admin verificado, dada de alta como en la app. */
async function clinica(nombre: string): Promise<Clinica> {
  const admin = await cuenta("insert_admin");
  const { data, error } = await admin.client.rpc("create_clinic_and_admin", {
    clinic_name: nombre,
    full_name: "Admin Demo",
  });
  expect(error).toBeNull();
  await verificar(admin.userId);
  return { clinicId: data as string, admin };
}

/** El perfil lo crea el servidor (service-role), como addMember. */
async function miembro(clinicId: string, role: "doctor" | "secretaria"): Promise<Miembro> {
  const m = await cuenta(`insert_${role}`);
  const { error } = await service()
    .from("users")
    .insert({
      id: m.userId,
      clinic_id: clinicId,
      role,
      full_name: role === "doctor" ? "Doctor Demo" : "Secretaria Demo",
      email: m.email,
    });
  expect(error).toBeNull();
  if (role === "doctor") await verificar(m.userId);
  return m;
}

async function paciente(clinicId: string): Promise<string> {
  const { data, error } = await service()
    .from("patients")
    .insert({ clinic_id: clinicId, full_name_enc: encrypt("Paciente Demo") })
    .select("id")
    .single();
  expect(error).toBeNull();
  return data!.id as string;
}

async function consulta(
  clinicId: string,
  patientId: string,
  doctorId: string,
  transcripcion = "Paciente: esta semana dormí mejor.",
): Promise<string> {
  const { data, error } = await service()
    .from("consultations")
    .insert({
      clinic_id: clinicId,
      patient_id: patientId,
      doctor_id: doctorId,
      transcript_enc: encrypt(transcripcion),
    })
    .select("id")
    .single();
  expect(error).toBeNull();
  return data!.id as string;
}

async function escala(clinicId: string, patientId: string): Promise<string> {
  const answers = [1, 1, 1, 1, 1, 1, 1, 1, 2];
  const { data, error } = await service()
    .from("psychometric_assessments")
    .insert({
      clinic_id: clinicId,
      patient_id: patientId,
      type: "phq9",
      payload_enc: encrypt(JSON.stringify({ answers, totalScore: 10, severity: "Demo" })),
      administered_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  expect(error).toBeNull();
  return data!.id as string;
}

async function alertasDe(columna: "consultation_id" | "assessment_id", id: string) {
  const { data, error } = await service().from("risk_alerts").select("*").eq(columna, id);
  expect(error).toBeNull();
  return data!;
}

/** La fila que mandaba createRiskAlert con la sesión, antes de pasar a service-role. */
function filaDeConsulta(clinicId: string, consultationId: string, patientId: string, doctorId: string) {
  return {
    clinic_id: clinicId,
    source: "session_analysis",
    consultation_id: consultationId,
    assessment_id: null,
    patient_id: patientId,
    doctor_id: doctorId,
    categories_enc: encrypt(JSON.stringify(CATEGORIAS)),
  };
}

/**
 * POST directo con la sesión, que tiene que rechazar la falta de permiso. Se
 * pide la fila de vuelta: si el insert pasara, habría datos y la prueba
 * fallaría.
 */
async function sinPermiso(client: SupabaseClient, fila: Record<string, unknown>) {
  const { data, error } = await client.from("risk_alerts").insert(fila).select("id");
  const caso = JSON.stringify({ ...fila, categories_enc: undefined });
  expect(error?.code, caso).toBe(INSUFFICIENT_PRIVILEGE);
  expect(error?.message, caso).toMatch(SIN_PERMISO);
  expect(data).toBeNull();
}

d("risk_alerts: la sesión no inserta (0047 y 0049)", () => {
  let A: Clinica;
  let B: Clinica;
  let doctor: Miembro;
  let secretaria: Miembro;
  let pacienteB: string;
  let consultaB: string;

  beforeAll(async () => {
    A = await clinica("Clínica Demo Alertas");
    B = await clinica("Clínica Demo Ajena");
    doctor = await miembro(A.clinicId, "doctor");
    secretaria = await miembro(A.clinicId, "secretaria");
    pacienteB = await paciente(B.clinicId);
    consultaB = await consulta(B.clinicId, pacienteB, B.admin.userId);
    // Determinista y sin costo, aunque haya una clave de OpenAI en el entorno.
    vi.stubEnv("ANALYSIS_PROVIDER", "mock");
  }, 60000);

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  /** Consulta nueva de la clínica A, sin alerta todavía. */
  async function consultaSinAlerta(transcripcion?: string) {
    const patientId = await paciente(A.clinicId);
    const consultationId = await consulta(A.clinicId, patientId, doctor.userId, transcripcion);
    return { patientId, consultationId, fila: filaDeConsulta(A.clinicId, consultationId, patientId, doctor.userId) };
  }

  function entradaDeConsulta(c: { consultationId: string; patientId: string }) {
    return {
      source: "session_analysis" as const,
      consultationId: c.consultationId,
      patientId: c.patientId,
      doctorId: doctor.userId,
      categories: CATEGORIAS,
    };
  }

  /**
   * El escritor real después del intento, con la sesión de quien dispara el
   * análisis: la alerta tiene que ser nueva —el análisis solo avisa al doctor
   * por correo si `isNew`— y quedar abierta en la cola.
   */
  async function alertaRealAbierta(c: { consultationId: string; patientId: string }, quien: Miembro = doctor) {
    session.client = quien.client;
    const creada = await createRiskAlert(A.clinicId, entradaDeConsulta(c));
    expect(creada.isNew).toBe(true);

    const filas = await alertasDe("consultation_id", c.consultationId);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ id: creada.id, acknowledged_at: null, acknowledged_by: null });
    const cola = await listOpenRiskAlerts("session_analysis", 50);
    expect(cola.alerts.map((a) => a.id)).toContain(creada.id);
    return creada.id;
  }

  it("ningún rol inserta con su sesión, ni ya acusada ni con la fila de siempre, y la alerta real se registra abierta", async () => {
    for (const quien of [secretaria, doctor, A.admin]) {
      const c = await consultaSinAlerta();
      await sinPermiso(quien.client, {
        ...c.fila,
        acknowledged_at: new Date().toISOString(),
        acknowledged_by: quien.userId,
      });
      await sinPermiso(quien.client, c.fila);
      expect(await alertasDe("consultation_id", c.consultationId)).toHaveLength(0);

      // Terminar o reintentar el análisis solo exige sesión: cualquiera de
      // estos roles puede dispararlo, y la alerta se registra igual.
      const id = await alertaRealAbierta(c, quien);
      // Un reintento del análisis relee la alerta existente, sin duplicarla.
      expect(await createRiskAlert(A.clinicId, entradaDeConsulta(c))).toEqual({ id, isNew: false });
    }
  }, 60000);

  it("NO inserta alertas de la fuente PHQ-9: las registra el servidor", async () => {
    const patientId = await paciente(A.clinicId);
    const assessmentId = await escala(A.clinicId, patientId);
    const phq9 = {
      clinic_id: A.clinicId,
      source: "phq9_self_report",
      assessment_id: assessmentId,
      consultation_id: null,
      patient_id: patientId,
      doctor_id: null,
      categories_enc: encrypt(JSON.stringify(CATEGORIAS)),
    };
    for (const quien of [secretaria, doctor]) await sinPermiso(quien.client, phq9);
    expect(await alertasDe("assessment_id", assessmentId)).toHaveLength(0);

    const creada = await createRiskAlert(A.clinicId, {
      source: "phq9_self_report",
      assessmentId,
      patientId,
      doctorId: null,
      categories: CATEGORIAS,
    });
    expect(creada.isNew).toBe(true);
    const filas = await alertasDe("assessment_id", assessmentId);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ id: creada.id, acknowledged_at: null });
    session.client = doctor.client;
    const cola = await listOpenRiskAlerts("phq9_self_report", 50);
    expect(cola.alerts.map((a) => a.id)).toContain(creada.id);
  }, 60000);

  it("NO inserta con la consulta, el paciente o el doctor de otra clínica, y la alerta de esa clínica no queda bloqueada", async () => {
    const c = await consultaSinAlerta();
    const cambios: Record<string, unknown>[] = [
      { patient_id: pacienteB },
      { doctor_id: B.admin.userId },
      { consultation_id: consultaB, patient_id: pacienteB, doctor_id: B.admin.userId },
      { clinic_id: B.clinicId, consultation_id: consultaB, patient_id: pacienteB, doctor_id: B.admin.userId },
    ];
    for (const quien of [secretaria, doctor]) {
      for (const cambio of cambios) await sinPermiso(quien.client, { ...c.fila, ...cambio });
    }
    expect(await alertasDe("consultation_id", c.consultationId)).toHaveLength(0);
    expect(await alertasDe("consultation_id", consultaB)).toHaveLength(0);

    await alertaRealAbierta(c);

    const deB = {
      source: "session_analysis" as const,
      consultationId: consultaB,
      patientId: pacienteB,
      doctorId: B.admin.userId,
      categories: CATEGORIAS,
    };
    const creadaB = await createRiskAlert(B.clinicId, deB);
    expect(creadaB.isNew).toBe(true);
    session.client = B.admin.client;
    const colaB = await listOpenRiskAlerts("session_analysis", 50);
    expect(colaB.alerts.map((a) => a.id)).toContain(creadaB.id);

    // Con la clínica equivocada, el índice único no se toma por un reintento:
    // lanza en vez de devolver `isNew: false` y callar el correo.
    await expect(createRiskAlert(A.clinicId, deB)).rejects.toMatchObject({ code: "PGRST116" });
  }, 60000);

  it("anon tampoco inserta", async () => {
    const c = await consultaSinAlerta();
    await sinPermiso(anon(), c.fila);
    expect(await alertasDe("consultation_id", c.consultationId)).toHaveLength(0);
  }, 30000);

  it("el análisis de la consulta registra la alerta abierta y avisa al doctor, aunque antes intentaran silenciarla", async () => {
    const c = await consultaSinAlerta("Doctor: ¿Cómo estuvo la semana?\nPaciente: a veces siento que quiero morir.");
    await sinPermiso(secretaria.client, {
      ...c.fila,
      acknowledged_at: new Date().toISOString(),
      acknowledged_by: secretaria.userId,
    });

    correos.enviados.length = 0;
    session.client = doctor.client;
    await runConsultationAnalysis({
      consultationId: c.consultationId,
      clinicId: A.clinicId,
      actorId: doctor.userId,
      clinicName: "Clínica Demo Alertas",
    });

    const { data: estado, error } = await service()
      .from("consultations")
      .select("analysis_status, analysis_error")
      .eq("id", c.consultationId)
      .single();
    expect(error).toBeNull();
    expect(estado!.analysis_status, estado!.analysis_error ?? "").toBe("done");

    const filas = await alertasDe("consultation_id", c.consultationId);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      source: "session_analysis",
      patient_id: c.patientId,
      doctor_id: doctor.userId,
      acknowledged_at: null,
      acknowledged_by: null,
    });
    expect(correos.enviados.filter((m) => m.to === doctor.email)).toHaveLength(1);

    const cola = await listOpenRiskAlerts("session_analysis", 50);
    expect(cola.alerts.map((a) => a.id)).toContain(filas[0].id);
  }, 60000);
});

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
 * Lo que la sesión puede insertar en `risk_alerts` (migración 0047).
 *
 * La política `risk_alerts_insert` (0023) solo exigía la clínica. Con su JWT,
 * cualquier miembro —también la secretaria— podía insertar la alerta de una
 * consulta antes que el análisis: ya acusada, de la fuente PHQ-9, antedatada o
 * con paciente o doctor de otra clínica. El análisis real chocaba con el
 * índice único, no avisaba al doctor y, si la alerta venía acusada, la cola
 * quedaba vacía.
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

// El raise del trigger. Un 42501 (RLS), un 23514 (check) o un 23505 (índice
// único) también serían un error, pero no probarían este control.
const RAISE_EXCEPTION = "P0001";
const RLS_VIOLATION = "42501";
const UNIQUE_VIOLATION = "23505";

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

/** La fila que manda createRiskAlert para la fuente de análisis de sesión. */
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
 * POST directo con la sesión que tiene que rechazar el trigger. Se pide la fila
 * de vuelta: si el insert pasara, habría datos y la prueba fallaría.
 */
async function rechazado(quien: Miembro, fila: Record<string, unknown>, mensaje: RegExp) {
  const { data, error } = await quien.client.from("risk_alerts").insert(fila).select("id");
  const caso = JSON.stringify({ ...fila, categories_enc: undefined });
  expect(error?.code, caso).toBe(RAISE_EXCEPTION);
  expect(error?.message, caso).toMatch(mensaje);
  expect(data).toBeNull();
}

d("risk_alerts: lo que la sesión puede insertar (0047)", () => {
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

  /**
   * El escritor real después del intento: la alerta tiene que ser nueva —el
   * análisis solo avisa al doctor por correo si `isNew`— y quedar abierta en la
   * cola del dashboard.
   */
  async function alertaRealAbierta(c: { consultationId: string; patientId: string }) {
    session.client = doctor.client;
    const creada = await createRiskAlert(A.clinicId, {
      source: "session_analysis",
      consultationId: c.consultationId,
      patientId: c.patientId,
      doctorId: doctor.userId,
      categories: CATEGORIAS,
    });
    expect(creada.isNew).toBe(true);

    const filas = await alertasDe("consultation_id", c.consultationId);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ id: creada.id, acknowledged_at: null, acknowledged_by: null });
    const cola = await listOpenRiskAlerts("session_analysis", 50);
    expect(cola.alerts.map((a) => a.id)).toContain(creada.id);
  }

  // ── Lo que la sesión no puede insertar ────────────────────────────────────

  it("nadie de la clínica inserta una alerta ya acusada, y la alerta real se registra abierta", async () => {
    for (const quien of [secretaria, doctor, A.admin]) {
      const c = await consultaSinAlerta();
      const ahora = new Date().toISOString();

      await rechazado(quien, { ...c.fila, acknowledged_at: ahora, acknowledged_by: doctor.userId }, /no puede nacer con acuse/i);
      await rechazado(quien, { ...c.fila, acknowledged_at: ahora, acknowledged_by: quien.userId }, /no puede nacer con acuse/i);
      await rechazado(quien, { ...c.fila, acknowledged_at: ahora }, /no puede nacer con acuse/i);
      await rechazado(quien, { ...c.fila, acknowledged_by: quien.userId }, /no puede nacer con acuse/i);
      expect(await alertasDe("consultation_id", c.consultationId)).toHaveLength(0);

      await alertaRealAbierta(c);
    }
  }, 60000);

  it("NO inserta alertas de la fuente PHQ-9: las registra el servidor", async () => {
    const patientId = await paciente(A.clinicId);
    const assessmentId = await escala(A.clinicId, patientId);
    const { consultationId } = await consultaSinAlerta();
    const categories_enc = encrypt(JSON.stringify(CATEGORIAS));
    const phq9 = {
      clinic_id: A.clinicId,
      source: "phq9_self_report",
      assessment_id: assessmentId,
      consultation_id: null,
      patient_id: patientId,
      doctor_id: null,
      categories_enc,
    };

    for (const quien of [secretaria, doctor]) {
      await rechazado(quien, phq9, /solo se registran alertas del análisis de una consulta/i);
      await rechazado(
        quien,
        { ...phq9, acknowledged_at: new Date().toISOString(), acknowledged_by: quien.userId },
        /no puede nacer con acuse/i,
      );
      // Tampoco colando la escala en una alerta de consulta.
      await rechazado(
        quien,
        { ...phq9, source: "session_analysis", consultation_id: consultationId },
        /solo se registran alertas del análisis de una consulta/i,
      );
    }
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

  it("NO inserta con paciente, doctor o consulta de otra clínica, ni cambiándolos por otros de la suya", async () => {
    const c = await consultaSinAlerta();
    const otroPaciente = await paciente(A.clinicId);

    const cambios: [Record<string, unknown>, RegExp][] = [
      [{ patient_id: pacienteB }, /los de la consulta/i],
      [{ doctor_id: B.admin.userId }, /los de la consulta/i],
      [{ patient_id: otroPaciente }, /los de la consulta/i],
      [{ doctor_id: A.admin.userId }, /los de la consulta/i],
      [{ doctor_id: null }, /los de la consulta/i],
      [{ consultation_id: consultaB, patient_id: pacienteB, doctor_id: B.admin.userId }, /consulta de tu clínica/i],
      [
        { clinic_id: B.clinicId, consultation_id: consultaB, patient_id: pacienteB, doctor_id: B.admin.userId },
        /consulta de tu clínica/i,
      ],
      [{ clinic_id: B.clinicId }, /consulta de tu clínica/i],
    ];
    for (const quien of [secretaria, doctor]) {
      for (const [cambio, mensaje] of cambios) await rechazado(quien, { ...c.fila, ...cambio }, mensaje);
    }
    expect(await alertasDe("consultation_id", c.consultationId)).toHaveLength(0);
    expect(await alertasDe("consultation_id", consultaB)).toHaveLength(0);

    await alertaRealAbierta(c);

    // El índice único es global: la alerta de la otra clínica tampoco quedó
    // bloqueada.
    session.client = B.admin.client;
    const deB = await createRiskAlert(B.clinicId, {
      source: "session_analysis",
      consultationId: consultaB,
      patientId: pacienteB,
      doctorId: B.admin.userId,
      categories: CATEGORIAS,
    });
    expect(deB.isNew).toBe(true);
    const colaB = await listOpenRiskAlerts("session_analysis", 50);
    expect(colaB.alerts.map((a) => a.id)).toContain(deB.id);
  }, 60000);

  it("sin sesión no hay clínica: anon no inserta (RLS)", async () => {
    const c = await consultaSinAlerta();
    const { error } = await anon().from("risk_alerts").insert(c.fila);
    expect(error?.code).toBe(RLS_VIOLATION);
    expect(await alertasDe("consultation_id", c.consultationId)).toHaveLength(0);
  }, 30000);

  it("la fecha de la alerta la pone la base: la sesión no puede antedatarla", async () => {
    const c = await consultaSinAlerta();
    const { error } = await doctor.client
      .from("risk_alerts")
      .insert({ ...c.fila, created_at: "2020-01-01T00:00:00Z" });
    expect(error).toBeNull();

    const [fila] = await alertasDe("consultation_id", c.consultationId);
    // Margen amplio por la diferencia de reloj con el contenedor.
    expect(Math.abs(new Date(fila.created_at).getTime() - Date.now())).toBeLessThan(5 * 60_000);
  }, 30000);

  // ── Compatibilidad durante el despliegue ──────────────────────────────────

  it("el código anterior, que inserta con la sesión de quien dispara el análisis, sigue registrando la alerta", async () => {
    // Terminar o reintentar el análisis solo exige sesión, así que también
    // puede dispararlo la secretaria. Entre la migración y la promoción del
    // código nuevo, ese insert tiene que seguir pasando.
    for (const quien of [doctor, secretaria]) {
      const c = await consultaSinAlerta();
      const { error } = await quien.client.from("risk_alerts").insert(c.fila);
      expect(error).toBeNull();
      const [fila] = await alertasDe("consultation_id", c.consultationId);
      expect(fila).toMatchObject({ source: "session_analysis", acknowledged_at: null });

      // Un reintento choca con el índice único, que es lo que el código
      // anterior convierte en `isNew: false`.
      const repetido = await quien.client.from("risk_alerts").insert(c.fila);
      expect(repetido.error?.code).toBe(UNIQUE_VIOLATION);
    }
  }, 30000);

  // ── De punta a punta ──────────────────────────────────────────────────────

  it("el análisis de la consulta registra la alerta abierta y avisa al doctor, aunque antes intentaran silenciarla", async () => {
    const c = await consultaSinAlerta("Doctor: ¿Cómo estuvo la semana?\nPaciente: a veces siento que quiero morir.");
    await rechazado(
      secretaria,
      { ...c.fila, acknowledged_at: new Date().toISOString(), acknowledged_by: secretaria.userId },
      /no puede nacer con acuse/i,
    );

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

import { describe, it, expect, beforeAll, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { encrypt } from "@/lib/crypto";
import { bareAnalysisContext } from "@/lib/clinical-state";
import {
  createAppointment,
  isAppointmentPatientLocked,
  setAppointmentStatus,
  updateAppointment,
} from "@/lib/db/appointments";
import { appendClinicalState } from "@/lib/db/clinical-state";
import { endConsultation, startConsultation } from "@/lib/db/consultations";
import { recordNotification } from "@/lib/db/notifications";
import { createReport, validateReport } from "@/lib/db/reports";
import { upsertSoapNote } from "@/lib/db/soap-notes";
import { MockAnalysisProvider } from "@/lib/providers/mock";

// Guarda de entorno: importar esto aborta la corrida si NEXT_PUBLIC_SUPABASE_URL
// no apunta a un stack local. Estas pruebas escriben con service-role.
import "./helpers/supabase-env";

/**
 * Dentro de la clínica, una fila y lo que referencia tienen que ser del mismo
 * paciente (migración 0051).
 *
 * La 0048 exige que las referencias sean de la misma clínica, no que sean
 * coherentes dentro de ella. Sin la 0051, la sesión del admin verificado colgaba
 * de la consulta de un paciente el reporte, la nota, el estado clínico o el
 * progreso de otro; abría la consulta de un paciente con la cita o el
 * consentimiento de otro; registraba el recordatorio de una cita a nombre de
 * otro paciente, y cambiaba el paciente de citas y consultas que ya tenían
 * registros del anterior. Lo último también desde la app: el formulario de
 * edición de citas deja elegir otro paciente.
 *
 * Los intentos se hacen como alguien con su sesión: un POST o PATCH directo a
 * /rest/v1. Los casos legítimos pasan por los escritores reales de lib/db, con
 * la misma sesión, para comprobar que el código actual sigue funcionando.
 */

// Los escritores usan el cliente de sesión de Next (cookies); aquí, el cliente
// del admin con su JWT. Mismas políticas y mismos triggers que en la app.
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

// El raise del trigger. Un 42501 (RLS) o un 23503 (FK) también serían un error,
// pero no probarían este control.
const RAISE_EXCEPTION = "P0001";

const referencia = (tabla: string, columna: string) =>
  `${tabla}.${columna} tiene que apuntar a un registro del mismo paciente`;
const dependientes = (tabla: string, en: string) =>
  `${tabla}.patient_id tiene que coincidir con el de sus registros en ${en}`;

function anon(): SupabaseClient {
  return createClient(URL!, ANON!, { auth: { autoRefreshToken: false, persistSession: false } });
}

function service(): SupabaseClient {
  return createClient(URL!, SERVICE!, { auth: { autoRefreshToken: false, persistSession: false } });
}

type Clinica = { client: SupabaseClient; clinicId: string; userId: string };

/** Clínica con su admin verificado, dada de alta como en la app. */
async function bootstrapClinic(name: string): Promise<Clinica> {
  const client = anon();
  const email = `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@e-irene.test`;
  const { data: auth, error: signUpErr } = await client.auth.signUp({ email, password: "Password123!" });
  expect(signUpErr).toBeNull();
  const { data: clinicId, error: rpcErr } = await client.rpc("create_clinic_and_admin", {
    clinic_name: name,
    full_name: "Doctor Test",
  });
  expect(rpcErr).toBeNull();
  const { error: verifyErr } = await service()
    .from("users")
    .update({ verification_status: "verified" })
    .eq("id", auth.user!.id);
  expect(verifyErr).toBeNull();
  return { client, clinicId: clinicId as string, userId: auth.user!.id };
}

async function insertar(tabla: string, fila: Record<string, unknown>): Promise<string> {
  const { data, error } = await service().from(tabla).insert(fila).select("id").single();
  expect(error, tabla).toBeNull();
  return data!.id as string;
}

d("coherencia de paciente dentro de la clínica (0051)", () => {
  let A: Clinica;
  let r: {
    p1: string;
    p2: string;
    consentimiento: string;
    cita: string;
    citaConAviso: string;
    aviso: string;
    consultaDeCita: string;
    consultaConConsentimiento: string;
    consultaConReporte: string;
    reporte: string;
    consultaConNota: string;
    nota: string;
    consultaConEstado: string;
    consultaConProgreso: string;
    progreso: string;
    consultaConAlerta: string;
    consultaDeP2: string;
  };

  const manana = () => new Date(Date.now() + 86_400_000).toISOString();
  const paciente = () => insertar("patients", { clinic_id: A.clinicId, full_name_enc: encrypt("Paciente Demo") });
  const consultaDe = (patientId: string, extra: Record<string, unknown> = {}) =>
    insertar("consultations", { clinic_id: A.clinicId, patient_id: patientId, doctor_id: A.userId, ...extra });
  const citaDe = (patientId: string) =>
    insertar("appointments", {
      clinic_id: A.clinicId,
      patient_id: patientId,
      doctor_id: A.userId,
      scheduled_at: manana(),
    });

  beforeAll(async () => {
    A = await bootstrapClinic("Clínica Paciente Coherente");
    session.client = A.client;

    const p1 = await paciente();
    const p2 = await paciente();
    const consentimiento = await insertar("consents", {
      clinic_id: A.clinicId,
      patient_id: p1,
      document_version: "v1",
      document_hash: "0".repeat(64),
    });
    const cita = await citaDe(p1);
    const citaConAviso = await citaDe(p1);
    const consultaConReporte = await consultaDe(p1);
    const consultaConNota = await consultaDe(p1);
    const consultaConEstado = await consultaDe(p1);
    const consultaConProgreso = await consultaDe(p1);
    const consultaConAlerta = await consultaDe(p1);

    r = {
      p1,
      p2,
      consentimiento,
      cita,
      citaConAviso,
      aviso: await insertar("notifications", {
        clinic_id: A.clinicId,
        patient_id: p1,
        appointment_id: citaConAviso,
        type: "appointment_reminder",
        status: "simulated",
      }),
      consultaDeCita: await consultaDe(p1, { appointment_id: cita, consent_id: consentimiento }),
      consultaConConsentimiento: await consultaDe(p1, { consent_id: consentimiento }),
      consultaConReporte,
      reporte: await insertar("reports", {
        clinic_id: A.clinicId,
        consultation_id: consultaConReporte,
        patient_id: p1,
        payload_enc: encrypt("{}"),
      }),
      consultaConNota,
      nota: await insertar("soap_notes", {
        clinic_id: A.clinicId,
        consultation_id: consultaConNota,
        patient_id: p1,
        created_by: A.userId,
      }),
      consultaConEstado,
      consultaConProgreso,
      progreso: await insertar("patient_progress", {
        clinic_id: A.clinicId,
        patient_id: p1,
        consultation_id: consultaConProgreso,
      }),
      consultaConAlerta,
      consultaDeP2: await consultaDe(p2),
    };
    await insertar("patient_clinical_state", {
      clinic_id: A.clinicId,
      patient_id: p1,
      consultation_id: consultaConEstado,
      version: 1,
      state_enc: encrypt("{}"),
      model: "mock",
      prompt_version: "v1",
    });
    await insertar("risk_alerts", {
      clinic_id: A.clinicId,
      consultation_id: consultaConAlerta,
      patient_id: p1,
      doctor_id: A.userId,
      categories_enc: encrypt("[]"),
    });
  }, 60000);

  // ── Lo que el control debe impedir ────────────────────────────────────────

  const insercionesIncoherentes: [tabla: string, columna: string, fila: () => Promise<Record<string, unknown>>][] = [
    [
      "reports",
      "consultation_id",
      async () => ({
        clinic_id: A.clinicId,
        consultation_id: r.consultaConReporte,
        patient_id: r.p2,
        payload_enc: encrypt("{}"),
      }),
    ],
    [
      "soap_notes",
      "consultation_id",
      async () => ({ clinic_id: A.clinicId, consultation_id: await consultaDe(r.p1), patient_id: r.p2 }),
    ],
    [
      "patient_clinical_state",
      "consultation_id",
      async () => ({
        clinic_id: A.clinicId,
        patient_id: r.p2,
        consultation_id: await consultaDe(r.p1),
        version: 1,
        state_enc: encrypt("{}"),
        model: "mock",
        prompt_version: "v1",
      }),
    ],
    [
      "patient_progress",
      "consultation_id",
      async () => ({ clinic_id: A.clinicId, patient_id: r.p2, consultation_id: r.consultaConProgreso }),
    ],
    [
      "consultations",
      "appointment_id",
      async () => ({ clinic_id: A.clinicId, patient_id: r.p2, doctor_id: A.userId, appointment_id: r.cita }),
    ],
    [
      "consultations",
      "consent_id",
      async () => ({ clinic_id: A.clinicId, patient_id: r.p2, doctor_id: A.userId, consent_id: r.consentimiento }),
    ],
    [
      "notifications",
      "appointment_id",
      async () => ({
        clinic_id: A.clinicId,
        patient_id: r.p2,
        appointment_id: r.cita,
        type: "appointment_reminder",
        status: "simulated",
      }),
    ],
  ];

  for (const [tabla, columna, fila] of insercionesIncoherentes) {
    it(`NO inserta en ${tabla} con ${columna} de otro paciente`, async () => {
      const { error } = await A.client.from(tabla).insert(await fila());
      expect(error?.code).toBe(RAISE_EXCEPTION);
      expect(error?.message).toMatch(referencia(tabla, columna));
    });
  }

  const cambiosIncoherentes: [
    descripcion: string,
    tabla: string,
    id: () => string,
    cambio: () => Record<string, unknown>,
    mensaje: string,
  ][] = [
    ["el paciente de un reporte", "reports", () => r.reporte, () => ({ patient_id: r.p2 }), referencia("reports", "consultation_id")],
    ["la consulta de un reporte a la de otro paciente", "reports", () => r.reporte, () => ({ consultation_id: r.consultaDeP2 }), referencia("reports", "consultation_id")],
    ["el paciente de una nota SOAP", "soap_notes", () => r.nota, () => ({ patient_id: r.p2 }), referencia("soap_notes", "consultation_id")],
    ["el paciente de un progreso", "patient_progress", () => r.progreso, () => ({ patient_id: r.p2 }), referencia("patient_progress", "consultation_id")],
    ["el paciente de un recordatorio", "notifications", () => r.aviso, () => ({ patient_id: r.p2 }), referencia("notifications", "appointment_id")],
    ["el paciente de una consulta con cita", "consultations", () => r.consultaDeCita, () => ({ patient_id: r.p2 }), referencia("consultations", "appointment_id")],
    ["el paciente de una consulta con consentimiento", "consultations", () => r.consultaConConsentimiento, () => ({ patient_id: r.p2 }), referencia("consultations", "consent_id")],
    ["el paciente de una consulta con reporte", "consultations", () => r.consultaConReporte, () => ({ patient_id: r.p2 }), dependientes("consultations", "reports")],
    ["el paciente de una consulta con nota SOAP", "consultations", () => r.consultaConNota, () => ({ patient_id: r.p2 }), dependientes("consultations", "soap_notes")],
    ["el paciente de una consulta con estado clínico", "consultations", () => r.consultaConEstado, () => ({ patient_id: r.p2 }), dependientes("consultations", "patient_clinical_state")],
    ["el paciente de una consulta con progreso", "consultations", () => r.consultaConProgreso, () => ({ patient_id: r.p2 }), dependientes("consultations", "patient_progress")],
    ["el paciente de una consulta con alerta de riesgo", "consultations", () => r.consultaConAlerta, () => ({ patient_id: r.p2 }), dependientes("consultations", "risk_alerts")],
    ["el paciente de una cita con consulta", "appointments", () => r.cita, () => ({ patient_id: r.p2 }), dependientes("appointments", "consultations")],
    ["el paciente de una cita con solo un recordatorio", "appointments", () => r.citaConAviso, () => ({ patient_id: r.p2 }), dependientes("appointments", "notifications")],
  ];

  for (const [descripcion, tabla, id, cambio, mensaje] of cambiosIncoherentes) {
    it(`NO cambia ${descripcion}`, async () => {
      const columnas = Object.keys(cambio()).join(", ");
      const antes = await service().from(tabla).select(columnas).eq("id", id()).single();
      expect(antes.error).toBeNull();

      const { error } = await A.client.from(tabla).update(cambio()).eq("id", id());
      expect(error?.code).toBe(RAISE_EXCEPTION);
      expect(error?.message).toMatch(mensaje);

      const despues = await service().from(tabla).select(columnas).eq("id", id()).single();
      expect(despues.data).toEqual(antes.data);
    });
  }

  it("updateAppointment NO pasa a otro paciente una cita con consulta, y la acción lo reconoce", async () => {
    const intento = updateAppointment(r.cita, {
      patientId: r.p2,
      doctorId: A.userId,
      scheduledAt: manana(),
      durationMin: 50,
      modality: "video",
    });
    await expect(intento).rejects.toMatchObject({ code: RAISE_EXCEPTION });
    const error = await intento.catch((e: unknown) => e);
    // updateAppointmentAction muestra su mensaje en el campo del paciente solo
    // si reconoce este error: si cambia el texto del trigger, falla aquí.
    expect(isAppointmentPatientLocked(error)).toBe(true);

    const { data } = await service().from("appointments").select("patient_id").eq("id", r.cita).single();
    expect(data?.patient_id).toBe(r.p1);
  });

  it("upsertSoapNote NO guarda la nota con un paciente que no es el de la consulta", async () => {
    // saveSoapNoteAction recibe consultationId y patientId de la página: el
    // trigger es lo que impide que lleguen de pacientes distintos.
    const consulta = await consultaDe(r.p1);
    await expect(
      upsertSoapNote(A.clinicId, A.userId, {
        consultationId: consulta,
        patientId: r.p2,
        subjective: "Nota Demo",
        objective: null,
        assessment: null,
        plan: null,
      }),
    ).rejects.toMatchObject({ code: RAISE_EXCEPTION, message: referencia("soap_notes", "consultation_id") });
  });

  it("isAppointmentPatientLocked no confunde otros errores", () => {
    expect(isAppointmentPatientLocked({ code: RAISE_EXCEPTION, message: referencia("consultations", "appointment_id") })).toBe(false);
    expect(isAppointmentPatientLocked({ code: "42501", message: "appointments.patient_id" })).toBe(false);
    expect(isAppointmentPatientLocked(new Error("appointments.patient_id"))).toBe(false);
    expect(isAppointmentPatientLocked(null)).toBe(false);
  });

  // ── Lo que el control debe permitir ───────────────────────────────────────

  it("SÍ edita una cita con consulta sin cambiar su paciente, como el formulario de edición", async () => {
    // El formulario manda siempre patient_id: el mismo valor no es un cambio.
    const appt = await updateAppointment(r.cita, {
      patientId: r.p1,
      doctorId: A.userId,
      scheduledAt: manana(),
      durationMin: 45,
      notes: "Nota Demo",
      modality: "video",
    });
    expect(appt.durationMin).toBe(45);

    await setAppointmentStatus(r.cita, "confirmed");
  });

  it("SÍ reasigna una cita sin consultas ni recordatorios, como updateAppointment", async () => {
    const appt = await createAppointment(A.clinicId, {
      patientId: r.p1,
      doctorId: A.userId,
      scheduledAt: manana(),
      durationMin: 50,
    });
    const reasignada = await updateAppointment(appt.id, {
      patientId: r.p2,
      doctorId: A.userId,
      scheduledAt: manana(),
      durationMin: 50,
    });
    expect(reasignada.patientId).toBe(r.p2);
  });

  it("SÍ abre la consulta con paciente, cita y consentimiento del mismo paciente, y registra su recordatorio", async () => {
    // Como startVideoConsultationAction y sendReminderAction.
    const consulta = await startConsultation(A.clinicId, {
      patientId: r.p1,
      doctorId: A.userId,
      consentId: r.consentimiento,
      appointmentId: r.cita,
    });
    expect(consulta).toBeTruthy();

    await recordNotification(A.clinicId, {
      patientId: r.p1,
      appointmentId: r.cita,
      channel: "email",
      type: "appointment_reminder",
      status: "simulated",
      payload: { mode: "log" },
    });
  });

  it("SÍ registra estado clínico, reporte y nota con el paciente de la consulta, como el análisis y el editor", async () => {
    const p3 = await paciente();
    const consulta = await startConsultation(A.clinicId, { patientId: p3, doctorId: A.userId, consentId: null });
    await endConsultation(consulta);

    const { payload, provenance, stateDelta } = await new MockAnalysisProvider().analyze(
      bareAnalysisContext("doctor: Hola\npaciente: Hola"),
    );
    await appendClinicalState(A.clinicId, { patientId: p3, consultationId: consulta, delta: stateDelta, provenance });
    const reporte = await createReport(A.clinicId, { consultationId: consulta, patientId: p3, payload, provenance });
    await validateReport(reporte.id, A.userId);

    const nota = { consultationId: consulta, patientId: p3, objective: null, assessment: null, plan: null };
    await upsertSoapNote(A.clinicId, A.userId, { ...nota, subjective: "Nota Demo" });
    await upsertSoapNote(A.clinicId, A.userId, { ...nota, subjective: "Nota Demo editada" });
  });

  it("SÍ registra progreso coherente y notificaciones sin paciente", async () => {
    const progreso = await A.client
      .from("patient_progress")
      .insert({ clinic_id: A.clinicId, patient_id: r.p1, consultation_id: r.consultaConProgreso });
    expect(progreso.error).toBeNull();

    // notifications.patient_id admite nulo: sin paciente no hay nada que comparar.
    const aviso = await A.client.from("notifications").insert({
      clinic_id: A.clinicId,
      patient_id: null,
      appointment_id: r.cita,
      type: "appointment_reminder",
      status: "simulated",
    });
    expect(aviso.error).toBeNull();
  });

  it("service-role no pasa por el control, igual que en la 0044, la 0047 y la 0048", async () => {
    const cita = await citaDe(r.p1);
    await insertar("notifications", {
      clinic_id: A.clinicId,
      patient_id: r.p1,
      appointment_id: cita,
      type: "appointment_reminder",
      status: "simulated",
    });
    const { error } = await service().from("appointments").update({ patient_id: r.p2 }).eq("id", cita);
    expect(error).toBeNull();
  });
});

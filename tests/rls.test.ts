import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { encrypt } from "@/lib/crypto";
import type { VerificationStatus } from "@/lib/verification";

// Guarda de entorno: importar esto aborta la corrida si NEXT_PUBLIC_SUPABASE_URL
// no apunta a un stack local. Estas pruebas escriben con service-role y algunas
// purgan datos clínicos: contra producción serían destructivas.
import "./helpers/supabase-env";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasSupabase = Boolean(URL && ANON);

// Solo corre si hay un Supabase local accesible (saltado en CI sin stack).
const d = hasSupabase ? describe : describe.skip;
// Las pruebas de verificación necesitan además service-role para simular la
// aprobación del admin de plataforma.
const dv = hasSupabase && SERVICE ? describe : describe.skip;

function anon(): SupabaseClient {
  return createClient(URL!, ANON!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Cliente que salta RLS. Representa al admin de plataforma revisando. */
function service(): SupabaseClient {
  return createClient(URL!, SERVICE!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function signUpUser() {
  const client = anon();
  const email = `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@e-irene.test`;
  const { data, error } = await client.auth.signUp({ email, password: "Password123!" });
  expect(error).toBeNull();
  return { client, userId: data.user!.id };
}

/**
 * Aprueba (o cambia el estado de) una verificación como lo haría el admin de
 * plataforma: service-role, que es el único camino que el trigger
 * `enforce_verification_transition` deja abierto.
 */
async function setVerification(userId: string, status: VerificationStatus) {
  const { error } = await service()
    .from("users")
    .update({ verification_status: status })
    .eq("id", userId);
  expect(error).toBeNull();
}

/**
 * Crea una clínica con su admin. `verified` por defecto porque las pruebas de
 * aislamiento multi-tenant no van de verificación: sin aprobar, el admin no
 * podría ni crear un paciente y todas fallarían por la razón equivocada.
 */
async function bootstrapClinic(name: string, opts: { verified?: boolean } = {}) {
  const { client, userId } = await signUpUser();
  const { data: clinicId, error: rpcErr } = await client.rpc("create_clinic_and_admin", {
    clinic_name: name,
    full_name: "Doctor Test",
  });
  expect(rpcErr).toBeNull();
  if (opts.verified !== false) await setVerification(userId, "verified");
  return { client, clinicId: clinicId as string, userId };
}

d("aislamiento multi-tenant (RLS)", () => {
  let A: { client: SupabaseClient; clinicId: string; userId: string };
  let B: { client: SupabaseClient; clinicId: string; userId: string };

  beforeAll(async () => {
    A = await bootstrapClinic("Clínica A");
    B = await bootstrapClinic("Clínica B");
    // A registra un paciente en su clínica.
    const { error } = await A.client
      .from("patients")
      .insert({ clinic_id: A.clinicId, full_name_enc: encrypt("Paciente de A") });
    expect(error).toBeNull();
  }, 30000);

  it("las clínicas son distintas", () => {
    expect(A.clinicId).toBeTruthy();
    expect(B.clinicId).toBeTruthy();
    expect(A.clinicId).not.toBe(B.clinicId);
  });

  it("A ve su propio paciente", async () => {
    const { data } = await A.client.from("patients").select("id");
    expect((data ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it("B NO ve los pacientes de A", async () => {
    const { data } = await B.client.from("patients").select("id");
    expect(data ?? []).toHaveLength(0);
  });

  it("B NO puede insertar un paciente en la clínica de A (WITH CHECK)", async () => {
    const { error } = await B.client
      .from("patients")
      .insert({ clinic_id: A.clinicId, full_name_enc: encrypt("Intruso") });
    expect(error).not.toBeNull(); // RLS bloquea
  });

  // Las políticas UPDATE de 0001_init.sql solo declaran USING, sin WITH CHECK
  // explícito — pero Postgres reutiliza esa misma condición USING como CHECK
  // implícito de la fila resultante cuando no hay un WITH CHECK propio (ver
  // CREATE POLICY en la doc de Postgres). Por eso A no puede reasignar su
  // paciente a la clínica de B aunque no haya un WITH CHECK explícito en la
  // migración: no es un hueco, ya está cubierto. Verificado también con un
  // script aislado contra Supabase local antes de escribir esta prueba.
  it("A NO puede reasignar su propio paciente a la clínica de B (UPDATE)", async () => {
    const { data: patient } = await A.client
      .from("patients")
      .select("id")
      .limit(1)
      .single();
    const { error } = await A.client
      .from("patients")
      .update({ clinic_id: B.clinicId })
      .eq("id", patient!.id);
    expect(error).not.toBeNull(); // RLS bloquea

    // Y el paciente sigue siendo de A.
    const { data: stillA } = await service()
      .from("patients")
      .select("clinic_id")
      .eq("id", patient!.id)
      .single();
    expect(stillA?.clinic_id).toBe(A.clinicId);
  });

  it("A NO puede reasignar su propio reporte a la clínica de B (UPDATE)", async () => {
    const { data: patient } = await A.client.from("patients").select("id").limit(1).single();
    const { data: consultation, error: consultErr } = await A.client
      .from("consultations")
      .insert({ clinic_id: A.clinicId, patient_id: patient!.id, doctor_id: A.userId })
      .select("id")
      .single();
    expect(consultErr).toBeNull();
    const { data: report, error: reportErr } = await service()
      .from("reports")
      .insert({
        clinic_id: A.clinicId,
        consultation_id: consultation!.id,
        patient_id: patient!.id,
        payload_enc: encrypt("{}"),
      })
      .select("id")
      .single();
    expect(reportErr).toBeNull();

    const { error } = await A.client
      .from("reports")
      .update({ clinic_id: B.clinicId })
      .eq("id", report!.id);
    expect(error).not.toBeNull(); // RLS bloquea

    const { data: stillA } = await service()
      .from("reports")
      .select("clinic_id")
      .eq("id", report!.id)
      .single();
    expect(stillA?.clinic_id).toBe(A.clinicId);
  });

  it("B NO puede leer la clínica de A", async () => {
    const { data } = await B.client.from("clinics").select("id").eq("id", A.clinicId);
    expect(data ?? []).toHaveLength(0);
  });
});

/**
 * Las dos afirmaciones que sostienen todo el onboarding verificado y que solo
 * se pueden comprobar contra Postgres: que sin verificación no se crean
 * registros clínicos, y que nadie puede auto-verificarse.
 *
 * Ver migración 0032 y docs/superpowers/specs/2026-08-06-retencion-y-onboarding-
 * verificado-design.md
 */
dv("verificación profesional (RLS)", () => {
  let doc: { client: SupabaseClient; clinicId: string; userId: string };

  // Las aserciones negativas comprueban el CÓDIGO, no solo que hubo error: sin
  // esto, un fallo por una columna mal escrita haría pasar la prueba y
  // creeríamos tener un control que no existe.
  const RLS_VIOLATION = "42501"; // política de fila
  const RAISE_EXCEPTION = "P0001"; // raise del trigger

  beforeAll(async () => {
    // Sin aprobar: es el estado en que nace toda cuenta nueva.
    doc = await bootstrapClinic("Clínica sin verificar", { verified: false });
  }, 30000);

  it("una cuenta nueva nace sin verificar", async () => {
    const { data } = await service()
      .from("users")
      .select("verification_status")
      .eq("id", doc.userId)
      .single();
    expect(data?.verification_status).toBe("pending_documents");
  });

  // ── Lo que el control debe impedir ────────────────────────────────────────

  it("sin verificar NO puede crear pacientes", async () => {
    const { error } = await doc.client
      .from("patients")
      .insert({ clinic_id: doc.clinicId, full_name_enc: encrypt("Paciente") });
    expect(error?.code).toBe(RLS_VIOLATION);
  });

  it("sin verificar NO puede abrir consultas", async () => {
    // El paciente se crea con service-role: lo que se prueba es el insert de
    // la consulta, no el del paciente.
    const { data: patient } = await service()
      .from("patients")
      .insert({ clinic_id: doc.clinicId, full_name_enc: encrypt("Paciente previo") })
      .select("id")
      .single();

    const { error } = await doc.client.from("consultations").insert({
      clinic_id: doc.clinicId,
      patient_id: patient!.id,
      doctor_id: doc.userId,
    });
    expect(error?.code).toBe(RLS_VIOLATION);
  });

  it("NO puede auto-verificarse con un PATCH a su propia fila", async () => {
    const { error } = await doc.client
      .from("users")
      .update({ verification_status: "verified" })
      .eq("id", doc.userId);
    expect(error?.code).toBe(RAISE_EXCEPTION);
    expect(error?.message).toMatch(/solo puedes enviar tu verificación a revisión/i);

    // Y el estado no se movió.
    const { data } = await service()
      .from("users")
      .select("verification_status")
      .eq("id", doc.userId)
      .single();
    expect(data?.verification_status).toBe("pending_documents");
  });

  it("NO puede saltar directo a verificado ni pasando por revisión primero", async () => {
    await doc.client.from("users").update({ verification_status: "pending_review" }).eq("id", doc.userId);
    const { error } = await doc.client
      .from("users")
      .update({ verification_status: "verified" })
      .eq("id", doc.userId);
    expect(error?.code).toBe(RAISE_EXCEPTION);

    // Se deja como estaba para no arrastrar estado a las pruebas siguientes.
    await setVerification(doc.userId, "pending_documents");
  });

  it("NO puede asignarse a sí mismo como revisor", async () => {
    const { error } = await doc.client
      .from("users")
      .update({ verified_by: doc.userId })
      .eq("id", doc.userId);
    expect(error?.code).toBe(RAISE_EXCEPTION);
    expect(error?.message).toMatch(/solo el revisor puede asignar/i);
  });

  it("NO puede fijar la fecha de decisión", async () => {
    const { error } = await doc.client
      .from("users")
      .update({ verification_decided_at: new Date().toISOString() })
      .eq("id", doc.userId);
    expect(error?.code).toBe(RAISE_EXCEPTION);
    expect(error?.message).toMatch(/solo el revisor puede fijar la decisión/i);
  });

  it("un admin de clínica NO puede verificar a otro miembro de su clínica", async () => {
    // El perfil del colega lo crea el servidor (addMember, service-role): desde
    // la 0044 la sesión no inserta en users. Lo que se prueba es que el admin de
    // la clínica no pueda aprobarlo.
    const { userId: colegaId } = await signUpUser();
    await setVerification(doc.userId, "verified"); // el admin ya está habilitado
    const { error: insertErr } = await service().from("users").insert({
      id: colegaId,
      clinic_id: doc.clinicId,
      role: "doctor",
      full_name: "Colega",
      email: `colega_${colegaId.slice(0, 8)}@e-irene.test`,
    });
    expect(insertErr).toBeNull();

    const { error } = await doc.client
      .from("users")
      .update({ verification_status: "verified" })
      .eq("id", colegaId);
    expect(error?.code).toBe(RAISE_EXCEPTION);
    expect(error?.message).toMatch(/de otro usuario/i);

    await setVerification(doc.userId, "pending_documents");
  });

  // ── Lo que el control debe permitir ───────────────────────────────────────

  it("SÍ puede enviarse a revisión: es el único cambio de estado propio válido", async () => {
    const { error } = await doc.client
      .from("users")
      .update({ verification_status: "pending_review" })
      .eq("id", doc.userId);
    expect(error).toBeNull();

    await setVerification(doc.userId, "pending_documents");
  });

  it("una vez aprobado por el revisor, SÍ puede crear pacientes", async () => {
    await setVerification(doc.userId, "verified");
    const { error } = await doc.client
      .from("patients")
      .insert({ clinic_id: doc.clinicId, full_name_enc: encrypt("Paciente legítimo") });
    expect(error).toBeNull();
  });

  // ── Revocación ────────────────────────────────────────────────────────────

  it("suspender corta la creación de nuevos registros clínicos", async () => {
    await setVerification(doc.userId, "suspended");
    const { error } = await doc.client
      .from("patients")
      .insert({ clinic_id: doc.clinicId, full_name_enc: encrypt("Tras suspensión") });
    expect(error?.code).toBe(RLS_VIOLATION);
  });

  it("pero suspendido conserva la lectura: sigue siendo responsable de esas historias", async () => {
    const { data, error } = await doc.client.from("patients").select("id");
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThanOrEqual(1);
  });
});

dv("facturación: la clínica no puede reescribir su propio plan (RLS)", () => {
  // Hasta la migración 0041 la política clinic_update (0001) dejaba al admin de
  // una clínica actualizar CUALQUIER columna de su fila con un PATCH directo a
  // la API: subirse a enterprise sin pagar, fijarse un período pagado, quitarse
  // una suspensión o reiniciar su ciclo de cuota. Nada de eso se decide desde la
  // sesión de la clínica: lo escriben el webhook/cron (service-role) y las
  // funciones SECURITY DEFINER de plataforma y de cancelación.
  let A: { client: SupabaseClient; clinicId: string; userId: string };

  beforeAll(async () => {
    A = await bootstrapClinic("Clínica Facturación");
  }, 30000);

  async function clinicRow() {
    const { data, error } = await service()
      .from("clinics")
      .select("plan, billing_status, current_period_end, suspended_at")
      .eq("id", A.clinicId)
      .single();
    expect(error).toBeNull();
    return data!;
  }

  it("el admin NO puede subirse de plan con un PATCH directo a clinics", async () => {
    const { error } = await A.client
      .from("clinics")
      .update({ plan: "enterprise" })
      .eq("id", A.clinicId);
    expect(error).not.toBeNull();
    expect((await clinicRow()).plan).toBe("free");
  });

  it("tampoco puede fijarse estado de cobro, período pagado, ciclo, cancelación ni medio de pago", async () => {
    const patches: Record<string, unknown>[] = [
      { billing_status: "activo" },
      { current_period_end: "2099-01-01T00:00:00Z" },
      { billing_cycle_anchor: new Date().toISOString() },
      { cancel_at_period_end: true },
      { wompi_payment_source_id_enc: "token-inventado" },
    ];
    for (const patch of patches) {
      const { error } = await A.client.from("clinics").update(patch).eq("id", A.clinicId);
      expect(error, JSON.stringify(patch)).not.toBeNull();
    }
    const row = await clinicRow();
    expect(row.billing_status).toBe("sin_configurar");
    expect(row.current_period_end).toBeNull();
  });

  it("ni quitarse una suspensión impuesta por la plataforma", async () => {
    const { error: suspendErr } = await service()
      .from("clinics")
      .update({ suspended_at: new Date().toISOString() })
      .eq("id", A.clinicId);
    expect(suspendErr).toBeNull();

    const { error } = await A.client
      .from("clinics")
      .update({ suspended_at: null })
      .eq("id", A.clinicId);
    expect(error).not.toBeNull();
    expect((await clinicRow()).suspended_at).not.toBeNull();
  });
});

dv("perfiles: lo que la sesión no puede escribir (0044)", () => {
  let A: { client: SupabaseClient; clinicId: string; userId: string };

  beforeAll(async () => {
    A = await bootstrapClinic("Clínica Perfiles");
  }, 30000);

  it("un admin de clínica NO puede insertar perfiles con su sesión, ni ya verificados", async () => {
    const { userId: otraCuenta } = await signUpUser();
    const { error } = await A.client.from("users").insert({
      id: otraCuenta,
      clinic_id: A.clinicId,
      role: "doctor",
      full_name: "Colega Inventado",
      email: `colega_${otraCuenta.slice(0, 8)}@e-irene.test`,
      verification_status: "verified",
    });
    expect(error?.code).toBe("42501");

    const { data } = await service().from("users").select("id").eq("id", otraCuenta);
    expect(data ?? []).toHaveLength(0);
  });

  it("una secretaria NO puede cambiarse a admin con su sesión", async () => {
    const { client, userId } = await signUpUser();
    const { error: insertErr } = await service().from("users").insert({
      id: userId,
      clinic_id: A.clinicId,
      role: "secretaria",
      full_name: "Secretaria Demo",
      email: `secretaria_${userId.slice(0, 8)}@e-irene.test`,
    });
    expect(insertErr).toBeNull();

    const { error } = await client.from("users").update({ role: "admin" }).eq("id", userId);
    expect(error?.code).toBe("P0001");

    const { data } = await service().from("users").select("role").eq("id", userId).single();
    expect(data?.role).toBe("secretaria");
  });

  it("un envío a revisión NO acepta rutas de la carpeta de otro profesional", async () => {
    const doc = await bootstrapClinic("Clínica Rutas", { verified: false });
    const { error } = await doc.client
      .from("users")
      .update({
        verification_status: "pending_review",
        id_document_path: `${doc.clinicId}/${A.userId}/cedula.pdf`,
        license_document_path: `${doc.clinicId}/${doc.userId}/tarjeta.pdf`,
      })
      .eq("id", doc.userId);
    expect(error?.code).toBe("P0001");
  }, 30000);

  it("el envío a revisión reinicia la marca de purga y las huellas, aunque la sesión mande otra cosa", async () => {
    const doc = await bootstrapClinic("Clínica Purga", { verified: false });
    const { error: prepErr } = await service()
      .from("users")
      .update({ documents_purged_at: new Date().toISOString(), id_document_hash: "a".repeat(64) })
      .eq("id", doc.userId);
    expect(prepErr).toBeNull();

    const { error } = await doc.client
      .from("users")
      .update({
        verification_status: "pending_review",
        id_document_path: `${doc.clinicId}/${doc.userId}/cedula.pdf`,
        license_document_path: `${doc.clinicId}/${doc.userId}/tarjeta.pdf`,
        documents_purged_at: "2020-01-01T00:00:00Z",
      })
      .eq("id", doc.userId);
    expect(error).toBeNull();

    const { data } = await service()
      .from("users")
      .select("documents_purged_at, id_document_hash")
      .eq("id", doc.userId)
      .single();
    expect(data?.documents_purged_at).toBeNull();
    expect(data?.id_document_hash).toBeNull();
  }, 30000);
});

/**
 * Lo que una fila referencia tiene que ser de su misma clínica (0048). Las
 * políticas de escritura solo miran clinic_id y las FK solo exigen que la fila
 * referenciada exista: sin el trigger, la sesión de A escribía en su propia
 * clínica filas con pacientes, profesionales o registros de B, con INSERT y con
 * UPDATE.
 */
dv("referencias entre clínicas: la sesión no enlaza registros de otra clínica (0048)", () => {
  const RAISE_EXCEPTION = "P0001";

  type Clinica = { client: SupabaseClient; clinicId: string; userId: string };
  type Registros = {
    patient: string;
    appointment: string;
    consent: string;
    consultation: string;
    link: string;
    plan: string;
  };

  let A: Clinica;
  let B: Clinica;
  let a: Registros & {
    otherPatient: string;
    report: string;
    notification: string;
    progress: string;
    item: string;
    soap: string;
    soapConsultation: string;
  };
  let b: Registros;

  const manana = () => new Date(Date.now() + 86_400_000).toISOString();
  const mensaje = (tabla: string, columna: string) =>
    `${tabla}.${columna} tiene que apuntar a un registro de la misma clínica`;

  async function insertar(tabla: string, fila: Record<string, unknown>): Promise<string> {
    const { data, error } = await service().from(tabla).insert(fila).select("id").single();
    expect(error, tabla).toBeNull();
    return data!.id as string;
  }

  /** Lo mínimo de una clínica para referenciarlo, sembrado con service-role. */
  async function sembrar(c: Clinica): Promise<Registros> {
    const patient = await insertar("patients", { clinic_id: c.clinicId, full_name_enc: encrypt("Paciente Demo") });
    return {
      patient,
      appointment: await insertar("appointments", {
        clinic_id: c.clinicId,
        patient_id: patient,
        doctor_id: c.userId,
        scheduled_at: manana(),
      }),
      consent: await insertar("consents", {
        clinic_id: c.clinicId,
        patient_id: patient,
        document_version: "v1",
        document_hash: "0".repeat(64),
      }),
      consultation: await insertar("consultations", { clinic_id: c.clinicId, patient_id: patient, doctor_id: c.userId }),
      link: await insertar("patient_links", {
        clinic_id: c.clinicId,
        patient_id: patient,
        purpose: "consent",
        token_hash: crypto.randomUUID(),
        expires_at: manana(),
        created_by: c.userId,
      }),
      plan: await insertar("treatment_plans", {
        clinic_id: c.clinicId,
        patient_id: patient,
        title_enc: encrypt("Plan Demo"),
      }),
    };
  }

  beforeAll(async () => {
    A = await bootstrapClinic("Clínica Referencias A");
    B = await bootstrapClinic("Clínica Referencias B");
    b = await sembrar(B);
    const base = await sembrar(A);
    const soapConsultation = await insertar("consultations", {
      clinic_id: A.clinicId,
      patient_id: base.patient,
      doctor_id: A.userId,
    });
    a = {
      ...base,
      otherPatient: await insertar("patients", { clinic_id: A.clinicId, full_name_enc: encrypt("Paciente Demo") }),
      report: await insertar("reports", {
        clinic_id: A.clinicId,
        consultation_id: base.consultation,
        patient_id: base.patient,
        payload_enc: encrypt("{}"),
      }),
      notification: await insertar("notifications", {
        clinic_id: A.clinicId,
        patient_id: base.patient,
        appointment_id: base.appointment,
        type: "appointment_reminder",
      }),
      progress: await insertar("patient_progress", { clinic_id: A.clinicId, patient_id: base.patient }),
      item: await insertar("treatment_plan_items", {
        clinic_id: A.clinicId,
        plan_id: base.plan,
        type: "objetivo",
        description_enc: encrypt("Objetivo Demo"),
      }),
      soap: await insertar("soap_notes", {
        clinic_id: A.clinicId,
        consultation_id: soapConsultation,
        patient_id: base.patient,
      }),
      soapConsultation,
    };
  }, 60000);

  /** Para las tablas con una fila por consulta o por versión del paciente. */
  const consultaNueva = () =>
    insertar("consultations", { clinic_id: A.clinicId, patient_id: a.patient, doctor_id: A.userId });
  const pacienteNuevo = () =>
    insertar("patients", { clinic_id: A.clinicId, full_name_enc: encrypt("Paciente Demo") });

  /**
   * Una fila válida de A por tabla, con lo que escriben hoy las Server Actions:
   * registros de la propia clínica y el usuario de la sesión como autor.
   */
  const filaDeA: Record<string, () => Promise<Record<string, unknown>>> = {
    patients: async () => ({ clinic_id: A.clinicId, full_name_enc: encrypt("Paciente Demo"), created_by: A.userId }),
    // Como createAppointmentAction.
    appointments: async () => ({
      clinic_id: A.clinicId,
      patient_id: a.patient,
      doctor_id: A.userId,
      scheduled_at: manana(),
      duration_min: 50,
      status: "scheduled",
      modality: "video",
    }),
    // Como startVideoConsultationAction: paciente y doctor de la cita, con su consentimiento.
    consultations: async () => ({
      clinic_id: A.clinicId,
      patient_id: a.patient,
      doctor_id: A.userId,
      appointment_id: a.appointment,
      consent_id: a.consent,
      status: "in_progress",
    }),
    consents: async () => ({
      clinic_id: A.clinicId,
      patient_id: a.patient,
      document_version: "v1",
      document_hash: "0".repeat(64),
      link_id: a.link,
    }),
    transcript_chunks: async () => ({
      clinic_id: A.clinicId,
      consultation_id: a.consultation,
      seq: 1,
      speaker: "doctor",
      text_enc: encrypt("Hola"),
    }),
    reports: async () => ({
      clinic_id: A.clinicId,
      consultation_id: a.consultation,
      patient_id: a.patient,
      payload_enc: encrypt("{}"),
      validated_by: A.userId,
    }),
    patient_progress: async () => ({ clinic_id: A.clinicId, patient_id: a.patient, consultation_id: a.consultation }),
    notifications: async () => ({
      clinic_id: A.clinicId,
      patient_id: a.patient,
      appointment_id: a.appointment,
      type: "appointment_reminder",
      status: "simulated",
    }),
    clinic_doctors: async () => ({ clinic_id: A.clinicId, doctor_id: A.userId }),
    // Como createAssessment: la aplica el personal, sin enlace.
    psychometric_assessments: async () => ({
      clinic_id: A.clinicId,
      patient_id: a.patient,
      created_by: A.userId,
      type: "phq9",
      payload_enc: encrypt(JSON.stringify({ answers: [0, 0, 0, 0, 0, 0, 0, 0, 0], totalScore: 0, severity: "Mínima" })),
    }),
    treatment_plans: async () => ({
      clinic_id: A.clinicId,
      patient_id: a.patient,
      created_by: A.userId,
      title_enc: encrypt("Plan Demo"),
    }),
    treatment_plan_items: async () => ({
      clinic_id: A.clinicId,
      plan_id: a.plan,
      type: "objetivo",
      description_enc: encrypt("Objetivo Demo"),
    }),
    soap_notes: async () => ({
      clinic_id: A.clinicId,
      consultation_id: await consultaNueva(),
      patient_id: a.patient,
      created_by: A.userId,
    }),
    patient_links: async () => ({
      clinic_id: A.clinicId,
      patient_id: a.patient,
      created_by: A.userId,
      purpose: "consent",
      token_hash: crypto.randomUUID(),
      expires_at: manana(),
    }),
    patient_clinical_state: async () => ({
      clinic_id: A.clinicId,
      patient_id: await pacienteNuevo(),
      consultation_id: await consultaNueva(),
      version: 1,
      state_enc: encrypt("{}"),
      model: "mock",
      prompt_version: "v1",
    }),
  };

  // ── Lo que el control debe impedir ────────────────────────────────────────

  const insercionesAjenas: [tabla: string, columna: string, deB: () => string][] = [
    ["patients", "created_by", () => B.userId],
    ["appointments", "patient_id", () => b.patient],
    ["appointments", "doctor_id", () => B.userId],
    ["consultations", "patient_id", () => b.patient],
    ["consultations", "doctor_id", () => B.userId],
    ["consultations", "appointment_id", () => b.appointment],
    ["consultations", "consent_id", () => b.consent],
    ["consents", "patient_id", () => b.patient],
    ["consents", "link_id", () => b.link],
    ["transcript_chunks", "consultation_id", () => b.consultation],
    ["reports", "consultation_id", () => b.consultation],
    ["reports", "patient_id", () => b.patient],
    ["reports", "validated_by", () => B.userId],
    ["patient_progress", "patient_id", () => b.patient],
    ["patient_progress", "consultation_id", () => b.consultation],
    ["notifications", "patient_id", () => b.patient],
    ["notifications", "appointment_id", () => b.appointment],
    ["clinic_doctors", "doctor_id", () => B.userId],
    ["psychometric_assessments", "patient_id", () => b.patient],
    ["psychometric_assessments", "created_by", () => B.userId],
    ["psychometric_assessments", "link_id", () => b.link],
    ["treatment_plans", "patient_id", () => b.patient],
    ["treatment_plans", "created_by", () => B.userId],
    ["treatment_plan_items", "plan_id", () => b.plan],
    ["soap_notes", "consultation_id", () => b.consultation],
    ["soap_notes", "patient_id", () => b.patient],
    ["soap_notes", "created_by", () => B.userId],
    ["patient_links", "patient_id", () => b.patient],
    ["patient_links", "created_by", () => B.userId],
    ["patient_clinical_state", "patient_id", () => b.patient],
    ["patient_clinical_state", "consultation_id", () => b.consultation],
  ];

  for (const [tabla, columna, deB] of insercionesAjenas) {
    it(`NO inserta en ${tabla} con ${columna} de otra clínica`, async () => {
      const fila = { ...(await filaDeA[tabla]()), [columna]: deB() };
      const { error } = await A.client.from(tabla).insert(fila);
      expect(error?.code).toBe(RAISE_EXCEPTION);
      expect(error?.message).toMatch(mensaje(tabla, columna));
    });
  }

  const cambiosAjenos: [tabla: string, id: () => string, columna: string, deB: () => string][] = [
    ["patients", () => a.patient, "created_by", () => B.userId],
    ["appointments", () => a.appointment, "patient_id", () => b.patient],
    ["appointments", () => a.appointment, "doctor_id", () => B.userId],
    ["consultations", () => a.consultation, "patient_id", () => b.patient],
    ["consultations", () => a.consultation, "doctor_id", () => B.userId],
    ["consultations", () => a.consultation, "appointment_id", () => b.appointment],
    ["consultations", () => a.consultation, "consent_id", () => b.consent],
    ["reports", () => a.report, "consultation_id", () => b.consultation],
    ["reports", () => a.report, "patient_id", () => b.patient],
    ["reports", () => a.report, "validated_by", () => B.userId],
    ["patient_progress", () => a.progress, "patient_id", () => b.patient],
    ["patient_progress", () => a.progress, "consultation_id", () => b.consultation],
    ["notifications", () => a.notification, "patient_id", () => b.patient],
    ["notifications", () => a.notification, "appointment_id", () => b.appointment],
    ["treatment_plans", () => a.plan, "patient_id", () => b.patient],
    ["treatment_plans", () => a.plan, "created_by", () => B.userId],
    ["treatment_plan_items", () => a.item, "plan_id", () => b.plan],
    ["soap_notes", () => a.soap, "consultation_id", () => b.consultation],
    ["soap_notes", () => a.soap, "patient_id", () => b.patient],
    ["soap_notes", () => a.soap, "created_by", () => B.userId],
  ];

  for (const [tabla, id, columna, deB] of cambiosAjenos) {
    it(`NO cambia ${tabla}.${columna} a un registro de otra clínica`, async () => {
      const antes = await service().from(tabla).select(columna).eq("id", id()).single();
      expect(antes.error).toBeNull();

      const { error } = await A.client.from(tabla).update({ [columna]: deB() }).eq("id", id());
      expect(error?.code).toBe(RAISE_EXCEPTION);
      expect(error?.message).toMatch(mensaje(tabla, columna));

      const despues = await service().from(tabla).select(columna).eq("id", id()).single();
      expect(despues.data).toEqual(antes.data);
    });
  }

  it("NO acepta una referencia inexistente: mismo error que una de otra clínica", async () => {
    const fila = { ...(await filaDeA.consultations()), patient_id: crypto.randomUUID() };
    const { error } = await A.client.from("consultations").insert(fila);
    expect(error?.code).toBe(RAISE_EXCEPTION);
    expect(error?.message).toMatch(mensaje("consultations", "patient_id"));
  });

  // ── Lo que el control debe permitir ───────────────────────────────────────

  // clinic_doctors no se inserta con la sesión fuera del alta: su caso legítimo
  // es create_clinic_and_admin, cubierto abajo.
  for (const tabla of Object.keys(filaDeA).filter((t) => t !== "clinic_doctors")) {
    it(`SÍ inserta en ${tabla} con registros de su propia clínica`, async () => {
      const { error } = await A.client.from(tabla).insert(await filaDeA[tabla]());
      expect(error).toBeNull();
    });
  }

  it("create_clinic_and_admin SÍ sigue vinculando al admin en clinic_doctors", async () => {
    const { data, error } = await service()
      .from("clinic_doctors")
      .select("doctor_id")
      .eq("clinic_id", A.clinicId);
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.doctor_id)).toContain(A.userId);
  });

  it("SÍ reasigna la cita a otro paciente de su clínica, como updateAppointment", async () => {
    const { error } = await A.client
      .from("appointments")
      .update({
        patient_id: a.otherPatient,
        doctor_id: A.userId,
        scheduled_at: manana(),
        duration_min: 45,
        notes: null,
        modality: "video",
      })
      .eq("id", a.appointment);
    expect(error).toBeNull();

    const { data } = await service().from("appointments").select("patient_id").eq("id", a.appointment).single();
    expect(data?.patient_id).toBe(a.otherPatient);
  });

  it("SÍ cierra la consulta y valida el reporte, como endConsultation y validateReport", async () => {
    const cierre = await A.client
      .from("consultations")
      .update({ status: "ended", ended_at: new Date().toISOString() })
      .eq("id", a.consultation);
    expect(cierre.error).toBeNull();

    const validacion = await A.client
      .from("reports")
      .update({ validated_by: A.userId, validated_at: new Date().toISOString() })
      .eq("id", a.report);
    expect(validacion.error).toBeNull();
  });

  it("SÍ guarda la nota SOAP con upsert sobre la consulta, como upsertSoapNote", async () => {
    const { error } = await A.client.from("soap_notes").upsert(
      {
        clinic_id: A.clinicId,
        consultation_id: a.soapConsultation,
        patient_id: a.patient,
        created_by: A.userId,
        subjective_enc: encrypt("Nota Demo"),
      },
      { onConflict: "consultation_id" },
    );
    expect(error).toBeNull();
  });

  it("el admin de plataforma SÍ reprograma citas de otra clínica, como updateAppointmentAdmin", async () => {
    // Actúa con su sesión sobre clínicas que no son la suya: el control no
    // puede comparar contra auth_clinic_id(), y no mira referencias que no cambian.
    const { client, userId } = await signUpUser();
    const { error: grantErr } = await service().from("platform_admins").insert({ user_id: userId });
    expect(grantErr).toBeNull();

    const { data, error } = await client
      .from("appointments")
      .update({ scheduled_at: manana(), status: "confirmed" })
      .eq("id", b.appointment)
      .select("id");
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(1);
  });
});

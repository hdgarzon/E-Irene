import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { encrypt } from "@/lib/crypto";
import type { VerificationStatus } from "@/lib/verification";

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
    expect(error).not.toBeNull();
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
    expect(error).not.toBeNull();
  });

  it("NO puede auto-verificarse con un PATCH a su propia fila", async () => {
    const { error } = await doc.client
      .from("users")
      .update({ verification_status: "verified" })
      .eq("id", doc.userId);
    expect(error).not.toBeNull();

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
    expect(error).not.toBeNull();

    // Se deja como estaba para no arrastrar estado a las pruebas siguientes.
    await setVerification(doc.userId, "pending_documents");
  });

  it("NO puede asignarse a sí mismo como revisor", async () => {
    const { error } = await doc.client
      .from("users")
      .update({ verified_by: doc.userId })
      .eq("id", doc.userId);
    expect(error).not.toBeNull();
  });

  it("NO puede fijar la fecha de decisión", async () => {
    const { error } = await doc.client
      .from("users")
      .update({ verification_decided_at: new Date().toISOString() })
      .eq("id", doc.userId);
    expect(error).not.toBeNull();
  });

  it("un admin de clínica NO puede verificar a otro miembro de su clínica", async () => {
    // El admin de la clínica sí puede crear el perfil del colega (users_insert),
    // pero no aprobarlo.
    const { userId: colegaId } = await signUpUser();
    await setVerification(doc.userId, "verified"); // el admin ya está habilitado
    const { error: insertErr } = await doc.client.from("users").insert({
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
    expect(error).not.toBeNull();

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
    expect(error).not.toBeNull();
  });

  it("pero suspendido conserva la lectura: sigue siendo responsable de esas historias", async () => {
    const { data, error } = await doc.client.from("patients").select("id");
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThanOrEqual(1);
  });
});

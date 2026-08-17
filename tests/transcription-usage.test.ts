import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { encrypt } from "@/lib/crypto";

/**
 * Integración de la cuota de transcripción (migración 0039): begin/finalize,
 * aislamiento multi-tenant y bloqueo de acceso directo a la tabla. Igual que
 * rls.test.ts, solo corre contra un Supabase local con migraciones aplicadas.
 */

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
// bootstrapClinic necesita service-role para verificar al admin (ver abajo).
const hasSupabase = Boolean(URL && ANON && SERVICE);

const d = hasSupabase ? describe : describe.skip;

const FREE_LIMIT_SECONDS = 2 * 3600; // lib/plans.ts: plan free = 2 h/mes

function anon(): SupabaseClient {
  return createClient(URL!, ANON!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Cliente que salta RLS, para aprobar la verificación como lo haría el
 *  admin de plataforma (ver tests/rls.test.ts). */
function service(): SupabaseClient {
  return createClient(URL!, SERVICE!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Crea una clínica con su admin y lo verifica: desde la migración
 * 0032_professional_verification, insertar en patients/consultations exige
 * auth_can_access_clinical(), que requiere verification_status = 'verified'.
 * Sin este paso, todos los begin()/createConsultation() de este archivo
 * fallarían por RLS antes de llegar a probar la cuota.
 */
async function bootstrapClinic(name: string) {
  const client = anon();
  const email = `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@e-irene.test`;
  const { data: signUp, error: signErr } = await client.auth.signUp({
    email,
    password: "Password123!",
  });
  expect(signErr).toBeNull();
  const { data: clinicId, error: rpcErr } = await client.rpc("create_clinic_and_admin", {
    clinic_name: name,
    full_name: "Doctor Test",
  });
  expect(rpcErr).toBeNull();
  const { error: verifyErr } = await service()
    .from("users")
    .update({ verification_status: "verified" })
    .eq("id", signUp.user!.id);
  expect(verifyErr).toBeNull();
  return { client, clinicId: clinicId as string };
}

async function createConsultation(client: SupabaseClient, clinicId: string): Promise<string> {
  const { data: auth } = await client.auth.getUser();
  const doctorId = auth.user!.id;
  const { data: patient, error: pErr } = await client
    .from("patients")
    .insert({ clinic_id: clinicId, full_name_enc: encrypt("Paciente Cuota") })
    .select("id")
    .single();
  expect(pErr).toBeNull();
  const { data: consult, error: cErr } = await client
    .from("consultations")
    .insert({ clinic_id: clinicId, patient_id: patient!.id, doctor_id: doctorId })
    .select("id")
    .single();
  expect(cErr).toBeNull();
  return consult!.id as string;
}

async function begin(client: SupabaseClient, consultationId: string, limit: number | null) {
  const { data, error } = await client.rpc("begin_transcription_session", {
    p_consultation_id: consultationId,
    p_limit_seconds: limit,
  });
  return { data: data as { allowed: boolean; used_seconds: number } | null, error };
}

async function usage(client: SupabaseClient) {
  const { data, error } = await client.rpc("get_transcription_usage");
  expect(error).toBeNull();
  return data as { used_seconds: number; sessions: number };
}

d("cuota de transcripción (transcription_usage)", () => {
  let A: { client: SupabaseClient; clinicId: string };
  let B: { client: SupabaseClient; clinicId: string };
  let consultationA: string;

  beforeAll(async () => {
    A = await bootstrapClinic("Clínica Cuota A");
    B = await bootstrapClinic("Clínica Cuota B");
    consultationA = await createConsultation(A.client, A.clinicId);
  }, 30000);

  it("begin permite la primera sesión y es idempotente (recarga no duplica)", async () => {
    const first = await begin(A.client, consultationA, FREE_LIMIT_SECONDS);
    expect(first.error).toBeNull();
    expect(first.data?.allowed).toBe(true);

    const reload = await begin(A.client, consultationA, FREE_LIMIT_SECONDS);
    expect(reload.error).toBeNull();
    expect(reload.data?.allowed).toBe(true);

    const u = await usage(A.client);
    expect(u.sessions).toBe(1);
  });

  it("otra clínica no puede abrir sesión sobre una consulta ajena", async () => {
    const { error } = await begin(B.client, consultationA, FREE_LIMIT_SECONDS);
    expect(error).not.toBeNull(); // 'No autorizado'
  });

  it("finalize registra la duración real (ended_at − inicio de sesión)", async () => {
    // Simula una consulta de ~3 h: ended_at en el futuro respecto al begin.
    const endedAt = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
    const { error: updErr } = await A.client
      .from("consultations")
      .update({ status: "ended", ended_at: endedAt })
      .eq("id", consultationA);
    expect(updErr).toBeNull();

    const { error } = await A.client.rpc("finalize_transcription_session", {
      p_consultation_id: consultationA,
    });
    expect(error).toBeNull();

    const u = await usage(A.client);
    expect(u.used_seconds).toBeGreaterThanOrEqual(FREE_LIMIT_SECONDS);
    expect(u.used_seconds).toBeLessThanOrEqual(3 * 3600 + 120);
  });

  it("con la cuota agotada, begin niega la siguiente sesión", async () => {
    const consultation2 = await createConsultation(A.client, A.clinicId);
    const res = await begin(A.client, consultation2, FREE_LIMIT_SECONDS);
    expect(res.error).toBeNull();
    expect(res.data?.allowed).toBe(false);
    expect(Number(res.data?.used_seconds)).toBeGreaterThanOrEqual(FREE_LIMIT_SECONDS);

    // La sesión negada no registra consumo.
    const u = await usage(A.client);
    expect(u.sessions).toBe(1);
  });

  it("límite null = ilimitado (enterprise) siempre permite", async () => {
    const consultation3 = await createConsultation(A.client, A.clinicId);
    const res = await begin(A.client, consultation3, null);
    expect(res.error).toBeNull();
    expect(res.data?.allowed).toBe(true);
  });

  it("el consumo de A no afecta a B (aislamiento por tenant)", async () => {
    const u = await usage(B.client);
    expect(u.used_seconds).toBe(0);
    expect(u.sessions).toBe(0);

    const consultationB = await createConsultation(B.client, B.clinicId);
    const res = await begin(B.client, consultationB, FREE_LIMIT_SECONDS);
    expect(res.error).toBeNull();
    expect(res.data?.allowed).toBe(true);
  });

  it("la tabla está bloqueada al acceso directo (sin políticas ni grants)", async () => {
    const { error: selErr } = await A.client.from("transcription_usage").select("id");
    expect(selErr).not.toBeNull();

    const { error: insErr } = await A.client.from("transcription_usage").insert({
      clinic_id: A.clinicId,
      consultation_id: consultationA,
    });
    expect(insErr).not.toBeNull();
  });

  it("el RPC de plataforma exige platform admin", async () => {
    const { error } = await A.client.rpc("get_platform_transcription_usage");
    expect(error).not.toBeNull();
  });
});

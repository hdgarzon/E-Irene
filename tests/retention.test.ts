import { describe, it, expect } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { encrypt } from "@/lib/crypto";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const d = URL && SERVICE ? describe : describe.skip;

/**
 * Purga de transcripciones (migración 0033).
 *
 * Se ejecuta con service-role porque replica lo que hace el cron de las 03:00,
 * no una acción de usuario.
 *
 * Lo que más importa aquí es la rama que escribe en `audit_logs`: es la
 * evidencia de supresión que la política de tratamiento promete poder
 * demostrar ante la SIC. Prometer un borrado que no se puede probar es
 * exactamente el problema que esta migración vino a resolver.
 */
function svc(): SupabaseClient {
  return createClient(URL!, SERVICE!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

const DAYS = 24 * 60 * 60 * 1000;
const hace = (dias: number) => new Date(Date.now() - dias * DAYS).toISOString();

/** Clínica + doctor + paciente, todo por service-role (sin pasar por RLS). */
async function fixture(nombre: string) {
  const s = svc();
  const email = `ret_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@e-irene.test`;
  const { data: auth, error: authErr } = await s.auth.admin.createUser({
    email,
    password: "Password123!",
    email_confirm: true,
  });
  expect(authErr).toBeNull();

  const { data: clinic } = await s
    .from("clinics")
    .insert({ name: nombre, slug: `${nombre.toLowerCase().replace(/\W+/g, "-")}-${Date.now()}` })
    .select("id")
    .single();

  await s.from("users").insert({
    id: auth.user!.id,
    clinic_id: clinic!.id,
    role: "doctor",
    full_name: "Doctor Retención",
    email,
    verification_status: "verified",
  });

  const { data: patient } = await s
    .from("patients")
    .insert({ clinic_id: clinic!.id, full_name_enc: encrypt("Paciente") })
    .select("id")
    .single();

  return { s, clinicId: clinic!.id as string, doctorId: auth.user!.id, patientId: patient!.id as string };
}

/** Consulta con transcripción y fragmentos, en las fechas que se le indiquen. */
async function consultaCon(
  f: Awaited<ReturnType<typeof fixture>>,
  opts: { startedAt: string; endedAt: string | null; validatedAt?: string | null },
) {
  const { data: c } = await f.s
    .from("consultations")
    .insert({
      clinic_id: f.clinicId,
      patient_id: f.patientId,
      doctor_id: f.doctorId,
      transcript_enc: encrypt("Transcripción de la sesión"),
      started_at: opts.startedAt,
      ended_at: opts.endedAt,
    })
    .select("id")
    .single();

  await f.s.from("transcript_chunks").insert([
    { clinic_id: f.clinicId, consultation_id: c!.id, seq: 1, text_enc: encrypt("hola") },
    { clinic_id: f.clinicId, consultation_id: c!.id, seq: 2, text_enc: encrypt("adiós") },
  ]);

  if (opts.validatedAt !== undefined) {
    await f.s.from("reports").insert({
      clinic_id: f.clinicId,
      consultation_id: c!.id,
      patient_id: f.patientId,
      payload_enc: encrypt("{}"),
      validated_at: opts.validatedAt,
    });
  }

  return c!.id as string;
}

async function estado(f: Awaited<ReturnType<typeof fixture>>, id: string) {
  const { data: c } = await f.s
    .from("consultations")
    .select("transcript_enc, transcript_purged_at")
    .eq("id", id)
    .single();
  const { count } = await f.s
    .from("transcript_chunks")
    .select("id", { count: "exact", head: true })
    .eq("consultation_id", id);
  return { transcript: c?.transcript_enc, purgedAt: c?.transcript_purged_at, chunks: count ?? 0 };
}

d("purga de transcripciones", () => {
  it("borra la transcripción 30 días después de validar el reporte", async () => {
    const f = await fixture("Ret Validada");
    const id = await consultaCon(f, {
      startedAt: hace(40),
      endedAt: hace(40),
      validatedAt: hace(31),
    });

    expect((await estado(f, id)).chunks).toBe(2);
    await f.s.rpc("purge_expired_transcripts");

    const e = await estado(f, id);
    expect(e.transcript).toBeNull();
    expect(e.chunks).toBe(0);
    expect(e.purgedAt).not.toBeNull();
  }, 30000);

  it("NO borra si el reporte se validó hace menos de 30 días", async () => {
    const f = await fixture("Ret Reciente");
    const id = await consultaCon(f, {
      startedAt: hace(40),
      endedAt: hace(40),
      validatedAt: hace(10),
    });

    await f.s.rpc("purge_expired_transcripts");

    const e = await estado(f, id);
    expect(e.transcript).not.toBeNull();
    expect(e.chunks).toBe(2);
    expect(e.purgedAt).toBeNull();
  }, 30000);

  it("aplica el techo de 90 días aunque el reporte nunca se valide", async () => {
    const f = await fixture("Ret Techo");
    const id = await consultaCon(f, { startedAt: hace(100), endedAt: hace(100) });

    await f.s.rpc("purge_expired_transcripts");

    const e = await estado(f, id);
    expect(e.transcript).toBeNull();
    expect(e.chunks).toBe(0);
  }, 30000);

  it("purga consultas abandonadas, que nunca se cerraron (fuga de 0021)", async () => {
    const f = await fixture("Ret Abandonada");
    const id = await consultaCon(f, { startedAt: hace(100), endedAt: null });

    await f.s.rpc("purge_expired_transcripts");

    const e = await estado(f, id);
    expect(e.transcript).toBeNull();
    expect(e.chunks).toBe(0);
  }, 30000);

  it("borra los fragmentos huérfanos aunque transcript_enc ya fuera null (fuga de 0021)", async () => {
    const f = await fixture("Ret Huerfanos");
    const id = await consultaCon(f, { startedAt: hace(100), endedAt: hace(100) });
    // Simula una consolidación fallida: hay fragmentos pero no transcripción.
    await f.s.from("consultations").update({ transcript_enc: null }).eq("id", id);
    expect((await estado(f, id)).chunks).toBe(2);

    await f.s.rpc("purge_expired_transcripts");

    expect((await estado(f, id)).chunks).toBe(0);
  }, 30000);

  it("deja evidencia en audit_logs: es lo que la política promete poder demostrar", async () => {
    const f = await fixture("Ret Auditoría");
    await consultaCon(f, { startedAt: hace(100), endedAt: hace(100) });

    await f.s.rpc("purge_expired_transcripts");

    const { data } = await f.s
      .from("audit_logs")
      .select("action, entity_type, metadata")
      .eq("clinic_id", f.clinicId)
      .eq("action", "transcript.purge");

    expect(data ?? []).toHaveLength(1);
    expect(data![0].entity_type).toBe("consultations");
    expect((data![0].metadata as { purged_count: number }).purged_count).toBe(1);
  }, 30000);

  it("es idempotente: una segunda corrida no vuelve a registrar la misma purga", async () => {
    const f = await fixture("Ret Idempotente");
    await consultaCon(f, { startedAt: hace(100), endedAt: hace(100) });

    await f.s.rpc("purge_expired_transcripts");
    await f.s.rpc("purge_expired_transcripts");

    const { count } = await f.s
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", f.clinicId)
      .eq("action", "transcript.purge");
    expect(count).toBe(1);
  }, 30000);
});

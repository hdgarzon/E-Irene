import { describe, it, expect } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { encrypt } from "@/lib/crypto";
import { purgeExpiredAccountIdentities, runDueAccountDeletions } from "@/lib/db/account-deletion";

// Guarda de entorno: importar esto aborta la corrida si NEXT_PUBLIC_SUPABASE_URL
// no apunta a un stack local. Estas pruebas escriben con service-role y
// suprimen datos clínicos: contra producción serían destructivas.
import "./helpers/supabase-env";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const d = URL && ANON && SERVICE ? describe : describe.skip;

/**
 * Eliminación de la cuenta (migración 0062; Términos de Vinculación, cláusula
 * séptima, numeral 5). Lo que importa: tras el plazo se suprime TODO lo clínico
 * de la clínica y nada de lo que la cláusula ordena conservar (identificación,
 * auditoría, facturación); antes del plazo, o tras desistir, no se toca nada; y
 * una clínica no puede pedir ni ver la eliminación de otra.
 */
function anon(): SupabaseClient {
  return createClient(URL!, ANON!, { auth: { autoRefreshToken: false, persistSession: false } });
}
function svc(): SupabaseClient {
  return createClient(URL!, SERVICE!, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function clinica(nombre: string) {
  const client = anon();
  const email = `del_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@e-irene.test`;
  const { data, error } = await client.auth.signUp({ email, password: "Password123!" });
  expect(error).toBeNull();
  const { data: clinicId, error: rpcError } = await client.rpc("create_clinic_and_admin", {
    clinic_name: nombre,
    full_name: "Doctor Demo",
  });
  expect(rpcError).toBeNull();
  return { client, userId: data.user!.id, clinicId: clinicId as string };
}

/** Paciente con un poco de todo lo clínico, insertado con service-role. */
async function pacienteConHistoria(c: Awaited<ReturnType<typeof clinica>>) {
  const s = svc();
  const { data: patient } = await s
    .from("patients")
    .insert({ clinic_id: c.clinicId, full_name_enc: encrypt("Paciente Demo") })
    .select("id")
    .single();
  const patientId = patient!.id as string;

  const { data: consent } = await s
    .from("consents")
    .insert({ clinic_id: c.clinicId, patient_id: patientId, document_version: "v", document_hash: "h" })
    .select("id")
    .single();
  const { data: consultation } = await s
    .from("consultations")
    .insert({
      clinic_id: c.clinicId,
      patient_id: patientId,
      doctor_id: c.userId,
      consent_id: consent!.id,
      transcript_enc: encrypt("Transcripción"),
    })
    .select("id")
    .single();
  await s.from("transcript_chunks").insert({
    clinic_id: c.clinicId,
    consultation_id: consultation!.id,
    seq: 1,
    text_enc: encrypt("hola"),
  });
  await s.from("reports").insert({
    clinic_id: c.clinicId,
    consultation_id: consultation!.id,
    patient_id: patientId,
    payload_enc: encrypt("{}"),
  });
  const { error: stateError } = await s.from("patient_clinical_state").insert({
    clinic_id: c.clinicId,
    patient_id: patientId,
    version: 1,
    consultation_id: consultation!.id,
    state_enc: encrypt("{}"),
    model: "mock",
    prompt_version: "v1",
  });
  expect(stateError).toBeNull();
  return patientId;
}

async function contar(table: string, clinicId: string): Promise<number> {
  const { count, error } = await svc()
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinicId);
  expect(error).toBeNull();
  return count!;
}

/** Simula que pasaron los 30 días. */
async function vencer(requestId: string) {
  const { error } = await svc()
    .from("account_deletion_requests")
    .update({ scheduled_for: new Date(Date.now() - 60_000).toISOString() })
    .eq("id", requestId);
  expect(error).toBeNull();
}

async function ejecutar(requestId: string) {
  const { data, error } = await svc().rpc("execute_account_deletion", { p_request: requestId });
  expect(error).toBeNull();
  return data as number | null;
}

const CLINICAS = [
  "consents",
  "consultations",
  "transcript_chunks",
  "reports",
  "patient_clinical_state",
];

d("eliminación de la cuenta (migración 0062)", () => {
  it("la solicitud queda a 30 días y antes del plazo no se suprime nada", async () => {
    const c = await clinica("Del Plazo");
    await pacienteConHistoria(c);

    const { data: req, error } = await c.client.rpc("request_account_deletion");
    expect(error).toBeNull();
    const days = (new Date(req.scheduled_for).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);

    expect(await ejecutar(req.id)).toBeNull();
    expect(await contar("patients", c.clinicId)).toBe(1);
  }, 30000);

  it("vencido el plazo suprime lo clínico y conserva identificación, auditoría y aceptaciones", async () => {
    const c = await clinica("Del Ejecuta");
    await pacienteConHistoria(c);
    await pacienteConHistoria(c);
    const { error: polErr } = await c.client.from("policy_acceptances").insert({
      user_id: c.userId,
      clinic_id: c.clinicId,
      document_version: "v",
      document_hash: "h",
    });
    expect(polErr).toBeNull();

    // Sin esto la prueba pasaría en vacío si un insert del fixture fallara.
    for (const table of CLINICAS) expect(await contar(table, c.clinicId)).toBeGreaterThan(0);

    const { data: req } = await c.client.rpc("request_account_deletion");
    await vencer(req.id);
    expect(await ejecutar(req.id)).toBe(2);

    expect(await contar("patients", c.clinicId)).toBe(0);
    for (const table of CLINICAS) expect(await contar(table, c.clinicId)).toBe(0);

    // Se conservan: la clínica (marcada), sus usuarios, la auditoría y la prueba
    // de aceptación.
    const { data: clinic } = await svc()
      .from("clinics")
      .select("deleted_at, suspended_at, plan")
      .eq("id", c.clinicId)
      .single();
    expect(clinic!.deleted_at).not.toBeNull();
    expect(clinic!.suspended_at).not.toBeNull();
    expect(clinic!.plan).toBe("free");
    expect(await contar("users", c.clinicId)).toBe(1);
    expect(await contar("policy_acceptances", c.clinicId)).toBe(1);

    const { data: audit } = await svc()
      .from("audit_logs")
      .select("action, metadata")
      .eq("clinic_id", c.clinicId)
      .in("action", ["account.deletion_requested", "account.deleted"]);
    expect((audit ?? []).map((a) => a.action).sort()).toEqual([
      "account.deleted",
      "account.deletion_requested",
    ]);

    // Idempotente: una segunda corrida no hace nada.
    expect(await ejecutar(req.id)).toBeNull();
  }, 30000);

  it("con un plan pago y medio de pago guardado, cancela la renovación al solicitar", async () => {
    const c = await clinica("Del Plan");
    const { error } = await svc()
      .from("clinics")
      .update({
        plan: "pro",
        current_period_end: new Date(Date.now() + 10 * 86_400_000).toISOString(),
        wompi_payment_source_id_enc: encrypt("ps_test_xxx"),
      })
      .eq("id", c.clinicId);
    expect(error).toBeNull();

    await c.client.rpc("request_account_deletion");

    const { data: clinic } = await svc()
      .from("clinics")
      .select("cancel_at_period_end, plan")
      .eq("id", c.clinicId)
      .single();
    // Conserva lo pagado hasta el fin del período, pero no se vuelve a cobrar.
    expect(clinic!.cancel_at_period_end).toBe(true);
    expect(clinic!.plan).toBe("pro");
  }, 30000);

  it("si la clínica desiste, la solicitud vencida no se ejecuta", async () => {
    const c = await clinica("Del Desiste");
    await pacienteConHistoria(c);
    const { data: req } = await c.client.rpc("request_account_deletion");
    const { data: cancelled } = await c.client.rpc("cancel_account_deletion");
    expect(cancelled).toBe(true);

    await vencer(req.id);
    expect(await ejecutar(req.id)).toBeNull();
    expect(await contar("patients", c.clinicId)).toBe(1);
  }, 30000);

  it("vencido el plazo ya no se puede desistir", async () => {
    const c = await clinica("Del Tarde");
    const { data: req } = await c.client.rpc("request_account_deletion");
    await vencer(req.id);
    const { data: cancelled } = await c.client.rpc("cancel_account_deletion");
    expect(cancelled).toBe(false);
  }, 30000);

  it("pedir dos veces devuelve la misma solicitud abierta", async () => {
    const c = await clinica("Del Doble");
    const { data: a } = await c.client.rpc("request_account_deletion");
    const { data: b } = await c.client.rpc("request_account_deletion");
    expect(b.id).toBe(a.id);
  }, 30000);

  it("una clínica no ve ni desiste la solicitud de otra", async () => {
    const a = await clinica("Del A");
    const b = await clinica("Del B");
    const { data: req } = await a.client.rpc("request_account_deletion");

    const { data: visto } = await b.client.from("account_deletion_requests").select("id").eq("id", req.id);
    expect(visto ?? []).toHaveLength(0);
    const { data: cancelled } = await b.client.rpc("cancel_account_deletion");
    expect(cancelled).toBe(false);

    const { data: sigue } = await svc()
      .from("account_deletion_requests")
      .select("cancelled_at")
      .eq("id", req.id)
      .single();
    expect(sigue!.cancelled_at).toBeNull();
  }, 30000);

  it("un usuario no puede ejecutar la eliminación por su cuenta", async () => {
    const c = await clinica("Del Usuario");
    const { data: req } = await c.client.rpc("request_account_deletion");
    await vencer(req.id);
    const { error } = await c.client.rpc("execute_account_deletion", { p_request: req.id });
    expect(error).not.toBeNull();
    expect(await contar("account_deletion_requests", c.clinicId)).toBe(1);
  }, 30000);

  it("fuera de la eliminación, el estado clínico sigue siendo inmutable", async () => {
    const c = await clinica("Del Inmutable");
    const patientId = await pacienteConHistoria(c);
    const { error } = await svc().from("patient_clinical_state").delete().eq("patient_id", patientId);
    expect(error?.message).toMatch(/inmutable/);
  }, 30000);

  it("el cron borra los archivos de la clínica, bloquea el acceso y suprime los datos", async () => {
    const c = await clinica("Del Cron");
    await pacienteConHistoria(c);
    const firma = `${c.clinicId}/firma-${Date.now()}.png`;
    const { error: upErr } = await svc()
      .storage.from("signatures")
      .upload(firma, new Uint8Array([137, 80, 78, 71]), { contentType: "image/png" });
    expect(upErr).toBeNull();

    const { data: req } = await c.client.rpc("request_account_deletion");
    await vencer(req.id);
    const run = await runDueAccountDeletions();
    expect(run.failed).toBe(0);

    const { data: files } = await svc().storage.from("signatures").list(c.clinicId);
    expect(files ?? []).toHaveLength(0);
    expect(await contar("patients", c.clinicId)).toBe(0);

    const { data: auth } = await svc().auth.admin.getUserById(c.userId);
    expect(new Date(auth.user!.banned_until!).getTime()).toBeGreaterThan(Date.now());
  }, 60000);
});

/** Clínica ya eliminada, con una aceptación de la política, y fechada `dias` atrás. */
async function clinicaEliminada(nombre: string, dias: number) {
  const c = await clinica(nombre);
  const { error: polErr } = await c.client.from("policy_acceptances").insert({
    user_id: c.userId,
    clinic_id: c.clinicId,
    document_version: "v",
    document_hash: "h",
  });
  expect(polErr).toBeNull();
  const { data: req } = await c.client.rpc("request_account_deletion");
  await vencer(req.id);
  await ejecutar(req.id);
  const { error } = await svc()
    .from("clinics")
    .update({ deleted_at: new Date(Date.now() - dias * 86_400_000).toISOString() })
    .eq("id", c.clinicId);
  expect(error).toBeNull();
  return c;
}

d("supresión de la identificación 2 años después (migración 0063)", () => {
  it("antes de 2 años conserva usuarios, cuentas de acceso y aceptaciones", async () => {
    const c = await clinicaEliminada("Ident Reciente", 700);
    const { data } = await svc().rpc("purge_deleted_account_identity", { p_clinic: c.clinicId });
    expect(data).toEqual([]);
    expect(await contar("users", c.clinicId)).toBe(1);
    expect(await contar("policy_acceptances", c.clinicId)).toBe(1);
  }, 60000);

  it("vencidos los 2 años suprime usuarios, cuentas de acceso y aceptaciones, y conserva la clínica", async () => {
    const c = await clinicaEliminada("Ident Vencida", 2 * 366);

    const run = await purgeExpiredAccountIdentities();
    expect(run.failed).toBe(0);

    expect(await contar("users", c.clinicId)).toBe(0);
    expect(await contar("policy_acceptances", c.clinicId)).toBe(0);
    const { data: auth } = await svc().auth.admin.getUserById(c.userId);
    expect(auth.user).toBeNull();

    const { data: clinic } = await svc()
      .from("clinics")
      .select("identity_purged_at, deleted_at")
      .eq("id", c.clinicId)
      .single();
    expect(clinic!.identity_purged_at).not.toBeNull();

    // La solicitud de eliminación y la auditoría quedan, sin datos personales.
    const { data: req } = await svc()
      .from("account_deletion_requests")
      .select("requested_by")
      .eq("clinic_id", c.clinicId)
      .single();
    expect(req!.requested_by).toBeNull();
    const { data: audit } = await svc()
      .from("audit_logs")
      .select("action")
      .eq("clinic_id", c.clinicId)
      .eq("action", "account.identity_purged");
    expect(audit ?? []).toHaveLength(1);

    // Idempotente.
    const { data: again } = await svc().rpc("purge_deleted_account_identity", { p_clinic: c.clinicId });
    expect(again).toEqual([]);
  }, 60000);

  it("no toca a un admin de plataforma de la clínica eliminada", async () => {
    const c = await clinicaEliminada("Ident Admin", 2 * 366);
    const { error } = await svc().from("platform_admins").insert({ user_id: c.userId });
    expect(error).toBeNull();

    const { data } = await svc().rpc("purge_deleted_account_identity", { p_clinic: c.clinicId });
    expect(data).toEqual([]);
    const { data: user } = await svc().from("users").select("full_name").eq("id", c.userId).single();
    expect(user!.full_name).toBe("Doctor Demo");
  }, 60000);

  it("fuera de la supresión, las aceptaciones siguen siendo inmutables", async () => {
    const c = await clinica("Ident Inmutable");
    await c.client.from("policy_acceptances").insert({
      user_id: c.userId,
      clinic_id: c.clinicId,
      document_version: "v",
      document_hash: "h",
    });
    const { error } = await svc().from("policy_acceptances").delete().eq("clinic_id", c.clinicId);
    expect(error?.message).toMatch(/inmutable/);
  }, 30000);
});

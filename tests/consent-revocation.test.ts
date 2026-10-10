import { describe, it, expect } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { encrypt } from "@/lib/crypto";

// Guarda de entorno: importar esto aborta la corrida si NEXT_PUBLIC_SUPABASE_URL
// no apunta a un stack local.
import "./helpers/supabase-env";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const d = URL && ANON && SERVICE ? describe : describe.skip;

/** Revocación del consentimiento (migración 0064; Consentimiento, cláusula novena). */
function anon(): SupabaseClient {
  return createClient(URL!, ANON!, { auth: { autoRefreshToken: false, persistSession: false } });
}
function svc(): SupabaseClient {
  return createClient(URL!, SERVICE!, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function clinicaConPaciente(nombre: string) {
  const client = anon();
  const email = `rev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@e-irene.test`;
  const { error } = await client.auth.signUp({ email, password: "Password123!" });
  expect(error).toBeNull();
  const { data: clinicId } = await client.rpc("create_clinic_and_admin", {
    clinic_name: nombre,
    full_name: "Doctor Demo",
  });
  const { data: patient } = await svc()
    .from("patients")
    .insert({ clinic_id: clinicId, full_name_enc: encrypt("Paciente Demo") })
    .select("id")
    .single();
  const { error: cErr } = await svc()
    .from("consents")
    .insert({ clinic_id: clinicId, patient_id: patient!.id, document_version: "v", document_hash: "h" });
  expect(cErr).toBeNull();
  return { client, clinicId: clinicId as string, patientId: patient!.id as string };
}

async function vigentes(patientId: string) {
  const { count } = await svc()
    .from("consents")
    .select("id", { count: "exact", head: true })
    .eq("patient_id", patientId)
    .is("revoked_at", null);
  return count!;
}

d("revocación del consentimiento (migración 0064)", () => {
  it("revoca las firmas vigentes, conserva las filas y deja constancia", async () => {
    const c = await clinicaConPaciente("Rev Propia");
    const { data, error } = await c.client.rpc("revoke_patient_consent", {
      p_patient: c.patientId,
      p_note: "Lo pidió por teléfono",
    });
    expect(error).toBeNull();
    expect(data).toBe(1);
    expect(await vigentes(c.patientId)).toBe(0);

    const { data: firma } = await svc()
      .from("consents")
      .select("revoked_at, revocation_note")
      .eq("patient_id", c.patientId)
      .single();
    expect(firma!.revoked_at).not.toBeNull();
    expect(firma!.revocation_note).toBe("Lo pidió por teléfono");

    const { data: audit } = await svc()
      .from("audit_logs")
      .select("action")
      .eq("clinic_id", c.clinicId)
      .eq("action", "consent.revoked");
    expect(audit ?? []).toHaveLength(1);

    // Sin firmas vigentes, una segunda revocación no hace nada.
    const { data: otra } = await c.client.rpc("revoke_patient_consent", { p_patient: c.patientId });
    expect(otra).toBe(0);
  }, 30000);

  it("otra clínica no puede revocar el consentimiento de un paciente ajeno", async () => {
    const a = await clinicaConPaciente("Rev A");
    const b = await clinicaConPaciente("Rev B");
    const { error } = await b.client.rpc("revoke_patient_consent", { p_patient: a.patientId });
    expect(error?.message).toMatch(/No autorizado/);
    expect(await vigentes(a.patientId)).toBe(1);
  }, 30000);

  it("sin sesión no se puede revocar", async () => {
    const a = await clinicaConPaciente("Rev Anon");
    const { error } = await anon().rpc("revoke_patient_consent", { p_patient: a.patientId });
    expect(error).not.toBeNull();
    expect(await vigentes(a.patientId)).toBe(1);
  }, 30000);

  it("las firmas siguen sin poder editarse directamente", async () => {
    const a = await clinicaConPaciente("Rev Directa");
    await a.client.from("consents").update({ revoked_at: new Date().toISOString() }).eq("patient_id", a.patientId);
    expect(await vigentes(a.patientId)).toBe(1);
  }, 30000);
});

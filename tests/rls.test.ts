import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { encrypt } from "@/lib/crypto";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const hasSupabase = Boolean(URL && ANON);

// Solo corre si hay un Supabase local accesible (saltado en CI sin stack).
const d = hasSupabase ? describe : describe.skip;

function anon(): SupabaseClient {
  return createClient(URL!, ANON!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function bootstrapClinic(name: string) {
  const client = anon();
  const email = `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@e-irene.test`;
  const { error: signErr } = await client.auth.signUp({ email, password: "Password123!" });
  expect(signErr).toBeNull();
  const { data: clinicId, error: rpcErr } = await client.rpc("create_clinic_and_admin", {
    clinic_name: name,
    full_name: "Doctor Test",
  });
  expect(rpcErr).toBeNull();
  return { client, clinicId: clinicId as string };
}

d("aislamiento multi-tenant (RLS)", () => {
  let A: { client: SupabaseClient; clinicId: string };
  let B: { client: SupabaseClient; clinicId: string };

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

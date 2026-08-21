import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { POLICY_HASH, POLICY_TEXT, POLICY_VERSION, sha256 } from "@/lib/legal";

// Guarda de entorno: importar esto aborta la corrida si NEXT_PUBLIC_SUPABASE_URL
// no apunta a un stack local. Estas pruebas escriben con service-role y algunas
// purgan datos clínicos: contra producción serían destructivas.
import "./helpers/supabase-env";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const d = URL && ANON && SERVICE ? describe : describe.skip;

function anon(): SupabaseClient {
  return createClient(URL!, ANON!, { auth: { autoRefreshToken: false, persistSession: false } });
}
function service(): SupabaseClient {
  return createClient(URL!, SERVICE!, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function bootstrapClinic(name: string) {
  const client = anon();
  const email = `pol_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@e-irene.test`;
  const { data, error } = await client.auth.signUp({ email, password: "Password123!" });
  expect(error).toBeNull();
  const { data: clinicId } = await client.rpc("create_clinic_and_admin", {
    clinic_name: name,
    full_name: "Doctor Test",
  });
  return { client, clinicId: clinicId as string, userId: data.user!.id };
}

describe("documento de política", () => {
  it("el hash corresponde al texto y la versión vigentes", () => {
    expect(POLICY_HASH).toBe(sha256(`${POLICY_VERSION}\n${POLICY_TEXT}`));
  });

  it("cambiar el texto cambia el hash: es lo que prueba QUÉ se aceptó", () => {
    expect(sha256(`${POLICY_VERSION}\n${POLICY_TEXT} `)).not.toBe(POLICY_HASH);
  });

  it("cambiar la versión cambia el hash aunque el texto sea idéntico", () => {
    expect(sha256(`otra-version\n${POLICY_TEXT}`)).not.toBe(POLICY_HASH);
  });

  it("el aviso menciona los puntos que la Ley 1581 exige informar", () => {
    // No es cosmético: si alguien recorta el texto, el aviso deja de cumplir el
    // contenido mínimo del Decreto 1074 de 2015.
    for (const termino of [
      "Responsable",
      "Encargado",
      "ReTHUS",
      "Superintendencia de Industria y Comercio",
      "transferencia internacional",
      "revocar",
    ]) {
      expect(POLICY_TEXT).toContain(termino);
    }
  });
});

d("aceptación de la política (RLS)", () => {
  let A: Awaited<ReturnType<typeof bootstrapClinic>>;
  let B: Awaited<ReturnType<typeof bootstrapClinic>>;

  beforeAll(async () => {
    A = await bootstrapClinic("Pol A");
    B = await bootstrapClinic("Pol B");
  }, 30000);

  it("un usuario puede registrar su propia aceptación", async () => {
    const { error } = await A.client.from("policy_acceptances").insert({
      user_id: A.userId,
      clinic_id: A.clinicId,
      document_version: POLICY_VERSION,
      document_hash: POLICY_HASH,
      ip: "127.0.0.1",
      user_agent: "vitest",
    });
    expect(error).toBeNull();
  });

  it("NO puede aceptar en nombre de otro usuario", async () => {
    const { error } = await B.client.from("policy_acceptances").insert({
      user_id: A.userId,
      clinic_id: A.clinicId,
      document_version: POLICY_VERSION,
      document_hash: POLICY_HASH,
    });
    expect(error?.code).toBe("42501");
  });

  it("NO ve las aceptaciones de otros", async () => {
    const { data } = await B.client.from("policy_acceptances").select("id");
    expect(data ?? []).toHaveLength(0);
  });

  it("ve la suya", async () => {
    const { data } = await A.client.from("policy_acceptances").select("id, document_version");
    expect((data ?? []).length).toBeGreaterThanOrEqual(1);
    expect(data![0].document_version).toBe(POLICY_VERSION);
  });

  it("es inmutable: no se puede editar la prueba", async () => {
    const { error } = await service()
      .from("policy_acceptances")
      .update({ marketing_opt_in: true })
      .eq("user_id", A.userId);
    expect(error?.message).toMatch(/inmutable/i);
  });

  it("es inmutable: no se puede borrar la prueba, ni con service-role", async () => {
    const { error } = await service()
      .from("policy_acceptances")
      .delete()
      .eq("user_id", A.userId);
    expect(error?.message).toMatch(/inmutable/i);
  });

  it("el opt-in comercial se guarda aparte de la aceptación contractual", async () => {
    const { data } = await A.client
      .from("policy_acceptances")
      .select("marketing_opt_in")
      .eq("user_id", A.userId)
      .single();
    // No se marcó al insertar: la casilla comercial es independiente y opcional.
    expect(data?.marketing_opt_in).toBe(false);
  });
});

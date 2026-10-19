import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { decrypt, encrypt } from "@/lib/crypto";
import { computeTrigrams, patientSearchText } from "@/lib/search-index";
import { keyRotationStatus, rotateEncryptedData } from "@/lib/key-rotation";

// Guarda de entorno: importar esto aborta la corrida si NEXT_PUBLIC_SUPABASE_URL
// no apunta a un stack local. Esta prueba recifra datos (solo de su clínica).
import "./helpers/supabase-env";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const d = URL && ANON && SERVICE ? describe : describe.skip;

/**
 * Rotación de ENCRYPTION_KEY (migración 0066, lib/key-rotation.ts). Simula el
 * procedimiento real: datos cifrados con la clave 1 (la de .env.local), cambio
 * del entorno a la clave 2 con la 1 retirada, y pasada de recifrado. Se limita a
 * la clínica de la prueba para no tocar los datos de las demás suites.
 */
function svc(): SupabaseClient {
  return createClient(URL!, SERVICE!, { auth: { autoRefreshToken: false, persistSession: false } });
}

const K1 = process.env.ENCRYPTION_KEY!;
const K2 = randomBytes(32).toString("base64");
const ENV_KEYS = ["ENCRYPTION_KEY", "ENCRYPTION_KEY_ID", "ENCRYPTION_KEY_NEXT", "ENCRYPTION_KEY_NEXT_ID", "ENCRYPTION_KEYS_RETIRED"] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

/** Paso 1 del procedimiento: la nueva entra como NEXT; ENCRYPTION_KEY sigue siendo la 1. */
function useKey2() {
  process.env.ENCRYPTION_KEY = K1;
  process.env.ENCRYPTION_KEY_ID = "1";
  process.env.ENCRYPTION_KEY_NEXT = K2;
  process.env.ENCRYPTION_KEY_NEXT_ID = "2";
}

d("rotación de la clave de cifrado (migración 0066)", () => {
  let clinicId: string;
  let patientId: string;
  let stateId: string;
  let eventId: string;
  let patientUpdatedAt: string;

  beforeAll(async () => {
    // Todo esto se cifra con la clave 1 (formato sin prefijo).
    const s = svc();
    const { data: clinic } = await s
      .from("clinics")
      .insert({ name: "Rotación Demo", slug: `rotacion-${Date.now()}`, wompi_payment_source_id_enc: encrypt("ps_test_xxx") })
      .select("id")
      .single();
    clinicId = clinic!.id;
    const name = "Paciente Rotación";
    const { data: patient, error } = await s
      .from("patients")
      .insert({
        clinic_id: clinicId,
        full_name_enc: encrypt(name),
        phone_enc: encrypt("+10000000000"),
        search_trigrams: computeTrigrams(patientSearchText({ fullName: name, phone: "+10000000000" })),
      })
      .select("id, updated_at")
      .single();
    expect(error).toBeNull();
    patientId = patient!.id;
    patientUpdatedAt = patient!.updated_at;

    const { data: state, error: stateErr } = await s
      .from("patient_clinical_state")
      .insert({ clinic_id: clinicId, patient_id: patientId, version: 1, state_enc: encrypt("{}"), model: "mock", prompt_version: "v1" })
      .select("id")
      .single();
    expect(stateErr).toBeNull();
    stateId = state!.id;

    const { data: event, error: eventErr } = await s
      .from("billing_events")
      .insert({
        clinic_id: clinicId,
        wompi_transaction_id: `tx-rot-${Date.now()}`,
        wompi_event: "transaction.updated",
        status: "APPROVED",
        amount_in_cents: 100,
        raw_payload_enc: encrypt('{"demo":true}'),
      })
      .select("id")
      .single();
    expect(eventErr).toBeNull();
    eventId = event!.id;

    useKey2();
  }, 30000);

  afterAll(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("el estado cuenta lo pendiente con la clave 2 activa", async () => {
    const status = await keyRotationStatus();
    expect(status.activeKeyId).toBe("2");
    expect(status.pendingValues).toBeGreaterThan(0);
    expect(status.pendingSearchIndex).toBeGreaterThan(0);
  });

  it("recifra con la clave 2 sin cambiar el contenido, incluidas las tablas inmutables", async () => {
    const run = await rotateEncryptedData({ clinicId });
    expect(run.failed).toBe(0);
    expect(run.timedOut).toBe(false);
    expect(run.reencrypted).toBeGreaterThanOrEqual(5);
    expect(run.reindexed).toBe(1);

    const s = svc();
    const { data: p } = await s
      .from("patients")
      .select("full_name_enc, phone_enc, search_trigrams, search_index_key, updated_at")
      .eq("id", patientId)
      .single();
    expect(p!.full_name_enc.startsWith("k2:")).toBe(true);
    expect(decrypt(p!.full_name_enc)).toBe("Paciente Rotación");
    expect(decrypt(p!.phone_enc)).toBe("+10000000000");
    // Recifrar no es modificar el dato.
    expect(p!.updated_at).toBe(patientUpdatedAt);

    // El índice de búsqueda se recalculó con la clave 2: la búsqueda lo encuentra.
    expect(p!.search_index_key).toBe("2");
    const query = computeTrigrams("Rotación");
    expect(query.some((t) => (p!.search_trigrams as string[]).includes(t))).toBe(true);

    const { data: state } = await s.from("patient_clinical_state").select("state_enc").eq("id", stateId).single();
    expect(state!.state_enc.startsWith("k2:")).toBe(true);
    const { data: event } = await s.from("billing_events").select("raw_payload_enc").eq("id", eventId).single();
    expect(decrypt(event!.raw_payload_enc)).toBe('{"demo":true}');
    const { data: clinic } = await s.from("clinics").select("wompi_payment_source_id_enc").eq("id", clinicId).single();
    expect(decrypt(clinic!.wompi_payment_source_id_enc)).toBe("ps_test_xxx");

    // Paso final: la nueva pasa a ENCRYPTION_KEY y la 1 desaparece; todo se sigue leyendo.
    process.env.ENCRYPTION_KEY = K2;
    process.env.ENCRYPTION_KEY_ID = "2";
    delete process.env.ENCRYPTION_KEY_NEXT;
    delete process.env.ENCRYPTION_KEY_NEXT_ID;
    expect(decrypt(p!.full_name_enc)).toBe("Paciente Rotación");
    useKey2();
  }, 60000);

  it("una segunda pasada no tiene nada que hacer", async () => {
    const run = await rotateEncryptedData({ clinicId });
    expect(run.reencrypted).toBe(0);
    expect(run.reindexed).toBe(0);
  }, 60000);

  it("un valor con una clave que no está en el llavero se cuenta como fallido, sin detener la pasada", async () => {
    const k3 = randomBytes(32).toString("base64");
    const huerfano = `k3:${encrypt("x", k3)}`;
    await svc().from("patients").update({ notes_enc: huerfano }).eq("id", patientId);
    const run = await rotateEncryptedData({ clinicId });
    expect(run.failed).toBe(1);
    const { data } = await svc().from("patients").select("notes_enc").eq("id", patientId).single();
    expect(data!.notes_enc).toBe(huerfano);
  }, 60000);

  it("no pisa una escritura concurrente: solo reemplaza si el valor sigue siendo el leído", async () => {
    const { data } = await svc().rpc("reencrypt_values", {
      p_table: "patients",
      p_column: "full_name_enc",
      p_items: [{ id: patientId, old: "valor-que-ya-no-esta", new: "k2:otro" }],
    });
    expect(data).toBe(0);
  });

  it("solo acepta columnas cifradas y solo desde service-role", async () => {
    const { error } = await svc().rpc("reencrypt_values", { p_table: "users", p_column: "email", p_items: [] });
    expect(error?.message).toMatch(/no cifrada/);

    const anon = createClient(URL!, ANON!, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error: denied } = await anon.rpc("reencrypt_values", {
      p_table: "patients",
      p_column: "full_name_enc",
      p_items: [],
    });
    expect(denied).not.toBeNull();
  });

  it("fuera de la rotación, las tablas inmutables siguen inmutables", async () => {
    const { error } = await svc().from("patient_clinical_state").update({ state_enc: "k2:x" }).eq("id", stateId);
    expect(error?.message).toMatch(/inmutable/);
    const { error: billingError } = await svc().from("billing_events").update({ raw_payload_enc: "k2:x" }).eq("id", eventId);
    expect(billingError?.message).toMatch(/inmutable/);
  });
});

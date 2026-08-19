import { describe, it, expect } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const d = URL && SERVICE ? describe : describe.skip;

/**
 * Vencimiento de las verificaciones heredadas (migración 0040).
 *
 * La 0032 marcó como verificadas, sin revisar credenciales, a todas las cuentas
 * profesionales que ya existían. Este barrido es lo que impide que ese estado
 * dure para siempre: cumplido el plazo, las que no aportaron documentos vuelven
 * a 'pending_documents'.
 *
 * Se ejecuta con service-role porque replica lo que hace el cron de las 03:30,
 * no una acción de usuario. El plazo se pasa como argumento para poder ejercer
 * el barrido sin esperar a la fecha real.
 */
function svc(): SupabaseClient {
  return createClient(URL!, SERVICE!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

const NOTA_HEREDADA =
  "Cuenta anterior a la verificación obligatoria; pendiente de revisión retroactiva.";
/** Un plazo ya cumplido: fuerza al barrido a actuar. */
const PLAZO_VENCIDO = "2020-01-01T00:00:00-05";
/** Un plazo aún por venir: el barrido no debe tocar nada. */
const PLAZO_FUTURO = "2099-01-01T00:00:00-05";

/** Cuenta profesional con el estado que dejó el backfill de la 0032. */
async function cuentaHeredada(opts: { conDocumentos?: boolean } = {}) {
  const s = svc();
  const sufijo = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const email = `heredada_${sufijo}@e-irene.test`;

  const { data: auth, error: authErr } = await s.auth.admin.createUser({
    email,
    password: "Password123!",
    email_confirm: true,
  });
  expect(authErr).toBeNull();

  const { data: clinic, error: clinicErr } = await s
    .from("clinics")
    .insert({ name: "Clínica Heredada", slug: `heredada-${sufijo}` })
    .select("id")
    .single();
  expect(clinicErr).toBeNull();

  const userId = auth.user!.id;
  const clinicId = clinic!.id as string;

  const { error: userErr } = await s.from("users").insert({
    id: userId,
    clinic_id: clinicId,
    role: "doctor",
    full_name: "Doctor Heredado",
    email,
    verification_status: "verified",
    verification_notes: NOTA_HEREDADA,
    // Quien ya aportó documentos está en el circuito de revisión: no se degrada.
    id_document_path: opts.conDocumentos ? `${clinicId}/${userId}/cedula.pdf` : null,
    license_document_path: opts.conDocumentos ? `${clinicId}/${userId}/tarjeta.pdf` : null,
  });
  expect(userErr).toBeNull();

  return { s, userId, clinicId };
}

async function estadoDe(s: SupabaseClient, userId: string) {
  const { data } = await s
    .from("users")
    .select("verification_status, verification_notes")
    .eq("id", userId)
    .single();
  return data as { verification_status: string; verification_notes: string | null };
}

d("vencimiento de las verificaciones heredadas", () => {
  it("antes del plazo no toca nada", async () => {
    const f = await cuentaHeredada();
    const { error } = await f.s.rpc("expire_grandfathered_verifications", {
      p_deadline: PLAZO_FUTURO,
    });
    expect(error).toBeNull();

    const estado = await estadoDe(f.s, f.userId);
    expect(estado.verification_status).toBe("verified");
    expect(estado.verification_notes).toBe(NOTA_HEREDADA);
  }, 30000);

  it("cumplido el plazo, la cuenta heredada sin documentos vuelve a pendiente", async () => {
    const f = await cuentaHeredada();
    const { error } = await f.s.rpc("expire_grandfathered_verifications", {
      p_deadline: PLAZO_VENCIDO,
    });
    expect(error).toBeNull();

    const estado = await estadoDe(f.s, f.userId);
    expect(estado.verification_status).toBe("pending_documents");
    expect(estado.verification_notes).toMatch(/heredada vencida/i);
  }, 30000);

  it("NO degrada a quien ya aportó documentos: está en revisión, no incumpliendo", async () => {
    const f = await cuentaHeredada({ conDocumentos: true });
    const { error } = await f.s.rpc("expire_grandfathered_verifications", {
      p_deadline: PLAZO_VENCIDO,
    });
    expect(error).toBeNull();

    const estado = await estadoDe(f.s, f.userId);
    expect(estado.verification_status).toBe("verified");
  }, 30000);

  it("deja constancia en audit_logs: el cambio de acceso clínico debe ser demostrable", async () => {
    const f = await cuentaHeredada();
    await f.s.rpc("expire_grandfathered_verifications", { p_deadline: PLAZO_VENCIDO });

    const { data } = await f.s
      .from("audit_logs")
      .select("action, entity_type, metadata")
      .eq("clinic_id", f.clinicId)
      .eq("action", "verification.grandfather_expired");

    expect(data ?? []).toHaveLength(1);
    expect(data![0].entity_type).toBe("users");
    expect((data![0].metadata as { expired_count: number }).expired_count).toBe(1);
  }, 30000);

  it("es idempotente: una segunda corrida no vuelve a degradar ni a registrar", async () => {
    const f = await cuentaHeredada();
    await f.s.rpc("expire_grandfathered_verifications", { p_deadline: PLAZO_VENCIDO });
    await f.s.rpc("expire_grandfathered_verifications", { p_deadline: PLAZO_VENCIDO });

    const { count } = await f.s
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", f.clinicId)
      .eq("action", "verification.grandfather_expired");
    expect(count).toBe(1);
  }, 30000);

  it("degradado conserva la lectura de sus historias: sigue siendo el responsable legal", async () => {
    const f = await cuentaHeredada();
    const { error: pErr } = await f.s
      .from("patients")
      .insert({ clinic_id: f.clinicId, full_name_enc: "deadbeef" });
    expect(pErr).toBeNull();

    await f.s.rpc("expire_grandfathered_verifications", { p_deadline: PLAZO_VENCIDO });

    // Las políticas de lectura filtran por clínica, sin exigir verificación
    // (patients_select en 0001): el paciente sigue siendo visible.
    const { data, error } = await f.s
      .from("patients")
      .select("id")
      .eq("clinic_id", f.clinicId);
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThanOrEqual(1);
  }, 30000);
});

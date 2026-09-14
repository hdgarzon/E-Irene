import { describe, it, expect } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DOCUMENTS_BUCKET, LEGACY_VERIFICATION_DEADLINE } from "@/lib/verification";
import {
  confirmLegacyVerification,
  returnLegacyDocuments,
  submitLegacyDocuments,
} from "@/lib/db/legacy-verification";

// Guarda de entorno: importar esto aborta la corrida si NEXT_PUBLIC_SUPABASE_URL
// no apunta a un stack local. Estas pruebas escriben con service-role y algunas
// purgan datos clínicos: contra producción serían destructivas.
import "./helpers/supabase-env";

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
  /**
   * Guarda contra el fallo que ya ocurrió dos veces en este repo (0005, 0038):
   * asumir que service_role conserva EXECUTE por los privilegios por defecto de
   * Supabase. En un stack recién provisionado —CI— ese default no existe, y la
   * función falla con 42501 o, peor, el cron corre "sin error" sin hacer nada.
   * Esta prueba comprueba el permiso, no el comportamiento: es lo único que
   * distingue un entorno con el default de uno sin él.
   */
  it("service_role puede ejecutar el barrido (GRANT explícito, no heredado)", async () => {
    const { data, error } = await svc().rpc("expire_grandfathered_verifications", {
      p_deadline: PLAZO_FUTURO,
    });
    expect(error).toBeNull();
    expect(data).toBeNull(); // returns void
  }, 30000);

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

const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const dl = URL && SERVICE && ANON ? describe : describe.skip;
const RAISE_EXCEPTION = "P0001";

/**
 * Cuenta heredada tal como quedó en producción: verificada por el backfill de la
 * 0032, con la "decisión" fechada en el alta y la purga ya marcada. Devuelve
 * también una sesión propia, para probar lo que el usuario puede hacer por API.
 */
async function heredadaConSesion() {
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
    verification_decided_at: new Date(Date.now() - 40 * 86400000).toISOString(),
    documents_purged_at: new Date(Date.now() - 5 * 86400000).toISOString(),
  });
  expect(userErr).toBeNull();

  const client = createClient(URL!, ANON!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: loginErr } = await client.auth.signInWithPassword({
    email,
    password: "Password123!",
  });
  expect(loginErr).toBeNull();

  return { s, client, userId, clinicId };
}

async function subirDocumentos(s: SupabaseClient, clinicId: string, userId: string) {
  const cedula = `${clinicId}/${userId}/cedula-1.pdf`;
  const tarjeta = `${clinicId}/${userId}/tarjeta-1.pdf`;
  for (const path of [cedula, tarjeta]) {
    const { error } = await s.storage
      .from(DOCUMENTS_BUCKET)
      .upload(path, `documento de prueba ${path}`, { contentType: "application/pdf", upsert: true });
    expect(error).toBeNull();
  }
  return { cedula, tarjeta };
}

function declarados(paths: { cedula: string; tarjeta: string }) {
  return {
    profession: "Psicología clínica",
    licenseNumber: "123456",
    document: "1000000000",
    idDocumentPath: paths.cedula,
    licenseDocumentPath: paths.tarjeta,
  };
}

async function filaDe(s: SupabaseClient, userId: string) {
  const { data, error } = await s
    .from("users")
    .select(
      "verification_status, verification_notes, verification_decided_at, verification_submitted_at, verified_by, documents_purged_at, id_document_path, license_document_path",
    )
    .eq("id", userId)
    .single();
  expect(error).toBeNull();
  return data!;
}

dl("verificación retroactiva de las cuentas heredadas (prórroga 0043)", () => {
  it("el plazo del barrido coincide con el que muestra la app", async () => {
    const { data, error } = await svc().rpc("grandfather_verification_deadline");
    expect(error).toBeNull();
    expect(new Date(data as string).toISOString()).toBe(
      new Date(LEGACY_VERIFICATION_DEADLINE).toISOString(),
    );
  });

  it("la sesión de la cuenta no puede esquivar el plazo tocando su nota, sus rutas o la purga", async () => {
    const f = await heredadaConSesion();
    const intentos: Record<string, unknown>[] = [
      { verification_notes: null },
      { id_document_path: `${f.clinicId}/${f.userId}/inventado.pdf` },
      { documents_purged_at: null },
    ];
    for (const patch of intentos) {
      const { error } = await f.client.from("users").update(patch).eq("id", f.userId);
      expect(error?.code, JSON.stringify(patch)).toBe(RAISE_EXCEPTION);
    }

    const fila = await filaDe(f.s, f.userId);
    expect(fila.verification_notes).toBe(NOTA_HEREDADA);
    expect(fila.id_document_path).toBeNull();
  }, 30000);

  it("subir documentos conserva el acceso, deja la decisión en blanco y la saca del barrido", async () => {
    const f = await heredadaConSesion();
    const paths = await subirDocumentos(f.s, f.clinicId, f.userId);

    await submitLegacyDocuments({ userId: f.userId, clinicId: f.clinicId, ...declarados(paths) });

    const fila = await filaDe(f.s, f.userId);
    expect(fila.verification_status).toBe("verified");
    expect(fila.id_document_path).toBe(paths.cedula);
    expect(fila.license_document_path).toBe(paths.tarjeta);
    expect(fila.verification_submitted_at).not.toBeNull();
    // Sin decisión ni marca de purga: la purga de 30 días no toca los archivos
    // hasta que el revisor decida (con la fecha del backfill los borraría ya).
    expect(fila.verification_decided_at).toBeNull();
    expect(fila.documents_purged_at).toBeNull();

    await f.s.rpc("expire_grandfathered_verifications", { p_deadline: PLAZO_VENCIDO });
    expect((await estadoDe(f.s, f.userId)).verification_status).toBe("verified");
  }, 30000);

  it("no acepta rutas sin archivo: no se sale del barrido declarando documentos que no subió", async () => {
    const f = await heredadaConSesion();
    const inexistentes = {
      cedula: `${f.clinicId}/${f.userId}/no-existe.pdf`,
      tarjeta: `${f.clinicId}/${f.userId}/tampoco.pdf`,
    };

    await expect(
      submitLegacyDocuments({ userId: f.userId, clinicId: f.clinicId, ...declarados(inexistentes) }),
    ).rejects.toThrow();

    const fila = await filaDe(f.s, f.userId);
    expect(fila.id_document_path).toBeNull();
    expect(fila.verification_notes).toBe(NOTA_HEREDADA);
  }, 30000);

  it("no acepta documentos de la carpeta de otro profesional", async () => {
    const f = await heredadaConSesion();
    const otra = await heredadaConSesion();
    const ajenos = await subirDocumentos(otra.s, otra.clinicId, otra.userId);

    await expect(
      submitLegacyDocuments({ userId: f.userId, clinicId: f.clinicId, ...declarados(ajenos) }),
    ).rejects.toThrow(/ajena/);
  }, 30000);

  it("el revisor confirma la habilitación: sigue verificada, con decisión fechada y fuera del plazo", async () => {
    const f = await heredadaConSesion();
    const revisor = await heredadaConSesion();
    const paths = await subirDocumentos(f.s, f.clinicId, f.userId);
    await submitLegacyDocuments({ userId: f.userId, clinicId: f.clinicId, ...declarados(paths) });

    await confirmLegacyVerification({ userId: f.userId, reviewerId: revisor.userId });

    const fila = await filaDe(f.s, f.userId);
    expect(fila.verification_status).toBe("verified");
    expect(fila.verified_by).toBe(revisor.userId);
    expect(fila.verification_decided_at).not.toBeNull();
    expect(fila.verification_notes).toMatch(/retroactiva confirmada/i);

    await f.s.rpc("expire_grandfathered_verifications", { p_deadline: PLAZO_VENCIDO });
    expect((await estadoDe(f.s, f.userId)).verification_status).toBe("verified");
  }, 30000);

  it("no confirma una cuenta heredada que todavía no subió documentos", async () => {
    const f = await heredadaConSesion();
    await expect(
      confirmLegacyVerification({ userId: f.userId, reviewerId: f.userId }),
    ).rejects.toThrow();
    expect((await filaDe(f.s, f.userId)).verification_notes).toBe(NOTA_HEREDADA);
  }, 30000);
});

dl("devolución de documentos y secretarias heredadas (0044)", () => {
  it("devolver documentos la deja otra vez pendiente de subirlos, con el motivo, sin archivos y dentro del plazo", async () => {
    const f = await heredadaConSesion();
    const paths = await subirDocumentos(f.s, f.clinicId, f.userId);
    await submitLegacyDocuments({ userId: f.userId, clinicId: f.clinicId, ...declarados(paths) });

    const devuelto = await returnLegacyDocuments({
      userId: f.userId,
      reason: "La tarjeta profesional está ilegible",
    });
    expect(devuelto.filesRemoved).toBe(true);

    const fila = await filaDe(f.s, f.userId);
    expect(fila.verification_status).toBe("verified");
    expect(fila.id_document_path).toBeNull();
    expect(fila.license_document_path).toBeNull();
    expect(fila.verification_notes).toMatch(/^Cuenta anterior a la verificaci/);
    expect(fila.verification_notes).toMatch(/ilegible/);

    const { data: archivo } = await f.s.storage.from(DOCUMENTS_BUCKET).download(paths.cedula);
    expect(archivo).toBeNull();

    // Sin documentos, el plazo vuelve a aplicarle.
    await f.s.rpc("expire_grandfathered_verifications", { p_deadline: PLAZO_VENCIDO });
    expect((await estadoDe(f.s, f.userId)).verification_status).toBe("pending_documents");
  }, 30000);

  it("no devuelve documentos de una cuenta que no los subió", async () => {
    const f = await heredadaConSesion();
    await expect(
      returnLegacyDocuments({ userId: f.userId, reason: "Motivo cualquiera" }),
    ).rejects.toThrow();
  }, 30000);

  it("el barrido del plazo no degrada a una secretaria heredada: no se verifica", async () => {
    const s = svc();
    const sufijo = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const email = `secretaria_heredada_${sufijo}@e-irene.test`;
    const { data: auth, error: authErr } = await s.auth.admin.createUser({
      email,
      password: "Password123!",
      email_confirm: true,
    });
    expect(authErr).toBeNull();
    const { data: clinic, error: clinicErr } = await s
      .from("clinics")
      .insert({ name: "Clínica Secretaria Heredada", slug: `secretaria-heredada-${sufijo}` })
      .select("id")
      .single();
    expect(clinicErr).toBeNull();
    const userId = auth.user!.id;
    const { error: userErr } = await s.from("users").insert({
      id: userId,
      clinic_id: clinic!.id,
      role: "secretaria",
      full_name: "Secretaria Heredada",
      email,
      verification_status: "verified",
      verification_notes: NOTA_HEREDADA,
    });
    expect(userErr).toBeNull();

    await s.rpc("expire_grandfathered_verifications", { p_deadline: PLAZO_VENCIDO });
    expect((await estadoDe(s, userId)).verification_status).toBe("verified");
  }, 30000);
});

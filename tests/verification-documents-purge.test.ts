import { describe, it, expect, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  purgeExpiredVerificationDocuments,
  purgeOrphanVerificationDocuments,
  storeDocumentHashes,
  DOCUMENT_RETENTION_DAYS,
  ORPHAN_DOCUMENT_GRACE_HOURS,
} from "@/lib/db/verification-documents";
import { DOCUMENTS_BUCKET } from "@/lib/verification";

// Guarda de entorno: importar esto aborta la corrida si NEXT_PUBLIC_SUPABASE_URL
// no apunta a un stack local. Estas pruebas escriben con service-role y algunas
// purgan datos clínicos: contra producción serían destructivas.
import "./helpers/supabase-env";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const d = URL && SERVICE ? describe : describe.skip;

function svc(): SupabaseClient {
  return createClient(URL!, SERVICE!, { auth: { autoRefreshToken: false, persistSession: false } });
}

const hace = (dias: number) => new Date(Date.now() - dias * 86400000).toISOString();

/** Profesional decidido hace `dias`, con sus dos documentos en el bucket. */
async function profesionalConDocumentos(dias: number) {
  const s = svc();
  const email = `docs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@e-irene.test`;
  // Cada paso del fixture comprueba su error: si uno falla en silencio, la prueba
  // cae más adelante con un "null" que no dice qué pasó, y esta suite cubre una
  // obligación legal (no se puede dar por intermitente sin saber la causa).
  const { data: auth, error: authError } = await s.auth.admin.createUser({
    email,
    password: "Password123!",
    email_confirm: true,
  });
  expect(authError).toBeNull();
  const { data: clinic, error: clinicError } = await s
    .from("clinics")
    .insert({ name: "Docs Test", slug: `docs-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` })
    .select("id")
    .single();
  expect(clinicError).toBeNull();

  const userId = auth.user!.id;
  const clinicId = clinic!.id as string;
  const cedula = `${clinicId}/${userId}/cedula-1.txt`;
  const tarjeta = `${clinicId}/${userId}/tarjeta-1.txt`;
  const contenidoCedula = `cedula de ${email}`;

  const { error: cedulaError } = await s.storage.from(DOCUMENTS_BUCKET).upload(cedula, contenidoCedula, {
    contentType: "text/plain",
    upsert: true,
  });
  expect(cedulaError).toBeNull();
  const { error: tarjetaError } = await s.storage.from(DOCUMENTS_BUCKET).upload(tarjeta, "tarjeta profesional", {
    contentType: "text/plain",
    upsert: true,
  });
  expect(tarjetaError).toBeNull();

  const { error: userError } = await s.from("users").insert({
    id: userId,
    clinic_id: clinicId,
    role: "doctor",
    full_name: "Doctor Docs",
    email,
    verification_status: "verified",
    verification_decided_at: hace(dias),
    id_document_path: cedula,
    license_document_path: tarjeta,
  });
  expect(userError).toBeNull();

  return { s, userId, clinicId, cedula, tarjeta, contenidoCedula };
}

async function existeEnBucket(s: SupabaseClient, path: string): Promise<boolean> {
  const { data } = await s.storage.from(DOCUMENTS_BUCKET).download(path);
  return Boolean(data);
}

d("purga de documentos de identidad", () => {
  it("calcula la huella del documento tal como está en el bucket", async () => {
    const f = await profesionalConDocumentos(1);
    await storeDocumentHashes(f.userId);

    const { data } = await f.s
      .from("users")
      .select("id_document_hash, license_document_hash")
      .eq("id", f.userId)
      .single();

    const esperado = createHash("sha256").update(Buffer.from(f.contenidoCedula)).digest("hex");
    expect(data?.id_document_hash).toBe(esperado);
    expect(data?.license_document_hash).toBeTruthy();
    expect(data?.license_document_hash).not.toBe(data?.id_document_hash);
  }, 30000);

  it("NO borra los documentos de una decisión reciente", async () => {
    const f = await profesionalConDocumentos(DOCUMENT_RETENTION_DAYS - 5);
    await purgeExpiredVerificationDocuments();

    expect(await existeEnBucket(f.s, f.cedula)).toBe(true);
    const { data } = await f.s
      .from("users")
      .select("id_document_path, documents_purged_at")
      .eq("id", f.userId)
      .single();
    expect(data?.id_document_path).not.toBeNull();
    expect(data?.documents_purged_at).toBeNull();
  }, 30000);

  it("borra los archivos del bucket cumplido el plazo", async () => {
    const f = await profesionalConDocumentos(DOCUMENT_RETENTION_DAYS + 5);
    expect(await existeEnBucket(f.s, f.cedula)).toBe(true);

    await purgeExpiredVerificationDocuments();

    expect(await existeEnBucket(f.s, f.cedula)).toBe(false);
    expect(await existeEnBucket(f.s, f.tarjeta)).toBe(false);
  }, 30000);

  it("deja la fila sin rutas y con la marca de purga", async () => {
    const f = await profesionalConDocumentos(DOCUMENT_RETENTION_DAYS + 5);
    await purgeExpiredVerificationDocuments();

    const { data } = await f.s
      .from("users")
      .select("id_document_path, license_document_path, documents_purged_at")
      .eq("id", f.userId)
      .single();
    expect(data?.id_document_path).toBeNull();
    expect(data?.license_document_path).toBeNull();
    expect(data?.documents_purged_at).not.toBeNull();
  }, 30000);

  it("conserva la huella tras borrar el archivo: es la prueba de qué se revisó", async () => {
    const f = await profesionalConDocumentos(DOCUMENT_RETENTION_DAYS + 5);
    await storeDocumentHashes(f.userId);
    await purgeExpiredVerificationDocuments();

    const { data } = await f.s
      .from("users")
      .select("id_document_hash, id_document_path")
      .eq("id", f.userId)
      .single();
    expect(data?.id_document_path).toBeNull();
    expect(data?.id_document_hash).toBeTruthy();
  }, 30000);

  it("deja constancia en audit_logs, como la purga de transcripciones", async () => {
    const f = await profesionalConDocumentos(DOCUMENT_RETENTION_DAYS + 5);
    await purgeExpiredVerificationDocuments();

    const { data } = await f.s
      .from("audit_logs")
      .select("action, entity_type, metadata")
      .eq("clinic_id", f.clinicId)
      .eq("action", "verification_docs.purge");

    expect(data ?? []).toHaveLength(1);
    expect(data![0].entity_type).toBe("users");
    expect((data![0].metadata as { purged_count: number }).purged_count).toBe(1);
  }, 30000);

  it("es idempotente: una segunda corrida no vuelve a registrar la purga", async () => {
    const f = await profesionalConDocumentos(DOCUMENT_RETENTION_DAYS + 5);
    await purgeExpiredVerificationDocuments();
    await purgeExpiredVerificationDocuments();

    const { count } = await f.s
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", f.clinicId)
      .eq("action", "verification_docs.purge");
    expect(count).toBe(1);
  }, 30000);

  it("purga también a quien ya tenía la marca de una purga anterior y volvió a declarar documentos", async () => {
    const f = await profesionalConDocumentos(DOCUMENT_RETENTION_DAYS + 5);
    // Como las cuentas heredadas: una purga pasó sobre la fila cuando no tenía archivos.
    const { error: prepErr } = await f.s
      .from("users")
      .update({ documents_purged_at: hace(60) })
      .eq("id", f.userId);
    expect(prepErr).toBeNull();

    await purgeExpiredVerificationDocuments();

    expect(await existeEnBucket(f.s, f.cedula)).toBe(false);
    const { data } = await f.s
      .from("users")
      .select("id_document_path, license_document_path")
      .eq("id", f.userId)
      .single();
    expect(data?.id_document_path).toBeNull();
    expect(data?.license_document_path).toBeNull();
  }, 30000);
});

// ============================ Huérfanos =====================================

/**
 * La API de Storage no deja fechar un archivo en el pasado, así que en vez de
 * envejecer el archivo se adelanta el reloj del barrido más allá del margen.
 */
const pasadoElMargen = () =>
  new Date(Date.now() + (ORPHAN_DOCUMENT_GRACE_HOURS + 1) * 3600000);

async function subir(s: SupabaseClient, path: string) {
  const { error } = await s.storage
    .from(DOCUMENTS_BUCKET)
    .upload(path, `archivo ${path}`, { contentType: "text/plain", upsert: true });
  expect(error).toBeNull();
}

/**
 * Cada barrido se limita a la clínica de la prueba: con el reloj adelantado,
 * uno sobre todo el bucket borraría archivos que otras suites acaban de subir
 * y aún no referencian.
 */
d("barrido de documentos huérfanos", () => {
  it("borra los archivos de un envío anterior que el reenvío dejó sin referencia", async () => {
    const f = await profesionalConDocumentos(1);
    const anteriores = [
      `${f.clinicId}/${f.userId}/cedula-0.txt`,
      `${f.clinicId}/${f.userId}/tarjeta-0.txt`,
    ];
    for (const path of anteriores) await subir(f.s, path);

    const result = await purgeOrphanVerificationDocuments({
      now: pasadoElMargen(),
      clinicId: f.clinicId,
    });

    for (const path of anteriores) expect(await existeEnBucket(f.s, path)).toBe(false);
    expect(result.filesDeleted).toBe(2);
  }, 30000);

  it("nunca borra los documentos vigentes, por viejos que sean", async () => {
    const f = await profesionalConDocumentos(1);

    const result = await purgeOrphanVerificationDocuments({
      now: pasadoElMargen(),
      clinicId: f.clinicId,
    });

    expect(await existeEnBucket(f.s, f.cedula)).toBe(true);
    expect(await existeEnBucket(f.s, f.tarjeta)).toBe(true);
    expect(result.scanned).toBe(2);
    expect(result.filesDeleted).toBe(0);
  }, 30000);

  it("borra lo que se subió para un envío que el servidor rechazó", async () => {
    const f = await profesionalConDocumentos(1);
    // Carpeta de otro profesional de la clínica cuyo envío nunca quedó guardado.
    const rechazado = `${f.clinicId}/${randomUUID()}/cedula-${Date.now()}.pdf`;
    await subir(f.s, rechazado);

    await purgeOrphanVerificationDocuments({ now: pasadoElMargen(), clinicId: f.clinicId });

    expect(await existeEnBucket(f.s, rechazado)).toBe(false);
  }, 30000);

  it("respeta el margen: no toca una subida sin referencia todavía reciente", async () => {
    const f = await profesionalConDocumentos(1);
    const enCurso = `${f.clinicId}/${f.userId}/cedula-${Date.now()}.pdf`;
    await subir(f.s, enCurso);

    const antesDelMargen = new Date(Date.now() + (ORPHAN_DOCUMENT_GRACE_HOURS - 1) * 3600000);
    for (const now of [new Date(), antesDelMargen]) {
      const result = await purgeOrphanVerificationDocuments({ now, clinicId: f.clinicId });
      expect(result.filesDeleted).toBe(0);
    }

    expect(await existeEnBucket(f.s, enCurso)).toBe(true);
  }, 30000);

  it("deja constancia en audit_logs por clínica, sin rutas en el metadata", async () => {
    const f = await profesionalConDocumentos(1);
    await subir(f.s, `${f.clinicId}/${f.userId}/cedula-0.txt`);
    await subir(f.s, `${f.clinicId}/${f.userId}/tarjeta-0.txt`);

    await purgeOrphanVerificationDocuments({ now: pasadoElMargen(), clinicId: f.clinicId });

    const { data } = await f.s
      .from("audit_logs")
      .select("entity_type, metadata")
      .eq("clinic_id", f.clinicId)
      .eq("action", "verification_docs.orphan_purge");

    expect(data ?? []).toHaveLength(1);
    expect(data![0].entity_type).toBe("users");
    expect(data![0].metadata).toEqual({
      deleted_count: 2,
      grace_hours: ORPHAN_DOCUMENT_GRACE_HOURS,
    });
  }, 30000);

  it("es idempotente: una segunda corrida no borra ni registra de nuevo", async () => {
    const f = await profesionalConDocumentos(1);
    await subir(f.s, `${f.clinicId}/${f.userId}/cedula-0.txt`);

    const opciones = { now: pasadoElMargen(), clinicId: f.clinicId };
    await purgeOrphanVerificationDocuments(opciones);
    const segunda = await purgeOrphanVerificationDocuments(opciones);

    expect(segunda.filesDeleted).toBe(0);
    const { count } = await f.s
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", f.clinicId)
      .eq("action", "verification_docs.orphan_purge");
    expect(count).toBe(1);
  }, 30000);

  it("sin huérfanos no registra nada en audit_logs", async () => {
    const f = await profesionalConDocumentos(1);
    await purgeOrphanVerificationDocuments({ now: pasadoElMargen(), clinicId: f.clinicId });

    const { count } = await f.s
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("clinic_id", f.clinicId)
      .eq("action", "verification_docs.orphan_purge");
    expect(count).toBe(0);
  }, 30000);

  it("limitado a una clínica, no toca los huérfanos de otra", async () => {
    const f = await profesionalConDocumentos(1);
    const g = await profesionalConDocumentos(1);
    const deOtra = `${g.clinicId}/${g.userId}/cedula-0.txt`;
    await subir(g.s, deOtra);

    await purgeOrphanVerificationDocuments({ now: pasadoElMargen(), clinicId: f.clinicId });

    expect(await existeEnBucket(g.s, deOtra)).toBe(true);
  }, 30000);
});

describe("barrido de documentos huérfanos: fallos", () => {
  it("si no puede leer las rutas vigentes, no borra nada", async () => {
    // Con un conjunto de rutas vacío por error, todo el bucket parecería huérfano.
    const viejo = new Date(Date.now() - 10 * 86400000).toISOString();
    const remove = vi.fn();
    const falla = { data: null, error: { message: "sin conexión" } };
    const consulta: Record<string, unknown> = {
      then: (resolve: (value: typeof falla) => void) => resolve(falla),
    };
    for (const metodo of ["select", "or", "gt", "order", "limit"]) {
      consulta[metodo] = () => consulta;
    }
    const admin = {
      from: () => consulta,
      storage: {
        from: () => ({
          remove,
          listV2: async () => ({
            data: {
              hasNext: false,
              folders: [],
              objects: [
                {
                  name: `${randomUUID()}/${randomUUID()}/cedula-1.pdf`,
                  created_at: viejo,
                  updated_at: viejo,
                },
              ],
            },
            error: null,
          }),
        }),
      },
    };

    vi.resetModules();
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin }));
    try {
      const { purgeOrphanVerificationDocuments: barrer } = await import(
        "@/lib/db/verification-documents"
      );
      await expect(barrer()).rejects.toMatchObject({ message: "sin conexión" });
      expect(remove).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock("@/lib/supabase/admin");
      vi.resetModules();
    }
  });
});

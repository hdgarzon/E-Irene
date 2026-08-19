import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  purgeExpiredVerificationDocuments,
  storeDocumentHashes,
  DOCUMENT_RETENTION_DAYS,
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
  const { data: auth } = await s.auth.admin.createUser({
    email,
    password: "Password123!",
    email_confirm: true,
  });
  const { data: clinic } = await s
    .from("clinics")
    .insert({ name: "Docs Test", slug: `docs-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` })
    .select("id")
    .single();

  const userId = auth.user!.id;
  const clinicId = clinic!.id as string;
  const cedula = `${clinicId}/${userId}/cedula-1.txt`;
  const tarjeta = `${clinicId}/${userId}/tarjeta-1.txt`;
  const contenidoCedula = `cedula de ${email}`;

  await s.storage.from(DOCUMENTS_BUCKET).upload(cedula, contenidoCedula, {
    contentType: "text/plain",
    upsert: true,
  });
  await s.storage.from(DOCUMENTS_BUCKET).upload(tarjeta, "tarjeta profesional", {
    contentType: "text/plain",
    upsert: true,
  });

  await s.from("users").insert({
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
});

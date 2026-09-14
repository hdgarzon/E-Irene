import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { DOCUMENTS_BUCKET } from "@/lib/verification";
import { logger } from "@/lib/logger";

/**
 * Retención de los documentos de identidad del profesional (migración 0037).
 *
 * E-Irene es Responsable de estos datos, no encargado. Se borran 30 días
 * después de la decisión de verificación, conservando el SHA-256 de cada
 * archivo como prueba de qué se revisó.
 *
 * Todo corre con service-role: es mantenimiento del sistema sobre varias
 * clínicas a la vez, no una acción de usuario.
 */

/** Días entre la decisión y el borrado de los archivos. Cambiarlo obliga a
 *  cambiar la política de tratamiento publicada: deben decir lo mismo. */
export const DOCUMENT_RETENTION_DAYS = 30;

async function hashObject(path: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(DOCUMENTS_BUCKET).download(path);
  if (error || !data) return null;
  const buffer = Buffer.from(await data.arrayBuffer());
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Calcula y guarda la huella de los documentos que el revisor tuvo a la vista.
 *
 * Se hace en el servidor y en el momento de decidir, no en el navegador al
 * subir: una huella que el propio interesado calcula y envía no prueba nada.
 *
 * Best-effort: si falla, la decisión de verificación no debe revertirse. Se
 * registra y se sigue — es preferible una decisión sin huella que un
 * profesional bloqueado por un fallo de almacenamiento.
 */
export async function storeDocumentHashes(userId: string): Promise<void> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("users")
    .select("id_document_path, license_document_path")
    .eq("id", userId)
    .single();
  if (error || !data) return;

  const [idHash, licenseHash] = await Promise.all([
    data.id_document_path ? hashObject(data.id_document_path) : Promise.resolve(null),
    data.license_document_path ? hashObject(data.license_document_path) : Promise.resolve(null),
  ]);

  if (!idHash && !licenseHash) return;

  await admin
    .from("users")
    .update({ id_document_hash: idHash, license_document_hash: licenseHash })
    .eq("id", userId);
}

export interface PurgeResult {
  candidates: number;
  purged: number;
  filesDeleted: number;
}

/**
 * Borra del bucket los documentos cuya decisión ya cumplió el plazo.
 *
 * Vive en la aplicación y no en pg_cron —a diferencia de la purga de
 * transcripciones— porque borrar filas de `storage.objects` desde SQL dejaría
 * los archivos huérfanos en el almacenamiento real. Hay que pasar por la API
 * de Storage.
 */
export async function purgeExpiredVerificationDocuments(): Promise<PurgeResult> {
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - DOCUMENT_RETENTION_DAYS * 86400000).toISOString();

  const { data: expired, error } = await admin
    .from("users")
    .select("id, clinic_id, id_document_path, license_document_path")
    // Sin marca de purga, o con rutas vigentes aunque la tenga: una fila que
    // volvió a declarar documentos después de una purga anterior también debe
    // borrarlos a los 30 días de su nueva decisión.
    .or("documents_purged_at.is.null,id_document_path.not.is.null,license_document_path.not.is.null")
    .not("verification_decided_at", "is", null)
    .lt("verification_decided_at", cutoff);
  if (error) throw error;

  const result: PurgeResult = { candidates: expired?.length ?? 0, purged: 0, filesDeleted: 0 };
  const purgedByClinic = new Map<string, number>();

  for (const user of expired ?? []) {
    const paths = [user.id_document_path, user.license_document_path].filter(
      (p): p is string => Boolean(p),
    );

    if (paths.length > 0) {
      const { error: removeError } = await admin.storage.from(DOCUMENTS_BUCKET).remove(paths);
      if (removeError) {
        // No se marca como purgado: si el archivo sigue vivo, la fila debe
        // volver a intentarlo mañana en vez de dar el borrado por hecho.
        logger.error("verification_docs.remove_failed", { userId: user.id, error: removeError });
        continue;
      }
      result.filesDeleted += paths.length;
    }

    const { error: updateError } = await admin
      .from("users")
      .update({
        id_document_path: null,
        license_document_path: null,
        documents_purged_at: new Date().toISOString(),
      })
      .eq("id", user.id);
    if (updateError) {
      logger.error("verification_docs.mark_failed", { userId: user.id, error: updateError });
      continue;
    }

    result.purged += 1;
    purgedByClinic.set(user.clinic_id, (purgedByClinic.get(user.clinic_id) ?? 0) + 1);
  }

  // Una fila de auditoría por clínica: el borrado de datos personales tiene que
  // quedar acreditado, igual que el de las transcripciones.
  for (const [clinicId, count] of purgedByClinic) {
    const { error: auditError } = await admin.from("audit_logs").insert({
      clinic_id: clinicId,
      action: "verification_docs.purge",
      entity_type: "users",
      metadata: { purged_count: count, retention_days: DOCUMENT_RETENTION_DAYS },
    });
    if (auditError) {
      logger.warn("verification_docs.audit_failed", { clinicId, error: auditError });
    }
  }

  return result;
}

// ============================ Huérfanos =====================================

/**
 * Horas que se respeta un archivo sin referencia antes de darlo por huérfano.
 *
 * El formulario sube los archivos al bucket y solo después llama al action que
 * guarda las rutas (components/verification-form.tsx): entre una cosa y la otra
 * el archivo no lo referencia nadie. El margen evita pisar una subida en curso.
 */
export const ORPHAN_DOCUMENT_GRACE_HOURS = 48;

/** Tamaño de página al leer rutas vigentes y de lote al borrar. */
const PAGE_SIZE = 1000;
const REMOVE_BATCH = 100;

/** Primeras dos carpetas de la convención {clinic_id}/{user_id}/{archivo}. */
const DOCUMENT_PATH = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/[0-9a-f-]{36}\/.+$/i;

export interface OrphanSweepResult {
  scanned: number;
  orphans: number;
  filesDeleted: number;
}

type AdminClient = ReturnType<typeof createAdminClient>;

interface BucketObject {
  path: string;
  /** Última escritura: la más reciente entre creación y actualización. */
  writtenAt: number;
}

async function listBucketObjects(admin: AdminClient, prefix?: string): Promise<BucketObject[]> {
  const objects: BucketObject[] = [];
  let cursor: string | undefined;

  for (;;) {
    const { data, error } = await admin.storage
      .from(DOCUMENTS_BUCKET)
      .listV2({ prefix, cursor, limit: PAGE_SIZE });
    if (error) throw error;

    for (const object of data.objects) {
      const writtenAt = Math.max(Date.parse(object.created_at), Date.parse(object.updated_at));
      objects.push({ path: object.key ?? object.name, writtenAt });
    }

    // Sin cursor no se puede seguir: se corta, y lo no listado queda para mañana.
    if (!data.hasNext || !data.nextCursor) return objects;
    cursor = data.nextCursor;
  }
}

/**
 * Todas las rutas que alguna fila de `users` referencia hoy.
 *
 * Paginado por clave (id > último) y no por desplazamiento: si una fila entra en
 * el conjunto a mitad de la lectura, un desplazamiento correría las páginas y
 * saltaría otra fila, y sus documentos vigentes se borrarían como huérfanos.
 * Se lee hasta una página vacía, no hasta una incompleta, por si el servidor
 * limita las filas por debajo de PAGE_SIZE.
 */
async function loadReferencedPaths(admin: AdminClient): Promise<Set<string>> {
  const referenced = new Set<string>();
  let lastId: string | null = null;

  for (;;) {
    let query = admin
      .from("users")
      .select("id, id_document_path, license_document_path")
      .or("id_document_path.not.is.null,license_document_path.not.is.null");
    if (lastId) query = query.gt("id", lastId);

    const { data, error } = await query.order("id").limit(PAGE_SIZE);
    // Lanzar es lo único seguro: seguir con un conjunto incompleto borraría
    // documentos vigentes.
    if (error) throw error;
    if (!data || data.length === 0) return referenced;

    for (const row of data) {
      if (row.id_document_path) referenced.add(row.id_document_path);
      if (row.license_document_path) referenced.add(row.license_document_path);
    }
    lastId = data[data.length - 1].id;
  }
}

/**
 * Borra del bucket los documentos que ya no referencia ninguna fila de `users`.
 *
 * La purga por plazo solo alcanza las rutas vigentes de cada fila. Quedaban
 * fuera, sin plazo alguno:
 *  · los archivos de un envío anterior, cuando un reenvío tras un rechazo o una
 *    suspensión sube archivos nuevos y reemplaza las rutas;
 *  · los que el navegador sube antes de que el action rechace el envío.
 * La huella de lo que se revisó está en la fila, no en esos archivos.
 *
 * Primero se lista el bucket y después se leen las rutas vigentes: un envío que
 * se guarde entre las dos lecturas ya aparece referenciado.
 *
 * Solo toca rutas con la convención {clinic_id}/{user_id}/…: un archivo fuera de
 * ella no lo escribió la aplicación y no hay clínica a quien acreditar su borrado.
 *
 * @param options.now      reloj de referencia para el margen. Las pruebas lo
 *   adelantan porque la API de Storage no deja fechar un archivo en el pasado.
 * @param options.clinicId limita el barrido a la carpeta de una clínica. Las
 *   pruebas lo usan para no tocar archivos de otras suites que corren en paralelo.
 */
export async function purgeOrphanVerificationDocuments(
  options: { now?: Date; clinicId?: string } = {},
): Promise<OrphanSweepResult> {
  const admin = createAdminClient();
  const now = options.now?.getTime() ?? Date.now();
  const cutoff = now - ORPHAN_DOCUMENT_GRACE_HOURS * 3600000;

  const objects = await listBucketObjects(
    admin,
    options.clinicId ? `${options.clinicId}/` : undefined,
  );
  const referenced = await loadReferencedPaths(admin);

  const orphans: string[] = [];
  let outsideConvention = 0;
  for (const object of objects) {
    if (referenced.has(object.path)) continue;
    // Una fecha ilegible no prueba que el archivo sea viejo: se conserva.
    if (!(object.writtenAt < cutoff)) continue;
    if (!DOCUMENT_PATH.test(object.path)) {
      outsideConvention += 1;
      continue;
    }
    orphans.push(object.path);
  }
  if (outsideConvention > 0) {
    logger.warn("verification_docs.orphans_outside_convention", { count: outsideConvention });
  }

  const result: OrphanSweepResult = {
    scanned: objects.length,
    orphans: orphans.length,
    filesDeleted: 0,
  };
  const deletedByClinic = new Map<string, number>();

  for (let i = 0; i < orphans.length; i += REMOVE_BATCH) {
    const batch = orphans.slice(i, i + REMOVE_BATCH);
    const { data, error } = await admin.storage.from(DOCUMENTS_BUCKET).remove(batch);
    if (error) {
      // Lo que no se borró sigue en el bucket y vuelve a intentarse mañana.
      logger.error("verification_docs.orphan_remove_failed", { count: batch.length, error });
      continue;
    }
    // Se acredita lo que Storage confirma haber borrado, no lo que se pidió.
    for (const { name } of data ?? []) {
      const clinicId = DOCUMENT_PATH.exec(name)?.[1];
      if (!clinicId) continue;
      result.filesDeleted += 1;
      deletedByClinic.set(clinicId, (deletedByClinic.get(clinicId) ?? 0) + 1);
    }
  }

  // Sin rutas en el metadata: audit_logs lo lee toda la clínica.
  for (const [clinicId, count] of deletedByClinic) {
    const { error: auditError } = await admin.from("audit_logs").insert({
      clinic_id: clinicId,
      action: "verification_docs.orphan_purge",
      entity_type: "users",
      metadata: { deleted_count: count, grace_hours: ORPHAN_DOCUMENT_GRACE_HOURS },
    });
    if (auditError) {
      // Pasa si la clínica ya no existe: sus archivos se borran igual.
      logger.warn("verification_docs.orphan_audit_failed", { clinicId, count, error: auditError });
    }
  }

  return result;
}

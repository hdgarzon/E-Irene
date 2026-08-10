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
    .is("documents_purged_at", null)
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

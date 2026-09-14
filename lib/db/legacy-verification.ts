import { createAdminClient } from "@/lib/supabase/admin";
import { encrypt } from "@/lib/crypto";
import { dayKey } from "@/lib/dates";
import {
  DOCUMENTS_BUCKET,
  LEGACY_VERIFICATION_NOTE_PREFIX,
  isOwnDocumentPath,
  legacyVerificationState,
  roleRequiresVerification,
  type VerificationStatus,
} from "@/lib/verification";
import type { UserRole } from "@/lib/auth";

/**
 * Verificación retroactiva de las cuentas heredadas: las que el backfill de la
 * 0032 aprobó sin revisar credenciales (plazo en 0040, prorrogado en 0043).
 *
 * Corre con service-role por dos razones:
 *  · El envío tiene que dejar en blanco la fecha de decisión y reiniciar la
 *    purga, y el trigger de verificación no deja que la sesión del usuario toque
 *    esos campos (con razón: son del revisor).
 *  · La confirmación la hace el admin de plataforma, que no pertenece a la
 *    clínica del profesional.
 * La autorización la hacen los llamadores: requireUser() en el envío —y la
 * comprobación de que las rutas son del propio usuario, que se repite aquí— y
 * requirePlatformAdmin() en la confirmación.
 */

interface LegacyRow {
  role: UserRole;
  clinic_id: string;
  email: string;
  full_name: string;
  verification_status: VerificationStatus;
  verification_notes: string | null;
  id_document_path: string | null;
  license_document_path: string | null;
}

async function readRow(userId: string): Promise<LegacyRow> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("users")
    .select(
      "role, clinic_id, email, full_name, verification_status, verification_notes, id_document_path, license_document_path",
    )
    .eq("id", userId)
    .single();
  if (error) throw error;
  return data as LegacyRow;
}

function stateOf(row: LegacyRow) {
  return legacyVerificationState({
    status: row.verification_status,
    notes: row.verification_notes,
    hasIdDocument: Boolean(row.id_document_path),
    hasLicenseDocument: Boolean(row.license_document_path),
  });
}

async function existsInBucket(path: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(DOCUMENTS_BUCKET).download(path);
  return !error && Boolean(data);
}

/**
 * Registra los documentos de una cuenta heredada SIN quitarle el acceso: sigue
 * verificada mientras el admin de plataforma hace la revisión retroactiva y, con
 * documentos, el barrido del plazo ya no la degrada.
 *
 * Deja la fecha de decisión en blanco y la purga reiniciada. El backfill de la
 * 0032 fechó la decisión de estas cuentas en su created_at: sin esto, la purga
 * de 30 días borraría los archivos al día siguiente, antes de revisarlos. Se
 * borran 30 días después de la decisión real.
 */
export async function submitLegacyDocuments(params: {
  userId: string;
  clinicId: string;
  profession: string;
  licenseNumber: string;
  document: string;
  idDocumentPath: string;
  licenseDocumentPath: string;
}): Promise<void> {
  const row = await readRow(params.userId);
  if (row.clinic_id !== params.clinicId || !roleRequiresVerification(row.role)) {
    throw new Error("La cuenta no corresponde a un profesional de esta clínica");
  }
  if (stateOf(row) !== "needs_documents") {
    throw new Error("La cuenta no es una verificación heredada pendiente de documentos");
  }

  for (const path of [params.idDocumentPath, params.licenseDocumentPath]) {
    if (!isOwnDocumentPath(path, params.clinicId, params.userId)) {
      throw new Error("Ruta de documento ajena");
    }
    // Ninguna ruta sin archivo: una cuenta heredada no puede salir del barrido
    // del plazo declarando documentos que no subió.
    if (!(await existsInBucket(path))) {
      throw new Error("El documento no está en el almacenamiento");
    }
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("users")
    .update({
      profession: params.profession,
      license_number: params.licenseNumber,
      document_enc: encrypt(params.document),
      id_document_path: params.idDocumentPath,
      license_document_path: params.licenseDocumentPath,
      verification_submitted_at: new Date().toISOString(),
      verification_decided_at: null,
      documents_purged_at: null,
      id_document_hash: null,
      license_document_hash: null,
    })
    .eq("id", params.userId)
    // Optimista: si entre la lectura y esta escritura la cuenta cambió (otro
    // envío, una decisión del revisor, el barrido), no se pisa nada.
    .eq("verification_status", "verified")
    .like("verification_notes", `${LEGACY_VERIFICATION_NOTE_PREFIX}%`)
    .is("id_document_path", null)
    .is("license_document_path", null)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error("La verificación cambió mientras se enviaban los documentos");
  }
}

/**
 * El admin de plataforma confirma la habilitación de una cuenta heredada tras
 * revisar sus documentos. Sigue verificada; la nota del backfill se reemplaza,
 * así que la cuenta sale del barrido del plazo, y la fecha de decisión arranca
 * la purga de los archivos a los 30 días.
 */
export async function confirmLegacyVerification(params: {
  userId: string;
  reviewerId: string;
}): Promise<{ clinicId: string; email: string; fullName: string }> {
  const row = await readRow(params.userId);
  if (stateOf(row) !== "awaiting_review") {
    throw new Error("La cuenta no tiene una revisión retroactiva pendiente");
  }

  // DD/MM/YYYY en hora de Bogotá, como la nota de la 0040.
  const [year, month, day] = dayKey(new Date()).split("-");
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("users")
    .update({
      verified_by: params.reviewerId,
      verification_decided_at: new Date().toISOString(),
      verification_notes: `Verificación retroactiva confirmada el ${day}/${month}/${year}.`,
    })
    .eq("id", params.userId)
    .eq("verification_status", "verified")
    .like("verification_notes", `${LEGACY_VERIFICATION_NOTE_PREFIX}%`)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error("La verificación cambió antes de confirmarse");
  }

  return { clinicId: row.clinic_id, email: row.email, fullName: row.full_name };
}

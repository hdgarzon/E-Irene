import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { encrypt, decryptNullable } from "@/lib/crypto";
import {
  canTransition,
  DOCUMENTS_BUCKET as BUCKET,
  type VerificationStatus,
} from "@/lib/verification";
import type { UserRole } from "@/lib/auth";

/** Minutos que vive una URL firmada de documento. Corta a propósito: son
 *  documentos de identidad y el revisor los abre en el momento. */
const SIGNED_URL_TTL_SECONDS = 300;

export interface MyVerification {
  status: VerificationStatus;
  profession: string | null;
  licenseNumber: string | null;
  document: string | null;
  hasIdDocument: boolean;
  hasLicenseDocument: boolean;
  submittedAt: string | null;
  decidedAt: string | null;
  notes: string | null;
}

/** Estado de verificación del usuario en sesión. */
export async function getMyVerification(userId: string): Promise<MyVerification | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("users")
    .select(
      "verification_status, profession, license_number, document_enc, id_document_path, license_document_path, verification_submitted_at, verification_decided_at, verification_notes",
    )
    .eq("id", userId)
    .single();
  if (error) throw error;

  return {
    status: data.verification_status,
    profession: data.profession,
    licenseNumber: data.license_number,
    document: decryptNullable(data.document_enc),
    hasIdDocument: Boolean(data.id_document_path),
    hasLicenseDocument: Boolean(data.license_document_path),
    submittedAt: data.verification_submitted_at,
    decidedAt: data.verification_decided_at,
    notes: data.verification_notes,
  };
}

/**
 * Guarda los datos declarados y pasa la cuenta a revisión.
 *
 * No valida la transición por su cuenta: el llamador ya comprobó
 * `canSubmitDocuments`. Aquí se re-verifica porque esta función también la
 * usan flujos futuros y una transición inválida debe fallar ruidosamente.
 */
export async function submitForReview(params: {
  userId: string;
  currentStatus: VerificationStatus;
  profession: string;
  licenseNumber: string;
  document: string;
  idDocumentPath: string;
  licenseDocumentPath: string;
}): Promise<void> {
  if (!canTransition(params.currentStatus, "pending_review")) {
    throw new Error(`Transición inválida: ${params.currentStatus} → pending_review`);
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("users")
    .update({
      verification_status: "pending_review",
      profession: params.profession,
      license_number: params.licenseNumber,
      document_enc: encrypt(params.document),
      id_document_path: params.idDocumentPath,
      license_document_path: params.licenseDocumentPath,
      verification_submitted_at: new Date().toISOString(),
      // Limpia la decisión anterior: si venía de un rechazo, el motivo viejo
      // no debe seguir mostrándose mientras se revisa el nuevo envío.
      verification_decided_at: null,
      verification_notes: null,
    })
    .eq("id", params.userId);
  if (error) throw error;
}

// ======================== Consola del admin de plataforma ===================

export interface PendingVerification {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  clinicId: string;
  clinicName: string;
  status: VerificationStatus;
  profession: string | null;
  licenseNumber: string | null;
  document: string | null;
  idDocumentPath: string | null;
  licenseDocumentPath: string | null;
  submittedAt: string | null;
  notes: string | null;
}

/**
 * Cola de revisión. Trae `pending_review` primero (lo accionable) y luego el
 * resto de estados no verificados, para que el revisor vea también quién quedó
 * rechazado o suspendido.
 */
export async function listVerifications(
  statuses: VerificationStatus[] = ["pending_review", "rejected", "suspended"],
): Promise<PendingVerification[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("users")
    .select(
      "id, full_name, email, role, clinic_id, verification_status, profession, license_number, document_enc, id_document_path, license_document_path, verification_submitted_at, verification_notes, clinics:clinics!users_clinic_id_fkey(name)",
    )
    .neq("role", "paciente")
    .in("verification_status", statuses)
    .order("verification_submitted_at", { ascending: true, nullsFirst: false });
  if (error) throw error;

  return (
    data as unknown as {
      id: string;
      full_name: string;
      email: string;
      role: UserRole;
      clinic_id: string;
      verification_status: VerificationStatus;
      profession: string | null;
      license_number: string | null;
      document_enc: string | null;
      id_document_path: string | null;
      license_document_path: string | null;
      verification_submitted_at: string | null;
      verification_notes: string | null;
      clinics: { name: string } | null;
    }[]
  ).map((r) => ({
    id: r.id,
    fullName: r.full_name,
    email: r.email,
    role: r.role,
    clinicId: r.clinic_id,
    clinicName: r.clinics?.name ?? "—",
    status: r.verification_status,
    profession: r.profession,
    licenseNumber: r.license_number,
    document: decryptNullable(r.document_enc),
    idDocumentPath: r.id_document_path,
    licenseDocumentPath: r.license_document_path,
    submittedAt: r.verification_submitted_at,
    notes: r.verification_notes,
  }));
}

/**
 * URL firmada y de vida corta para que el revisor abra un documento.
 * Usa service-role: el admin de plataforma no comparte clinic_id con el
 * profesional, así que la política por carpeta no le sirve para descargar.
 */
export async function getDocumentUrl(path: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error) return null;
  return data.signedUrl;
}

/**
 * Aprueba, rechaza o suspende. Devuelve el estado anterior para el audit log.
 *
 * Se ejecuta con service-role porque el revisor es admin de plataforma y no
 * pertenece a la clínica del profesional: RLS no le dejaría escribir. La
 * autorización la garantiza `requirePlatformAdmin()` en el llamador.
 */
export async function decideVerification(params: {
  userId: string;
  decision: Extract<VerificationStatus, "verified" | "rejected" | "suspended">;
  reviewerId: string;
  notes?: string | null;
}): Promise<{ previousStatus: VerificationStatus; clinicId: string }> {
  const admin = createAdminClient();

  const { data: current, error: readError } = await admin
    .from("users")
    .select("verification_status, clinic_id")
    .eq("id", params.userId)
    .single();
  if (readError) throw readError;

  if (!canTransition(current.verification_status, params.decision)) {
    throw new Error(
      `Transición inválida: ${current.verification_status} → ${params.decision}`,
    );
  }

  const { error } = await admin
    .from("users")
    .update({
      verification_status: params.decision,
      verification_decided_at: new Date().toISOString(),
      verified_by: params.reviewerId,
      verification_notes: params.notes ?? null,
    })
    .eq("id", params.userId)
    // Optimistic lock: si otro revisor decidió entre la lectura y esta
    // escritura, esta actualización no afecta ninguna fila en vez de pisar
    // la decisión ajena.
    .eq("verification_status", current.verification_status);
  if (error) throw error;

  return { previousStatus: current.verification_status, clinicId: current.clinic_id };
}

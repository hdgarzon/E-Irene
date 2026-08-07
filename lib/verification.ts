import type { UserRole } from "@/lib/auth";

/**
 * Verificación de habilitación profesional.
 *
 * Existe porque hasta ahora cualquiera podía registrarse y crear historias
 * clínicas. Ver docs/superpowers/specs/2026-08-06-retencion-y-onboarding-
 * verificado-design.md y la cláusula tercera de
 * docs/legal/consentimiento-profesional-borrador.md.
 *
 * Este módulo es lógica pura, sin acceso a base de datos: las reglas de quién
 * puede ejercer se pueden probar sin levantar Postgres. La misma regla vive
 * además en RLS (auth_can_access_clinical, migración 0032), que es el control
 * que de verdad manda — un guard de servidor se evade llamando la API directa,
 * una política de fila no.
 */

export type VerificationStatus =
  | "pending_documents"
  | "pending_review"
  | "verified"
  | "rejected"
  | "suspended";

export const VERIFICATION_LABELS: Record<VerificationStatus, string> = {
  pending_documents: "Documentos pendientes",
  pending_review: "En revisión",
  verified: "Verificado",
  rejected: "Rechazado",
  suspended: "Suspendido",
};

export const VERIFICATION_DESCRIPTIONS: Record<VerificationStatus, string> = {
  pending_documents:
    "Sube tu cédula y tu tarjeta profesional para poder atender pacientes en la plataforma.",
  pending_review:
    "Recibimos tus documentos. Estamos verificando tu habilitación profesional; te avisamos por correo en cuanto tengamos respuesta.",
  verified: "Tu habilitación profesional está verificada.",
  rejected: "No pudimos verificar tu habilitación. Revisa el motivo y vuelve a enviar tus documentos.",
  suspended:
    "Tu verificación fue suspendida. Escríbenos para revisar tu caso.",
};

/**
 * Transiciones permitidas. Cualquier otra combinación es un error de
 * programación, no una entrada del usuario.
 *
 * pending_documents → pending_review → verified
 *                            ↓             ↓
 *                        rejected      suspended
 *                            ↓             ↓
 *                     pending_review   (revisión manual)
 */
const ALLOWED_TRANSITIONS: Record<VerificationStatus, readonly VerificationStatus[]> = {
  pending_documents: ["pending_review"],
  pending_review: ["verified", "rejected"],
  // Reenviar documentos tras un rechazo vuelve a la cola.
  rejected: ["pending_review"],
  // Una verificación vigente se puede revocar (p. ej. inhabilitación reportada).
  verified: ["suspended"],
  // Rehabilitar exige pasar de nuevo por revisión, no un atajo a "verified".
  suspended: ["pending_review"],
};

export function canTransition(from: VerificationStatus, to: VerificationStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Roles que ejercen y por tanto deben verificarse ellos mismos. */
const CLINICAL_ROLES: readonly UserRole[] = ["admin", "doctor"];

export function roleRequiresVerification(role: UserRole): boolean {
  return CLINICAL_ROLES.includes(role);
}

/**
 * ¿Puede este usuario crear registros clínicos (pacientes, consultas)?
 *
 * Espejo en TypeScript de `auth_can_access_clinical()` en la migración 0032.
 * Si una cambia, la otra debe cambiar: la de SQL es la que protege, esta es la
 * que evita que el usuario choque contra un error de permisos sin explicación.
 *
 * @param clinicHasVerifiedProfessional  para secretarías, que no ejercen pero
 *   registran pacientes por cuenta de quien sí lo hace.
 */
export function canAccessClinical(params: {
  role: UserRole;
  status: VerificationStatus;
  clinicHasVerifiedProfessional?: boolean;
}): boolean {
  if (roleRequiresVerification(params.role)) return params.status === "verified";
  if (params.role === "secretaria") return params.clinicHasVerifiedProfessional === true;
  return false;
}

/** Estados desde los que el profesional puede (re)enviar documentos. */
export function canSubmitDocuments(status: VerificationStatus): boolean {
  return canTransition(status, "pending_review");
}

/** Lo que el admin de plataforma tiene por revisar. */
export function isAwaitingReview(status: VerificationStatus): boolean {
  return status === "pending_review";
}

// ============================ Documentos ====================================

export const DOCUMENTS_BUCKET = "professional-docs";
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_DOCUMENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

export type DocumentKind = "cedula" | "tarjeta";

/**
 * Convención de ruta en storage: {clinic_id}/{user_id}/{tipo}-{timestamp}.{ext}
 *
 * Los archivos los sube el navegador directo a Supabase Storage, no a través de
 * un Server Action: el límite de body de un action es 1 MB y una foto de cédula
 * lo supera con facilidad. La política RLS del bucket (migración 0032) exige que
 * las dos primeras carpetas sean la clínica y el usuario en sesión, así que el
 * cliente no puede escribir fuera de lo suyo aunque manipule esta ruta.
 */
export function buildDocumentPath(params: {
  clinicId: string;
  userId: string;
  kind: DocumentKind;
  fileName: string;
}): string {
  // split(".").pop() sobre un nombre sin punto devuelve el nombre completo, no
  // undefined: hay que comprobar que de verdad había extensión.
  const parts = params.fileName.split(".");
  const raw = parts.length > 1 ? parts[parts.length - 1] : "";
  const ext = raw.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  return `${params.clinicId}/${params.userId}/${params.kind}-${Date.now()}.${ext}`;
}

/**
 * El servidor recibe rutas, no archivos, así que debe confirmar que apuntan a
 * la carpeta del propio usuario. Sin esto alguien podría guardar en su perfil
 * la ruta del documento de otro profesional.
 */
export function isOwnDocumentPath(
  path: string,
  clinicId: string,
  userId: string,
): boolean {
  if (path.includes("..")) return false;
  return path.startsWith(`${clinicId}/${userId}/`);
}

/** Devuelve el mensaje de error, o null si el archivo sirve. */
export function validateDocumentFile(
  file: { size: number; type: string } | null,
  label: string,
): string | null {
  if (!file || file.size === 0) return `Adjunta ${label}`;
  if (file.size > MAX_DOCUMENT_BYTES) return `${label} supera los 5 MB`;
  if (!ACCEPTED_DOCUMENT_TYPES.includes(file.type as (typeof ACCEPTED_DOCUMENT_TYPES)[number])) {
    return `${label} debe ser JPG, PNG, WEBP o PDF`;
  }
  return null;
}

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { canSubmitDocuments, isOwnDocumentPath } from "@/lib/verification";
import { getMyVerification, submitForReview } from "@/lib/db/verification";
import { logAudit } from "@/lib/db/audit";
import { logger } from "@/lib/logger";

const FAILED = "No pudimos registrar tus documentos. Intenta de nuevo en unos minutos.";

export type VerificationState = {
  error?: string;
  fieldErrors?: Record<string, string>;
  success?: boolean;
};

const schema = z.object({
  profession: z.string().min(3, "Indica tu profesión"),
  licenseNumber: z.string().min(3, "Ingresa el número de tu tarjeta profesional"),
  document: z.string().min(5, "Ingresa tu número de cédula"),
  idDocumentPath: z.string().min(1, "Adjunta tu cédula"),
  licenseDocumentPath: z.string().min(1, "Adjunta tu tarjeta profesional"),
});

/**
 * Los archivos NO viajan por aquí: el navegador ya los subió directo a Supabase
 * Storage (ver components/verification-form.tsx) y este action solo recibe las
 * rutas. Un Server Action admite 1 MB de body por defecto y una foto de cédula
 * lo supera; además así los bytes no pasan por el servidor de Next.
 */
export async function submitVerificationAction(
  _prev: VerificationState,
  formData: FormData,
): Promise<VerificationState> {
  const user = await requireUser();

  const current = await getMyVerification(user.id);
  if (!current) return { error: FAILED };
  if (!canSubmitDocuments(current.status)) {
    return { error: "Tu verificación ya está en curso o aprobada." };
  }

  const parsed = schema.safeParse({
    profession: formData.get("profession"),
    licenseNumber: formData.get("licenseNumber"),
    document: formData.get("document"),
    idDocumentPath: formData.get("idDocumentPath"),
    licenseDocumentPath: formData.get("licenseDocumentPath"),
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { fieldErrors };
  }

  // El cliente eligió las rutas, así que hay que confirmar que son suyas. RLS
  // ya impide que escriba fuera de su carpeta; esto impide además que registre
  // en su perfil el documento de otro profesional.
  const owns =
    isOwnDocumentPath(parsed.data.idDocumentPath, user.clinicId, user.id) &&
    isOwnDocumentPath(parsed.data.licenseDocumentPath, user.clinicId, user.id);
  if (!owns) {
    logger.error("verification.path_mismatch", { userId: user.id });
    return { error: FAILED };
  }

  try {
    await submitForReview({
      userId: user.id,
      currentStatus: current.status,
      profession: parsed.data.profession,
      licenseNumber: parsed.data.licenseNumber,
      document: parsed.data.document,
      idDocumentPath: parsed.data.idDocumentPath,
      licenseDocumentPath: parsed.data.licenseDocumentPath,
    });

    // Sin cédula ni rutas en el metadata: audit_logs lo lee toda la clínica.
    await logAudit({
      clinicId: user.clinicId,
      actorId: user.id,
      action: "verification.submitted",
      entityType: "users",
      entityId: user.id,
      metadata: { profession: parsed.data.profession, from: current.status },
    });
  } catch (error) {
    logger.error("verification.submit_failed", { userId: user.id, error });
    return { error: FAILED };
  }

  revalidatePath("/verificacion");
  revalidatePath("/dashboard");
  return { success: true };
}

"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/auth";
import { decideVerification, getDocumentUrl } from "@/lib/db/verification";
import { storeDocumentHashes } from "@/lib/db/verification-documents";
import { logAuditPublic } from "@/lib/db/audit";
import { getEmailProvider } from "@/lib/email/providers";
import { buildVerificationDecisionEmail } from "@/lib/email/templates";
import { appBaseUrl } from "@/lib/app-url";
import { logger } from "@/lib/logger";

export type ReviewState = { error?: string; success?: string };

const FAILED = "No pudimos registrar la decisión. Intenta de nuevo.";

export async function decideVerificationAction(
  _prev: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const reviewer = await requirePlatformAdmin();

  const userId = String(formData.get("userId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const notes = String(formData.get("notes") ?? "").trim();

  if (!userId) return { error: FAILED };
  if (decision !== "verified" && decision !== "rejected" && decision !== "suspended") {
    return { error: FAILED };
  }
  // Rechazar o suspender sin decir por qué deja al profesional sin saber qué
  // corregir, y sin sustento si después reclama.
  if (decision !== "verified" && notes.length < 5) {
    return { error: "Indica el motivo: el profesional lo verá en su pantalla." };
  }

  try {
    const { previousStatus, clinicId, email, fullName } = await decideVerification({
      userId,
      decision,
      reviewerId: reviewer.id,
      notes: decision === "verified" ? (notes || null) : notes,
    });

    // Huella de lo que el revisor tuvo a la vista, antes de que la purga
    // borre los archivos a los 30 días. Es lo que deja la decisión auditable
    // sin conservar imágenes de documentos de identidad de por vida.
    try {
      await storeDocumentHashes(userId);
    } catch (hashError) {
      logger.error("verification.hash_failed", { userId, error: hashError });
    }

    // El correo va después de la decisión y no la condiciona: si falla el
    // envío, la decisión ya está tomada y no debe revertirse. Sin este aviso,
    // quien fue rechazado no tiene motivo para volver a entrar y nunca sabría
    // qué corregir.
    try {
      await getEmailProvider().send(
        buildVerificationDecisionEmail({
          to: email,
          doctorName: fullName,
          decision,
          notes: decision === "verified" ? null : notes,
          actionUrl: `${appBaseUrl()}${decision === "verified" ? "/dashboard" : "/verificacion"}`,
        }),
      );
    } catch (mailError) {
      logger.error("verification.email_failed", { userId, decision, error: mailError });
    }

    // Queda en el audit trail inmutable de la clínica del profesional: quién
    // decidió, qué decidió y desde qué estado.
    await logAuditPublic({
      clinicId,
      action: `verification.${decision}`,
      entityType: "users",
      entityId: userId,
      metadata: { reviewerId: reviewer.id, from: previousStatus, notes: notes || null },
    });
  } catch (error) {
    logger.error("verification.decide_failed", { userId, decision, error });
    return { error: error instanceof Error ? error.message : FAILED };
  }

  revalidatePath("/admin/verificaciones");
  return { success: "Decisión registrada." };
}

/** URL firmada de vida corta para abrir un documento desde la cola. */
export async function getDocumentUrlAction(path: string): Promise<string | null> {
  await requirePlatformAdmin();
  return getDocumentUrl(path);
}

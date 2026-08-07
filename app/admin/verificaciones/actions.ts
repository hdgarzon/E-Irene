"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/auth";
import { decideVerification, getDocumentUrl } from "@/lib/db/verification";
import { logAuditPublic } from "@/lib/db/audit";
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
    const { previousStatus, clinicId } = await decideVerification({
      userId,
      decision,
      reviewerId: reviewer.id,
      notes: decision === "verified" ? (notes || null) : notes,
    });

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

"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createConsent } from "@/lib/db/consents";
import { CONSENT_VERSION, CONSENT_HASH } from "@/lib/consent";
import { logAudit } from "@/lib/db/audit";

export type ConsentState = { error?: string; fieldErrors?: Record<string, string> };

export async function signConsentAction(
  patientId: string,
  _prev: ConsentState,
  formData: FormData,
): Promise<ConsentState> {
  const user = await requireUser();
  const signerName = String(formData.get("signerName") ?? "").trim();
  const signature = String(formData.get("signature") ?? "");
  const accepted = formData.get("accepted") === "on";
  const isMinor = formData.get("isMinor") === "on";
  const representativeDocument = String(formData.get("representativeDocument") ?? "").trim();
  const representativeRelationship = String(formData.get("representativeRelationship") ?? "").trim();

  const fieldErrors: Record<string, string> = {};
  if (signerName.length < 3) fieldErrors.signerName = "Ingresa el nombre completo de quien firma";
  if (!signature.startsWith("data:image/png")) fieldErrors.signature = "Falta la firma";
  if (!accepted) fieldErrors.accepted = "Debes aceptar el consentimiento";
  if (isMinor && representativeDocument.length < 5) {
    fieldErrors.representativeDocument = "Ingresa el documento del representante legal";
  }
  if (isMinor && !representativeRelationship) {
    fieldErrors.representativeRelationship = "Indica el parentesco del representante legal";
  }
  if (Object.keys(fieldErrors).length) return { fieldErrors };

  const h = await headers();
  const ip =
    (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "").trim() || null;
  const userAgent = h.get("user-agent");

  try {
    const supabase = await createClient();
    const bytes = Buffer.from(signature.split(",")[1], "base64");
    const path = `${user.clinicId}/${patientId}-${Date.now()}.png`;
    const { error: upErr } = await supabase.storage
      .from("signatures")
      .upload(path, bytes, { contentType: "image/png", upsert: false });
    if (upErr) throw upErr;

    const consent = await createConsent({
      clinicId: user.clinicId,
      patientId,
      documentVersion: CONSENT_VERSION,
      documentHash: CONSENT_HASH,
      signaturePath: path,
      signerName,
      ip,
      userAgent,
      isMinor,
      representativeDocument: isMinor ? representativeDocument : null,
      representativeRelationship: isMinor ? representativeRelationship : null,
    });
    await logAudit({
      clinicId: user.clinicId,
      actorId: user.id,
      action: "consent.signed",
      entityType: "consent",
      entityId: consent.id,
      metadata: { patientId },
    });
  } catch (error) {
    console.error("[consent] no se pudo registrar el consentimiento:", error);
    return { error: "No se pudo registrar el consentimiento. Intenta de nuevo." };
  }

  revalidatePath(`/patients/${patientId}`);
  redirect(`/patients/${patientId}`);
}

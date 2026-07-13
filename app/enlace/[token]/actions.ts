"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPatientLinkByToken, markPatientLinkCompleted } from "@/lib/db/patient-links";
import { createConsentViaLink } from "@/lib/db/consents";
import { createAssessmentViaLink } from "@/lib/db/assessments";
import { CONSENT_VERSION, CONSENT_HASH } from "@/lib/consent";
import { scoreAssessment, questionsFor, type AssessmentType } from "@/lib/psychometrics";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { logAuditPublic } from "@/lib/db/audit";
import { alertOnRiskyAssessment } from "@/lib/db/risk-alerts";
import { logger } from "@/lib/logger";
import type { ConsentState } from "@/app/(app)/patients/[id]/consent/actions";

export async function submitPublicConsentAction(
  token: string,
  _prev: ConsentState,
  formData: FormData,
): Promise<ConsentState> {
  const ip = await getClientIp();
  const rateOk = await checkRateLimit(`patient_link:${ip}`, 20, 3600);
  if (!rateOk) return { error: "Demasiados intentos. Espera unos minutos e intenta de nuevo." };

  const lookup = await getPatientLinkByToken(token);
  if (lookup.status !== "valid" || lookup.link.purpose !== "consent") {
    return { error: "Este enlace ya no es válido. Solicita uno nuevo a tu clínica." };
  }
  const { link } = lookup;

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
  const requestIp =
    (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "").trim() || null;
  const userAgent = h.get("user-agent");

  try {
    const admin = createAdminClient();
    const bytes = Buffer.from(signature.split(",")[1], "base64");
    const path = `${link.clinicId}/${link.patientId}-${Date.now()}.png`;
    const { error: upErr } = await admin.storage
      .from("signatures")
      .upload(path, bytes, { contentType: "image/png", upsert: false });
    if (upErr) throw upErr;

    const consent = await createConsentViaLink({
      clinicId: link.clinicId,
      patientId: link.patientId,
      linkId: link.id,
      documentVersion: CONSENT_VERSION,
      documentHash: CONSENT_HASH,
      signaturePath: path,
      signerName,
      ip: requestIp,
      userAgent,
      isMinor,
      representativeDocument: isMinor ? representativeDocument : null,
      representativeRelationship: isMinor ? representativeRelationship : null,
    });
    await markPatientLinkCompleted(link.id);
    await logAuditPublic({
      clinicId: link.clinicId,
      action: "consent.signed_via_link",
      entityType: "consent",
      entityId: consent.id,
      metadata: { patientId: link.patientId, linkId: link.id },
    });
  } catch (error) {
    logger.error("consent.sign_via_link_failed", {
      clinicId: link.clinicId,
      patientId: link.patientId,
      error,
    });
    return { error: "No se pudo registrar el consentimiento. Intenta de nuevo." };
  }

  redirect(`/enlace/${token}/gracias`);
}

export async function submitPublicAssessmentAction(token: string, formData: FormData): Promise<void> {
  const ip = await getClientIp();
  const rateOk = await checkRateLimit(`patient_link:${ip}`, 20, 3600);
  if (!rateOk) redirect(`/enlace/${token}?error=rate_limit`);

  const lookup = await getPatientLinkByToken(token);
  if (lookup.status !== "valid" || lookup.link.purpose !== "assessment" || !lookup.link.assessmentType) {
    redirect(`/enlace/${token}`);
  }
  const { link } = lookup;
  const type = link.assessmentType as AssessmentType;

  try {
    const count = questionsFor(type).length;
    const answers: number[] = [];
    for (let i = 0; i < count; i++) {
      answers.push(Number(formData.get(`q${i}`)));
    }
    const result = scoreAssessment(type, answers);

    const assessment = await createAssessmentViaLink(link.clinicId, {
      patientId: link.patientId,
      type,
      result,
      linkId: link.id,
    });
    await markPatientLinkCompleted(link.id);
    await logAuditPublic({
      clinicId: link.clinicId,
      action: "assessment.created_via_link",
      entityType: "psychometric_assessment",
      entityId: assessment.id,
      metadata: { type, totalScore: result.totalScore, linkId: link.id, patientId: link.patientId },
    });

    // Se espera (await): en un entorno serverless (Vercel) una llamada async
    // sin await puede quedar truncada si la función termina apenas se envía
    // la respuesta (el redirect() de abajo). alertOnRiskyAssessment nunca
    // lanza (captura sus propios errores, ver lib/db/risk-alerts.ts), así
    // que este await no puede hacer fallar el envío del paciente — solo le
    // agrega la latencia real del correo, aceptable para una alerta que debe
    // salir cuanto antes.
    await alertOnRiskyAssessment({
      clinicId: link.clinicId,
      patientId: link.patientId,
      assessmentId: assessment.id,
      type,
      answers: result.answers,
    });
  } catch (error) {
    logger.error("assessment.submit_via_link_failed", {
      clinicId: link.clinicId,
      patientId: link.patientId,
      type,
      error,
    });
    redirect(`/enlace/${token}?error=submit_failed`);
  }

  redirect(`/enlace/${token}/gracias`);
}

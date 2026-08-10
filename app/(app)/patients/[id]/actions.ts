"use server";

import { requireUser } from "@/lib/auth";
import { getPatient } from "@/lib/db/patients";
import { createPatientLink } from "@/lib/db/patient-links";
import { buildPatientLinkUrl } from "@/lib/patient-links";
import { getEmailProvider } from "@/lib/email/providers";
import { buildPatientLinkEmail } from "@/lib/email/templates";
import {
  recordNotification,
  statusForDeliveryMode,
  isSimulatedMode,
} from "@/lib/db/notifications";
import { logAudit } from "@/lib/db/audit";
import { logger } from "@/lib/logger";
import type { AssessmentType } from "@/lib/psychometrics";
import type { PatientLinkPurpose } from "@/lib/db/patient-links";

export type GenerateLinkResult =
  /** `delivered` false = el canal de correo no está configurado y el enlace hay
   *  que hacérselo llegar al paciente a mano. La interfaz debe decirlo: antes
   *  afirmaba "enviado al correo del paciente" pasara lo que pasara. */
  | { ok: true; url: string; delivered: boolean }
  | { ok: false; error: string };

async function generateAndSendLink(
  patientId: string,
  purpose: PatientLinkPurpose,
  assessmentType: AssessmentType | null,
): Promise<GenerateLinkResult> {
  const user = await requireUser();
  const patient = await getPatient(patientId);
  if (!patient) return { ok: false, error: "Paciente no encontrado." };
  if (!patient.email) return { ok: false, error: "El paciente no tiene correo registrado." };

  try {
    const { link, token } = await createPatientLink(user.clinicId, user.id, {
      patientId,
      purpose,
      assessmentType,
    });
    const url = buildPatientLinkUrl(token);

    const email = getEmailProvider();
    await email.send(
      buildPatientLinkEmail({
        to: patient.email,
        patientName: patient.fullName,
        clinicName: user.clinicName,
        url,
        purpose,
      }),
    );

    await recordNotification(user.clinicId, {
      patientId,
      channel: "email",
      type: purpose === "consent" ? "consent_link_sent" : "assessment_link_sent",
      status: statusForDeliveryMode(email.mode),
      // `mode` faltaba: sin él no había forma de distinguir después qué
      // enlaces salieron de verdad y cuáles solo se registraron.
      payload: { linkId: link.id, mode: email.mode },
    });
    await logAudit({
      clinicId: user.clinicId,
      actorId: user.id,
      action: "patient_link.created",
      entityType: "patient_link",
      entityId: link.id,
      metadata: { purpose, assessmentType, patientId },
    });

    return { ok: true, url, delivered: !isSimulatedMode(email.mode) };
  } catch (error) {
    logger.error("patient_link.generate_failed", {
      clinicId: user.clinicId,
      patientId,
      purpose,
      error,
    });
    return { ok: false, error: "No se pudo generar el link. Intenta de nuevo." };
  }
}

export async function generateConsentLinkAction(patientId: string): Promise<GenerateLinkResult> {
  return generateAndSendLink(patientId, "consent", null);
}

export async function generateAssessmentLinkAction(
  patientId: string,
  type: AssessmentType,
): Promise<GenerateLinkResult> {
  return generateAndSendLink(patientId, "assessment", type);
}

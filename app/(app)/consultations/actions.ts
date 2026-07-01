"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { getActiveConsent } from "@/lib/db/consents";
import {
  startConsultation,
  appendChunk,
  endConsultation,
  getConsultation,
  markConsultationAnalyzed,
} from "@/lib/db/consultations";
import { createReport, updateSuggestion, updateDoctorNotes, validateReport } from "@/lib/db/reports";
import { getAnalysisProvider } from "@/lib/providers";
import { getPatient } from "@/lib/db/patients";
import { recordNotification } from "@/lib/db/notifications";
import { getEmailProvider } from "@/lib/email/providers";
import { buildReportReadyEmail } from "@/lib/email/templates";
import { logAudit } from "@/lib/db/audit";

export async function startConsultationAction(patientId: string): Promise<void> {
  const user = await requireUser();
  const consent = await getActiveConsent(patientId);
  if (!consent) redirect(`/patients/${patientId}/consent`);

  const id = await startConsultation(user.clinicId, {
    patientId,
    doctorId: user.id,
    consentId: consent!.id,
  });
  await logAudit({
    clinicId: user.clinicId,
    actorId: user.id,
    action: "consultation.started",
    entityType: "consultation",
    entityId: id,
    metadata: { patientId },
  });
  redirect(`/consultations/${id}/live`);
}

export async function appendChunkAction(
  consultationId: string,
  chunk: { seq: number; speaker: string; text: string },
): Promise<void> {
  const user = await requireUser();
  await appendChunk(user.clinicId, consultationId, chunk);
}

export type SuggestionState = { ok?: boolean; error?: string };

export async function updateSuggestionAction(
  reportId: string,
  consultationId: string,
  _prev: SuggestionState,
  formData: FormData,
): Promise<SuggestionState> {
  const user = await requireUser();
  const suggestion = String(formData.get("suggestion") ?? "").trim();
  if (suggestion.length < 10) return { error: "La sugerencia es demasiado corta." };
  try {
    await updateSuggestion(reportId, suggestion);
    await logAudit({
      clinicId: user.clinicId,
      actorId: user.id,
      action: "report.suggestion_edited",
      entityType: "report",
      entityId: reportId,
    });
  } catch {
    return { error: "No se pudo guardar la sugerencia." };
  }
  revalidatePath(`/consultations/${consultationId}`);
  return { ok: true };
}

export type DoctorNotesState = { ok?: boolean; error?: string };

export async function updateDoctorNotesAction(
  reportId: string,
  consultationId: string,
  _prev: DoctorNotesState,
  formData: FormData,
): Promise<DoctorNotesState> {
  const user = await requireUser();
  const notes = String(formData.get("notes") ?? "").trim();
  try {
    await updateDoctorNotes(reportId, notes);
    await logAudit({
      clinicId: user.clinicId,
      actorId: user.id,
      action: "report.doctor_notes_edited",
      entityType: "report",
      entityId: reportId,
    });
  } catch {
    return { error: "No se pudieron guardar las notas." };
  }
  revalidatePath(`/consultations/${consultationId}`);
  return { ok: true };
}

export async function validateReportAction(reportId: string, consultationId: string): Promise<void> {
  const user = await requireUser();
  await validateReport(reportId, user.id);
  await logAudit({
    clinicId: user.clinicId,
    actorId: user.id,
    action: "report.validated",
    entityType: "report",
    entityId: reportId,
  });
  revalidatePath(`/consultations/${consultationId}`);
}

export async function endConsultationAction(consultationId: string): Promise<void> {
  const user = await requireUser();
  const transcript = await endConsultation(consultationId);
  await logAudit({
    clinicId: user.clinicId,
    actorId: user.id,
    action: "consultation.ended",
    entityType: "consultation",
    entityId: consultationId,
  });

  // Análisis IA (mock por defecto; OpenAI si hay key) → reporte cifrado.
  const consultation = await getConsultation(consultationId);
  if (consultation && transcript) {
    const payload = await getAnalysisProvider().analyze(transcript);
    const report = await createReport(user.clinicId, {
      consultationId,
      patientId: consultation.patientId,
      payload,
    });
    await markConsultationAnalyzed(consultationId);
    await logAudit({
      clinicId: user.clinicId,
      actorId: user.id,
      action: "report.generated",
      entityType: "report",
      entityId: report.id,
      metadata: { consultationId },
    });

    // Aviso "reporte listo" al paciente (sin contenido clínico).
    const patient = await getPatient(consultation.patientId);
    if (patient?.email) {
      try {
        await getEmailProvider().send(
          buildReportReadyEmail({
            to: patient.email,
            patientName: patient.fullName,
            clinicName: user.clinicName,
          }),
        );
        await recordNotification(user.clinicId, {
          patientId: consultation.patientId,
          type: "report_ready",
          status: "sent",
        });
      } catch {
        await recordNotification(user.clinicId, {
          patientId: consultation.patientId,
          type: "report_ready",
          status: "failed",
        });
      }
    }
  }

  redirect(`/consultations/${consultationId}`);
}

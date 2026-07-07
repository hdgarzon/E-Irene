"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireUser } from "@/lib/auth";
import { getActiveConsent } from "@/lib/db/consents";
import { startConsultation, appendChunk, endConsultation, setAnalysisStatus } from "@/lib/db/consultations";
import { updateSuggestion, updateDoctorNotes, validateReport } from "@/lib/db/reports";
import { upsertSoapNote } from "@/lib/db/soap-notes";
import { runConsultationAnalysis } from "@/lib/consultation-analysis";
import { logAudit } from "@/lib/db/audit";

export async function startConsultationAction(
  patientId: string,
  formData: FormData,
): Promise<void> {
  const user = await requireUser();
  const consent = await getActiveConsent(patientId);
  if (!consent) redirect(`/patients/${patientId}/consent`);

  const reason = String(formData.get("reason") ?? "").trim();
  const id = await startConsultation(user.clinicId, {
    patientId,
    doctorId: user.id,
    consentId: consent!.id,
    reason: reason || null,
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

export type SoapNoteState = { ok?: boolean; error?: string };

export async function saveSoapNoteAction(
  consultationId: string,
  patientId: string,
  _prev: SoapNoteState,
  formData: FormData,
): Promise<SoapNoteState> {
  const user = await requireUser();
  const clean = (v: FormDataEntryValue | null) => {
    const s = String(v ?? "").trim();
    return s || null;
  };
  try {
    await upsertSoapNote(user.clinicId, user.id, {
      consultationId,
      patientId,
      subjective: clean(formData.get("subjective")),
      objective: clean(formData.get("objective")),
      assessment: clean(formData.get("assessment")),
      plan: clean(formData.get("plan")),
    });
    await logAudit({
      clinicId: user.clinicId,
      actorId: user.id,
      action: "soap_note.saved",
      entityType: "consultation",
      entityId: consultationId,
    });
  } catch {
    return { error: "No se pudo guardar la nota SOAP." };
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

  if (transcript) {
    // El análisis de IA puede tardar (llamada real a OpenAI) o fallar; correrlo
    // síncrono aquí bloquearía el cierre de la sesión sin ningún reintento.
    // `after()` lo programa para después de enviar la respuesta (se ejecuta
    // igual aunque a continuación llamemos a `redirect()`), y el estado queda
    // en `consultations.analysis_status` para que la UI haga polling.
    await setAnalysisStatus(consultationId, "pending");
    const { clinicId, id: actorId, clinicName } = user;
    after(() => runConsultationAnalysis({ consultationId, clinicId, actorId, clinicName }));
  }

  redirect(`/consultations/${consultationId}`);
}

export async function retryAnalysisAction(consultationId: string): Promise<void> {
  const user = await requireUser();
  await setAnalysisStatus(consultationId, "pending");
  const { clinicId, id: actorId, clinicName } = user;
  after(() => runConsultationAnalysis({ consultationId, clinicId, actorId, clinicName }));
  revalidatePath(`/consultations/${consultationId}`);
}

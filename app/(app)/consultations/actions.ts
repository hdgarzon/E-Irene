"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getActiveConsent } from "@/lib/db/consents";
import {
  startConsultation,
  appendChunk,
  endConsultation,
} from "@/lib/db/consultations";
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

export async function endConsultationAction(consultationId: string): Promise<void> {
  const user = await requireUser();
  await endConsultation(consultationId);
  await logAudit({
    clinicId: user.clinicId,
    actorId: user.id,
    action: "consultation.ended",
    entityType: "consultation",
    entityId: consultationId,
  });
  redirect(`/consultations/${consultationId}`);
}

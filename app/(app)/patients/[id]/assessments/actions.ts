"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { createAssessment } from "@/lib/db/assessments";
import { scoreAssessment, questionsFor, type AssessmentType } from "@/lib/psychometrics";
import { logAudit } from "@/lib/db/audit";

export async function createAssessmentAction(
  patientId: string,
  type: AssessmentType,
  formData: FormData,
): Promise<void> {
  const user = await requireUser();
  const count = questionsFor(type).length;
  const answers: number[] = [];
  for (let i = 0; i < count; i++) {
    answers.push(Number(formData.get(`q${i}`)));
  }
  const result = scoreAssessment(type, answers);

  const assessment = await createAssessment(user.clinicId, user.id, {
    patientId,
    type,
    result,
  });
  await logAudit({
    clinicId: user.clinicId,
    actorId: user.id,
    action: "assessment.created",
    entityType: "psychometric_assessment",
    entityId: assessment.id,
    metadata: { type, totalScore: result.totalScore },
  });

  revalidatePath(`/patients/${patientId}`);
  revalidatePath(`/patients/${patientId}/progress`);
  redirect(`/patients/${patientId}/progress`);
}

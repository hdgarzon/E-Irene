"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import {
  createPlan,
  addItem,
  toggleItemStatus,
  getActivePlanForPatient,
  type TreatmentItemType,
  type TreatmentItemStatus,
} from "@/lib/db/treatment-plans";
import { logAudit } from "@/lib/db/audit";

export async function createPlanAction(patientId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;

  const planId = await createPlan(user.clinicId, user.id, { patientId, title });
  await logAudit({
    clinicId: user.clinicId,
    actorId: user.id,
    action: "treatment_plan.created",
    entityType: "treatment_plan",
    entityId: planId,
  });
  revalidatePath(`/patients/${patientId}`);
}

export async function addItemAction(
  planId: string,
  patientId: string,
  formData: FormData,
): Promise<void> {
  const user = await requireUser();
  const type = String(formData.get("type") ?? "") as TreatmentItemType;
  const description = String(formData.get("description") ?? "").trim();
  const targetDate = String(formData.get("targetDate") ?? "").trim();
  if (!description || (type !== "objetivo" && type !== "checkpoint")) return;

  const plan = await getActivePlanForPatient(patientId);
  const orderIndex = plan?.items.length ?? 0;

  await addItem(user.clinicId, {
    planId,
    type,
    description,
    targetDate: targetDate || null,
    orderIndex,
  });
  await logAudit({
    clinicId: user.clinicId,
    actorId: user.id,
    action: "treatment_plan.item_added",
    entityType: "treatment_plan",
    entityId: planId,
    metadata: { type },
  });
  revalidatePath(`/patients/${patientId}`);
}

export async function toggleItemAction(
  itemId: string,
  patientId: string,
  currentStatus: TreatmentItemStatus,
): Promise<void> {
  const user = await requireUser();
  const next: TreatmentItemStatus = currentStatus === "logrado" ? "pendiente" : "logrado";
  await toggleItemStatus(itemId, next);
  await logAudit({
    clinicId: user.clinicId,
    actorId: user.id,
    action: "treatment_plan.item_toggled",
    entityType: "treatment_plan",
    entityId: itemId,
    metadata: { status: next },
  });
  revalidatePath(`/patients/${patientId}`);
}

import { createClient } from "@/lib/supabase/server";
import { encrypt, decrypt } from "@/lib/crypto";

export type TreatmentPlanStatus = "activo" | "completado" | "archivado";
export type TreatmentItemType = "objetivo" | "checkpoint";
export type TreatmentItemStatus = "pendiente" | "logrado";

export interface TreatmentPlanItem {
  id: string;
  type: TreatmentItemType;
  description: string;
  targetDate: string | null;
  status: TreatmentItemStatus;
  completedAt: string | null;
}

export interface TreatmentPlan {
  id: string;
  patientId: string;
  title: string;
  status: TreatmentPlanStatus;
  createdAt: string;
  items: TreatmentPlanItem[];
}

interface PlanRow {
  id: string;
  patient_id: string;
  title_enc: string;
  status: TreatmentPlanStatus;
  created_at: string;
}

interface ItemRow {
  id: string;
  plan_id: string;
  type: TreatmentItemType;
  description_enc: string;
  target_date: string | null;
  status: TreatmentItemStatus;
  completed_at: string | null;
}

function mapItem(r: ItemRow): TreatmentPlanItem {
  return {
    id: r.id,
    type: r.type,
    description: decrypt(r.description_enc),
    targetDate: r.target_date,
    status: r.status,
    completedAt: r.completed_at,
  };
}

/** El plan activo más reciente del paciente, con sus objetivos y checkpoints. */
export async function getActivePlanForPatient(patientId: string): Promise<TreatmentPlan | null> {
  const supabase = await createClient();
  const { data: plan, error } = await supabase
    .from("treatment_plans")
    .select("id, patient_id, title_enc, status, created_at")
    .eq("patient_id", patientId)
    .eq("status", "activo")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!plan) return null;

  const { data: items, error: itemsError } = await supabase
    .from("treatment_plan_items")
    .select("id, plan_id, type, description_enc, target_date, status, completed_at")
    .eq("plan_id", plan.id)
    .order("order_index", { ascending: true });
  if (itemsError) throw itemsError;

  const p = plan as unknown as PlanRow;
  return {
    id: p.id,
    patientId: p.patient_id,
    title: decrypt(p.title_enc),
    status: p.status,
    createdAt: p.created_at,
    items: (items as unknown as ItemRow[]).map(mapItem),
  };
}

export async function createPlan(
  clinicId: string,
  createdBy: string,
  input: { patientId: string; title: string },
): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("treatment_plans")
    .insert({
      clinic_id: clinicId,
      patient_id: input.patientId,
      created_by: createdBy,
      title_enc: encrypt(input.title),
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function addItem(
  clinicId: string,
  input: {
    planId: string;
    type: TreatmentItemType;
    description: string;
    targetDate: string | null;
    orderIndex: number;
  },
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("treatment_plan_items").insert({
    clinic_id: clinicId,
    plan_id: input.planId,
    type: input.type,
    description_enc: encrypt(input.description),
    target_date: input.targetDate,
    order_index: input.orderIndex,
  });
  if (error) throw error;
}

export async function toggleItemStatus(itemId: string, status: TreatmentItemStatus): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("treatment_plan_items")
    .update({ status, completed_at: status === "logrado" ? new Date().toISOString() : null })
    .eq("id", itemId);
  if (error) throw error;
}

export async function setPlanStatus(planId: string, status: TreatmentPlanStatus): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("treatment_plans").update({ status }).eq("id", planId);
  if (error) throw error;
}

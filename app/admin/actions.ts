"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/auth";
import { setClinicPlan, setClinicSuspended } from "@/lib/db/platform-admin";
import {
  updateStaff,
  deleteStaff,
  updateAppointmentAdmin,
  deleteAppointmentAdmin,
  setPlanConfig,
} from "@/lib/db/platform-console";
import type { UserRole } from "@/lib/auth";

const PLANS = ["free", "pro", "clinica", "enterprise"] as const;
const ROLES: UserRole[] = ["admin", "doctor", "secretaria"];
const APPT_STATUS = ["scheduled", "confirmed", "completed", "cancelled", "no_show"] as const;

export async function setClinicPlanAction(clinicId: string, plan: string): Promise<void> {
  await requirePlatformAdmin();
  if (!PLANS.includes(plan as (typeof PLANS)[number])) return;
  await setClinicPlan(clinicId, plan);
  revalidatePath("/admin");
  revalidatePath("/admin/clinicas");
}

export async function setClinicSuspendedAction(clinicId: string, suspend: boolean): Promise<void> {
  await requirePlatformAdmin();
  await setClinicSuspended(clinicId, suspend);
  revalidatePath("/admin");
  revalidatePath("/admin/clinicas");
}

// ------------------------------- Doctores ----------------------------------

export type ActionState = { ok?: boolean; error?: string };

export async function updateStaffAction(
  id: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requirePlatformAdmin();
  const fullName = String(formData.get("fullName") ?? "").trim();
  const role = String(formData.get("role") ?? "") as UserRole;
  if (fullName.length < 2) return { error: "Nombre demasiado corto." };
  if (!ROLES.includes(role)) return { error: "Rol inválido." };
  try {
    await updateStaff(id, { fullName, role });
  } catch {
    return { error: "No se pudo actualizar el profesional." };
  }
  revalidatePath("/admin/doctores");
  return { ok: true };
}

export async function deleteStaffAction(id: string): Promise<ActionState> {
  await requirePlatformAdmin();
  const result = await deleteStaff(id);
  if (!result.ok) return { error: result.error };
  revalidatePath("/admin/doctores");
  return { ok: true };
}

// --------------------------------- Citas -----------------------------------

export async function rescheduleAppointmentAction(id: string, scheduledAt: string): Promise<void> {
  await requirePlatformAdmin();
  if (!scheduledAt) return;
  await updateAppointmentAdmin(id, { scheduledAt: new Date(scheduledAt).toISOString() });
  revalidatePath("/admin/citas");
}

export async function setAppointmentStatusAdminAction(id: string, status: string): Promise<void> {
  await requirePlatformAdmin();
  if (!APPT_STATUS.includes(status as (typeof APPT_STATUS)[number])) return;
  await updateAppointmentAdmin(id, { status });
  revalidatePath("/admin/citas");
}

export async function deleteAppointmentAdminAction(id: string): Promise<void> {
  await requirePlatformAdmin();
  await deleteAppointmentAdmin(id);
  revalidatePath("/admin/citas");
}

// --------------------------------- Planes ----------------------------------

export async function setPlanConfigAction(
  plan: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requirePlatformAdmin();
  const label = String(formData.get("label") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const price = String(formData.get("price") ?? "").trim();
  if (label.length < 1) return { error: "El título es obligatorio." };
  try {
    await setPlanConfig(plan, { label, description, price });
  } catch {
    return { error: "No se pudo guardar el plan." };
  }
  revalidatePath("/admin/planes");
  return { ok: true };
}

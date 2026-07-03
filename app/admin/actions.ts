"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/auth";
import { setClinicPlan, setClinicSuspended } from "@/lib/db/platform-admin";
import {
  updateStaff,
  deleteStaff,
  updatePatientAdmin,
  deletePatientAdmin,
  getAdminPatient,
  updateAppointmentAdmin,
  deleteAppointmentAdmin,
  setPlanConfig,
  type AdminPatientInput,
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

// ------------------------------- Pacientes ---------------------------------

function patientFromForm(formData: FormData): AdminPatientInput {
  const clean = (k: string) => {
    const v = String(formData.get(k) ?? "").trim();
    return v === "" ? null : v;
  };
  return {
    fullName: String(formData.get("fullName") ?? "").trim(),
    document: clean("document"),
    phone: clean("phone"),
    email: clean("email"),
    birthDate: clean("birthDate"),
    gender: clean("gender"),
    emergencyContactName: clean("emergencyContactName"),
    emergencyContactPhone: clean("emergencyContactPhone"),
    emergencyContactRelationship: clean("emergencyContactRelationship"),
  };
}

export async function updatePatientAdminAction(
  id: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requirePlatformAdmin();
  const input = patientFromForm(formData);
  if (input.fullName.length < 2) return { error: "Nombre demasiado corto." };
  const existing = await getAdminPatient(id);
  if (!existing) return { error: "Paciente no encontrado." };
  try {
    await updatePatientAdmin(id, input);
  } catch {
    return { error: "No se pudo actualizar el paciente." };
  }
  revalidatePath("/admin/pacientes");
  redirect("/admin/pacientes");
}

export async function deletePatientAdminAction(id: string): Promise<void> {
  await requirePlatformAdmin();
  await deletePatientAdmin(id);
  revalidatePath("/admin/pacientes");
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

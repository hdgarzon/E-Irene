"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/auth";
import { adjustVideoCredits, setClinicPlan, setClinicSuspended } from "@/lib/db/platform-admin";
import {
  updateStaff,
  deleteStaff,
  updateAppointmentAdmin,
  deleteAppointmentAdmin,
  setPlanConfig,
} from "@/lib/db/platform-console";
import type { UserRole } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { PLAN_ORDER, type Plan } from "@/lib/plans";

// Los mismos códigos que lib/plans.ts: con una lista propia, la consola no podía
// asignar los planes nuevos.
const PLANS: readonly Plan[] = PLAN_ORDER;
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
  const admin = await requirePlatformAdmin();
  const fullName = String(formData.get("fullName") ?? "").trim();
  const role = String(formData.get("role") ?? "") as UserRole;
  if (fullName.length < 2) return { error: "Nombre demasiado corto." };
  if (!ROLES.includes(role)) return { error: "Rol inválido." };
  try {
    await updateStaff(id, { fullName, role });
  } catch (error) {
    logger.error("admin.staff_update_failed", { actorId: admin.id, staffId: id, error });
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
  const admin = await requirePlatformAdmin();
  const label = String(formData.get("label") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const price = String(formData.get("price") ?? "").trim();
  if (label.length < 1) return { error: "El título es obligatorio." };
  try {
    await setPlanConfig(plan, { label, description, price });
  } catch (error) {
    logger.error("admin.plan_config_save_failed", { actorId: admin.id, plan, error });
    return { error: "No se pudo guardar el plan." };
  }
  revalidatePath("/admin/planes");
  return { ok: true };
}

// ------------------------------ Videollamadas ------------------------------

/** Ajuste del saldo de videollamadas de una clínica: reembolso o cortesía, con motivo. */
export async function adjustVideoCreditsAction(
  clinicId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requirePlatformAdmin();
  const delta = Number(formData.get("delta"));
  const note = String(formData.get("note") ?? "").trim();
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 100) {
    return { error: "El ajuste debe ser un entero entre -100 y 100, distinto de 0." };
  }
  if (note.length < 5) return { error: "Escribe el motivo del ajuste." };
  try {
    await adjustVideoCredits(clinicId, delta, note);
  } catch (error) {
    logger.error("admin.video_credits_adjust_failed", { actorId: admin.id, clinicId, delta, error });
    return { error: "No se pudo ajustar el saldo. Revisa que no quede negativo." };
  }
  revalidatePath("/admin/clinicas");
  return { ok: true };
}

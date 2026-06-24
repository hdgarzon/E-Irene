"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import {
  createAppointment,
  updateAppointment,
  setAppointmentStatus,
  type AppointmentInput,
} from "@/lib/db/appointments";
import { logAudit } from "@/lib/db/audit";
import { fromInputDateTime } from "@/lib/dates";

export type AppointmentFormState = {
  error?: string;
  fieldErrors?: Record<string, string>;
};

const STATUSES = ["scheduled", "confirmed", "completed", "cancelled", "no_show"] as const;

const schema = z.object({
  patientId: z.uuid("Selecciona un paciente"),
  doctorId: z.uuid("Selecciona un profesional"),
  scheduledAt: z.string().min(1, "Selecciona fecha y hora"),
  durationMin: z.coerce.number().int().min(10).max(240),
  notes: z.string().optional(),
});

function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

function parse(formData: FormData) {
  return schema.safeParse({
    patientId: formData.get("patientId"),
    doctorId: formData.get("doctorId"),
    scheduledAt: formData.get("scheduledAt"),
    durationMin: formData.get("durationMin"),
    notes: formData.get("notes"),
  });
}

function toInput(data: z.infer<typeof schema>): AppointmentInput {
  return {
    patientId: data.patientId,
    doctorId: data.doctorId,
    scheduledAt: fromInputDateTime(data.scheduledAt),
    durationMin: data.durationMin,
    notes: data.notes && data.notes.trim() !== "" ? data.notes.trim() : null,
  };
}

export async function createAppointmentAction(
  _prev: AppointmentFormState,
  formData: FormData,
): Promise<AppointmentFormState> {
  const user = await requireUser();
  const parsed = parse(formData);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  try {
    const appt = await createAppointment(user.clinicId, toInput(parsed.data));
    await logAudit({
      clinicId: user.clinicId,
      actorId: user.id,
      action: "appointment.created",
      entityType: "appointment",
      entityId: appt.id,
    });
  } catch {
    return { error: "No se pudo crear la cita. Intenta de nuevo." };
  }

  revalidatePath("/appointments");
  redirect("/appointments");
}

export async function updateAppointmentAction(
  appointmentId: string,
  _prev: AppointmentFormState,
  formData: FormData,
): Promise<AppointmentFormState> {
  const user = await requireUser();
  const parsed = parse(formData);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  try {
    await updateAppointment(appointmentId, toInput(parsed.data));
    await logAudit({
      clinicId: user.clinicId,
      actorId: user.id,
      action: "appointment.updated",
      entityType: "appointment",
      entityId: appointmentId,
    });
  } catch {
    return { error: "No se pudo actualizar la cita." };
  }

  revalidatePath("/appointments");
  redirect("/appointments");
}

export async function setStatusAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("appointmentId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !STATUSES.includes(status as (typeof STATUSES)[number])) return;

  await setAppointmentStatus(id, status as (typeof STATUSES)[number]);
  await logAudit({
    clinicId: user.clinicId,
    actorId: user.id,
    action: "appointment.status_changed",
    entityType: "appointment",
    entityId: id,
    metadata: { status },
  });
  revalidatePath("/appointments");
}

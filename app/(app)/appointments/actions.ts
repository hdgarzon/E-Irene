"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import {
  createAppointment,
  updateAppointment,
  setAppointmentStatus,
  getAppointment,
  type AppointmentInput,
} from "@/lib/db/appointments";
import { getPatient } from "@/lib/db/patients";
import { recordNotification } from "@/lib/db/notifications";
import { getEmailProvider } from "@/lib/email/providers";
import { buildReminderEmail } from "@/lib/email/templates";
import { logAudit } from "@/lib/db/audit";
import { fromInputDateTime, formatFullDate, formatTime } from "@/lib/dates";

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

export type ReminderResult = { ok: boolean; message: string };

export async function sendReminderAction(appointmentId: string): Promise<ReminderResult> {
  const user = await requireUser();
  const appt = await getAppointment(appointmentId);
  if (!appt) return { ok: false, message: "Cita no encontrada." };

  const patient = await getPatient(appt.patientId);
  const to = patient?.email ?? null;
  if (!to) {
    await recordNotification(user.clinicId, {
      patientId: appt.patientId,
      appointmentId,
      type: "appointment_reminder",
      status: "failed",
      payload: { reason: "sin_email" },
    });
    return { ok: false, message: "El paciente no tiene correo registrado." };
  }

  const provider = getEmailProvider();
  try {
    await provider.send(
      buildReminderEmail({
        to,
        patientName: appt.patientName,
        clinicName: user.clinicName,
        dateLabel: formatFullDate(appt.scheduledAt),
        timeLabel: formatTime(appt.scheduledAt),
      }),
    );
    await recordNotification(user.clinicId, {
      patientId: appt.patientId,
      appointmentId,
      type: "appointment_reminder",
      status: "sent",
      payload: { to, mode: provider.mode },
    });
    await logAudit({
      clinicId: user.clinicId,
      actorId: user.id,
      action: "reminder.sent",
      entityType: "appointment",
      entityId: appointmentId,
      metadata: { mode: provider.mode },
    });
  } catch {
    await recordNotification(user.clinicId, {
      patientId: appt.patientId,
      appointmentId,
      type: "appointment_reminder",
      status: "failed",
    });
    return { ok: false, message: "No se pudo enviar el recordatorio." };
  }

  const note =
    provider.mode === "log"
      ? "Recordatorio simulado (modo demo). Conecta Resend para envío real."
      : "Recordatorio enviado por correo.";
  return { ok: true, message: note };
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

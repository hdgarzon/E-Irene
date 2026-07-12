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
  ensureVideoRoom,
  type AppointmentInput,
} from "@/lib/db/appointments";
import { getActiveConsent } from "@/lib/db/consents";
import { startConsultation, getInProgressConsultationByAppointment } from "@/lib/db/consultations";
import { getPatient } from "@/lib/db/patients";
import { getClinicOverview } from "@/lib/db/clinic";
import { recordNotification } from "@/lib/db/notifications";
import { getEmailProvider } from "@/lib/email/providers";
import { buildReminderEmail } from "@/lib/email/templates";
import { getWhatsAppProvider, buildReminderWhatsApp } from "@/lib/whatsapp/providers";
import { PLANS } from "@/lib/plans";
import { logAudit } from "@/lib/db/audit";
import { logger } from "@/lib/logger";
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
  modality: z.enum(["in_person", "video"]).default("in_person"),
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
    modality: formData.get("modality"),
  });
}

function toInput(data: z.infer<typeof schema>): AppointmentInput {
  return {
    patientId: data.patientId,
    doctorId: data.doctorId,
    scheduledAt: fromInputDateTime(data.scheduledAt),
    durationMin: data.durationMin,
    notes: data.notes && data.notes.trim() !== "" ? data.notes.trim() : null,
    modality: data.modality,
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
  } catch (error) {
    logger.error("appointment.create_failed", { clinicId: user.clinicId, actorId: user.id, error });
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
  } catch (error) {
    logger.error("appointment.update_failed", {
      clinicId: user.clinicId,
      actorId: user.id,
      appointmentId,
      error,
    });
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

  const [patient, overview] = await Promise.all([
    getPatient(appt.patientId),
    getClinicOverview(),
  ]);
  const dateLabel = formatFullDate(appt.scheduledAt);
  const timeLabel = formatTime(appt.scheduledAt);

  // WhatsApp si el plan lo permite y hay teléfono; si no, correo.
  const useWhatsApp = PLANS[overview.plan].whatsapp && Boolean(patient?.phone);
  const channel: "email" | "whatsapp" = useWhatsApp ? "whatsapp" : "email";

  if (channel === "email" && !patient?.email) {
    await recordNotification(user.clinicId, {
      patientId: appt.patientId,
      appointmentId,
      channel,
      type: "appointment_reminder",
      status: "failed",
      payload: { reason: "sin_contacto" },
    });
    return { ok: false, message: "El paciente no tiene correo registrado." };
  }

  try {
    let videoJoinUrl: string | undefined;
    if (appt.modality === "video") {
      if (!process.env.NEXT_PUBLIC_SITE_URL) {
        throw new Error("NEXT_PUBLIC_SITE_URL no está configurada; no se puede generar el link de videollamada");
      }
      const { joinToken } = await ensureVideoRoom(appointmentId);
      videoJoinUrl = `${process.env.NEXT_PUBLIC_SITE_URL}/join/${joinToken}`;
    }

    let mode: string;
    if (channel === "whatsapp") {
      const wa = getWhatsAppProvider();
      await wa.send({
        to: patient!.phone!,
        body: buildReminderWhatsApp({
          patientName: appt.patientName,
          clinicName: user.clinicName,
          dateLabel,
          timeLabel,
          videoJoinUrl,
        }),
      });
      mode = wa.mode;
    } else {
      const email = getEmailProvider();
      await email.send(
        buildReminderEmail({
          to: patient!.email!,
          patientName: appt.patientName,
          clinicName: user.clinicName,
          dateLabel,
          timeLabel,
          videoJoinUrl,
        }),
      );
      mode = email.mode;
    }

    await recordNotification(user.clinicId, {
      patientId: appt.patientId,
      appointmentId,
      channel,
      type: "appointment_reminder",
      status: "sent",
      payload: { mode },
    });
    await logAudit({
      clinicId: user.clinicId,
      actorId: user.id,
      action: "reminder.sent",
      entityType: "appointment",
      entityId: appointmentId,
      metadata: { channel, mode },
    });

    const channelLabel = channel === "whatsapp" ? "WhatsApp" : "correo";
    const message =
      mode === "log" || mode === "twilio"
        ? `Recordatorio por ${channelLabel}${mode === "log" ? " simulado (modo demo)" : " enviado"}.`
        : `Recordatorio enviado por ${channelLabel}.`;
    return { ok: true, message };
  } catch (error) {
    logger.error("reminder.send_failed", {
      clinicId: user.clinicId,
      actorId: user.id,
      appointmentId,
      channel,
      error,
    });
    await recordNotification(user.clinicId, {
      patientId: appt.patientId,
      appointmentId,
      channel,
      type: "appointment_reminder",
      status: "failed",
    });
    return { ok: false, message: "No se pudo enviar el recordatorio." };
  }
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

/**
 * Inicia una videollamada desde una cita ya agendada: garantiza la sala (si
 * el recordatorio nunca se envió, aquí se crea por primera vez), crea la
 * consulta enlazada (o reutiliza una in_progress ya existente para esta cita,
 * evitando duplicados por doble clic o dos pestañas), y lleva al doctor a
 * /consultations/[id]/live.
 */
export async function startVideoConsultationAction(
  appointmentId: string,
): Promise<{ ok: boolean; message?: string }> {
  const user = await requireUser();
  const appt = await getAppointment(appointmentId);
  if (!appt || appt.modality !== "video") {
    return { ok: false, message: "Esta cita no es de modalidad video." };
  }
  if (appt.status === "cancelled" || appt.status === "completed") {
    return { ok: false, message: "Esta cita ya no admite iniciar una videollamada." };
  }

  const consent = await getActiveConsent(appt.patientId);
  if (!consent) redirect(`/patients/${appt.patientId}/consent`);

  let redirectTo: string;
  try {
    const existing = await getInProgressConsultationByAppointment(appointmentId);
    if (existing) {
      redirectTo = `/consultations/${existing.id}/live`;
    } else {
      await ensureVideoRoom(appointmentId);
      const consultationId = await startConsultation(user.clinicId, {
        patientId: appt.patientId,
        doctorId: appt.doctorId,
        consentId: consent!.id,
        appointmentId,
      });
      await logAudit({
        clinicId: user.clinicId,
        actorId: user.id,
        action: "consultation.started",
        entityType: "consultation",
        entityId: consultationId,
        metadata: { patientId: appt.patientId, appointmentId, modality: "video" },
      });
      redirectTo = `/consultations/${consultationId}/live`;
    }
  } catch (error) {
    logger.error("consultation.start_video_failed", {
      clinicId: user.clinicId,
      actorId: user.id,
      appointmentId,
      error,
    });
    return { ok: false, message: "No se pudo iniciar la videollamada. Intenta de nuevo." };
  }

  redirect(redirectTo);
}

import { createClient } from "@/lib/supabase/server";

type NotificationStatus = "pending" | "sent" | "failed";

/** Registra el envío (o intento) de una notificación. */
export async function recordNotification(
  clinicId: string,
  input: {
    patientId?: string | null;
    appointmentId?: string | null;
    type: string;
    status: NotificationStatus;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("notifications").insert({
    clinic_id: clinicId,
    patient_id: input.patientId ?? null,
    appointment_id: input.appointmentId ?? null,
    channel: "email",
    type: input.type,
    status: input.status,
    payload: (input.payload ?? {}) as never,
    sent_at: input.status === "sent" ? new Date().toISOString() : null,
  });
  if (error) throw error;
}

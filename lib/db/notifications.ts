import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type NotificationStatus = "pending" | "sent" | "failed" | "simulated";
type NotificationChannel = "email" | "whatsapp";

/**
 * Traduce el modo del proveedor al estado que debe quedar registrado.
 *
 * Sin RESEND_API_KEY / TWILIO_*, los proveedores degradan a un modo de log que
 * escribe en consola y devuelve un id falso. Registrar eso como 'sent' hace que
 * `notifications` —el registro con el que una clínica acreditaría haber
 * contactado al paciente— afirme envíos que nunca ocurrieron.
 *
 * Existe como función y no como condicional suelto en cada llamador para que la
 * regla sea una sola: antes cada ruta decidía distinto y dos de ellas mentían.
 */
export function statusForDeliveryMode(mode: string): NotificationStatus {
  return mode === "log" ? "simulated" : "sent";
}

/** ¿El canal está realmente configurado, o corre en modo simulado? */
export function isSimulatedMode(mode: string): boolean {
  return mode === "log";
}

/**
 * Marca temporal de envío. Solo un envío real la lleva: 'simulated' no la tiene
 * porque no hubo nada que fechar, y fecharlo sería exactamente la afirmación
 * falsa que este cambio corrige.
 */
export function sentAtFor(status: NotificationStatus): string | null {
  return status === "sent" ? new Date().toISOString() : null;
}

/** Registra el envío (o intento) de una notificación. */
export async function recordNotification(
  clinicId: string,
  input: {
    patientId?: string | null;
    appointmentId?: string | null;
    channel?: NotificationChannel;
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
    channel: input.channel ?? "email",
    type: input.type,
    status: input.status,
    payload: (input.payload ?? {}) as never,
    sent_at: sentAtFor(input.status),
  });
  if (error) throw error;
}

/**
 * Igual que `recordNotification`, pero para el flujo de link público sin
 * sesión: usa el cliente service-role (mismo patrón que `logAuditPublic` en
 * `lib/db/audit.ts`).
 */
export async function recordNotificationPublic(
  clinicId: string,
  input: {
    patientId?: string | null;
    channel?: NotificationChannel;
    type: string;
    status: NotificationStatus;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("notifications").insert({
    clinic_id: clinicId,
    patient_id: input.patientId ?? null,
    appointment_id: null,
    channel: input.channel ?? "email",
    type: input.type,
    status: input.status,
    payload: (input.payload ?? {}) as never,
    sent_at: sentAtFor(input.status),
  });
  if (error) throw error;
}

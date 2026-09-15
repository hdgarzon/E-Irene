import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Saldo y reservas de videollamadas (migración 0058).
 *
 * Las reglas viven en la base: las funciones fijan la clínica con auth_clinic_id(),
 * serializan los inicios y descuentan una sola vez por consulta. Descontar solo lo
 * hace el servidor (service_role): desde la sesión nadie se descuenta ni se devuelve
 * saldo, y una reserva de una consulta en curso no se puede liberar.
 */

export interface VideoCredits {
  /** Comprado y ajustado − consumido. */
  balance: number;
  /** Retenido por consultas por video en curso. */
  held: number;
  /** Lo que se puede usar para iniciar: balance − held. */
  available: number;
}

export async function getVideoCredits(): Promise<VideoCredits> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_video_credits");
  if (error) throw error;
  const r = data as { balance?: number; held?: number; available?: number } | null;
  return {
    balance: Number(r?.balance ?? 0),
    held: Number(r?.held ?? 0),
    available: Number(r?.available ?? 0),
  };
}

export type ReserveResult =
  | { status: "reserved"; reservationId: string; available: number }
  | { status: "insufficient"; available: number }
  | { status: "not_video" };

/** Reserva una videollamada para iniciar la consulta por video de una cita. */
export async function reserveVideoCall(appointmentId: string): Promise<ReserveResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reserve_video_call", {
    p_appointment_id: appointmentId,
  });
  if (error) throw error;
  const r = data as { status: string; reservation_id?: string; available?: number };
  if (r.status === "reserved" && r.reservation_id) {
    return { status: "reserved", reservationId: r.reservation_id, available: Number(r.available ?? 0) };
  }
  if (r.status === "insufficient") {
    return { status: "insufficient", available: Number(r.available ?? 0) };
  }
  return { status: "not_video" };
}

export async function attachVideoReservation(
  reservationId: string,
  consultationId: string,
): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("attach_video_reservation", {
    p_reservation_id: reservationId,
    p_consultation_id: consultationId,
  });
  if (error) throw error;
  return data === true;
}

/** Libera una reserva que no llegó a enlazar su consulta. */
export async function releaseVideoReservation(reservationId: string, reason: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("release_video_reservation", {
    p_reservation_id: reservationId,
    p_reason: reason,
  });
  if (error) throw error;
  return data === true;
}

/** Libera la reserva de una consulta ya cerrada que no se descontó. */
export async function releaseVideoCall(consultationId: string, reason: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("release_video_call", {
    p_consultation_id: consultationId,
    p_reason: reason,
  });
  if (error) throw error;
  return data === true;
}

export type VideoReservationStatus = "held" | "consumed" | "released";

export async function getVideoReservationStatus(
  consultationId: string,
): Promise<VideoReservationStatus | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_video_reservation_status", {
    p_consultation_id: consultationId,
  });
  if (error) throw error;
  return (data as VideoReservationStatus | null) ?? null;
}

/** Sala y horario de una consulta por video de la clínica de la sesión. */
export async function getConsultationVideoContext(consultationId: string): Promise<{
  appointmentId: string;
  roomName: string;
  startedAt: string;
  endedAt: string | null;
} | null> {
  const supabase = await createClient();
  const { data: consultation, error } = await supabase
    .from("consultations")
    .select("appointment_id, started_at, ended_at")
    .eq("id", consultationId)
    .maybeSingle();
  if (error) throw error;
  if (!consultation?.appointment_id) return null;
  const { data: appointment, error: appointmentError } = await supabase
    .from("appointments")
    .select("video_room_name")
    .eq("id", consultation.appointment_id)
    .maybeSingle();
  if (appointmentError) throw appointmentError;
  if (!appointment?.video_room_name) return null;
  return {
    appointmentId: consultation.appointment_id,
    roomName: appointment.video_room_name,
    startedAt: consultation.started_at,
    endedAt: consultation.ended_at,
  };
}

export type ConsumeResult = "consumed" | "already_consumed" | "released" | "no_reservation";

/**
 * Solo servidor: el paciente se conectó, se descuenta la videollamada de la consulta
 * (una sola vez). `source` queda en el movimiento del saldo como constancia.
 */
export async function consumeVideoCall(input: {
  consultationId: string;
  source: string;
  joinedAt?: string;
}): Promise<ConsumeResult> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("consume_video_call", {
    p_consultation_id: input.consultationId,
    p_source: input.source,
    p_joined_at: input.joinedAt,
  });
  if (error) throw error;
  return (data as { status: ConsumeResult }).status;
}

/**
 * Solo servidor (webhook de Daily): la consulta de la cita a la que corresponde una
 * conexión a `roomName`. La sala tiene que ser la de la cita —un evento con el id de
 * una cita y la sala de otra no descuenta nada— y la consulta, la última que empezó
 * antes de la conexión, aunque ya haya terminado (aviso tardío).
 */
export async function findVideoConsultationForRoom(input: {
  appointmentId: string;
  roomName: string;
  joinedAt: Date;
}): Promise<{ consultationId: string; clinicId: string } | null> {
  const admin = createAdminClient();
  const { data: appointment, error } = await admin
    .from("appointments")
    .select("clinic_id, video_room_name")
    .eq("id", input.appointmentId)
    .maybeSingle();
  if (error) throw error;
  if (!appointment || appointment.video_room_name !== input.roomName) return null;

  // Margen de un minuto: el reloj de Daily y el de la base no coinciden al segundo.
  const { data: consultations, error: consultationError } = await admin
    .from("consultations")
    .select("id")
    .eq("appointment_id", input.appointmentId)
    .lte("started_at", new Date(input.joinedAt.getTime() + 60_000).toISOString())
    .order("started_at", { ascending: false })
    .limit(1);
  if (consultationError) throw consultationError;
  const consultation = consultations?.[0];
  return consultation ? { consultationId: consultation.id, clinicId: appointment.clinic_id } : null;
}

/** Solo servidor (/join/[token], sin sesión): ¿el profesional ya inició la consulta? */
export async function hasConsultationInProgress(appointmentId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("consultations")
    .select("id")
    .eq("appointment_id", appointmentId)
    .eq("status", "in_progress")
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

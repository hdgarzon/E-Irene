// lib/db/appointments.ts
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/crypto";
import { dayKey } from "@/lib/dates";
import { getVideoProvider } from "@/lib/video";
import type { Database } from "@/types/database";

export type AppointmentStatus = Database["public"]["Enums"]["appointment_status"];
export type AppointmentModality = "in_person" | "video";

export interface AppointmentInput {
  patientId: string;
  doctorId: string;
  scheduledAt: string; // ISO
  durationMin: number;
  notes?: string | null;
  status?: AppointmentStatus;
  modality?: AppointmentModality;
}

export interface Appointment {
  id: string;
  patientId: string;
  patientName: string;
  doctorId: string;
  doctorName: string;
  scheduledAt: string;
  durationMin: number;
  status: AppointmentStatus;
  notes: string | null;
  modality: AppointmentModality;
  videoRoomName: string | null;
  videoRoomUrl: string | null;
  videoJoinToken: string | null;
}

const SELECT =
  "id, patient_id, doctor_id, scheduled_at, duration_min, status, notes, " +
  "modality, video_room_name, video_room_url, video_join_token, " +
  "patients!appointments_patient_id_fkey(full_name_enc), " +
  "doctor:users!appointments_doctor_id_fkey(full_name)";

interface RawRow {
  id: string;
  patient_id: string;
  doctor_id: string;
  scheduled_at: string;
  duration_min: number;
  status: AppointmentStatus;
  notes: string | null;
  modality: AppointmentModality;
  video_room_name: string | null;
  video_room_url: string | null;
  video_join_token: string | null;
  patients: { full_name_enc: string } | null;
  doctor: { full_name: string } | null;
}

function mapRow(row: RawRow): Appointment {
  return {
    id: row.id,
    patientId: row.patient_id,
    patientName: row.patients ? decrypt(row.patients.full_name_enc) : "—",
    doctorId: row.doctor_id,
    doctorName: row.doctor?.full_name ?? "—",
    scheduledAt: row.scheduled_at,
    durationMin: row.duration_min,
    status: row.status,
    notes: row.notes,
    modality: row.modality,
    videoRoomName: row.video_room_name,
    videoRoomUrl: row.video_room_url,
    videoJoinToken: row.video_join_token,
  };
}

export async function listAppointments(): Promise<Appointment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("appointments")
    .select(SELECT)
    .order("scheduled_at", { ascending: true });
  if (error) throw error;
  return (data as unknown as RawRow[]).map(mapRow);
}

/**
 * Citas de HOY (zona Bogotá, UTC-5 sin DST) que no estén canceladas, para la
 * agenda del día en el dashboard. Consulta acotada por rango de fecha (no trae
 * toda la agenda).
 */
export async function listTodayAppointments(): Promise<Appointment[]> {
  const supabase = await createClient();
  const key = dayKey(new Date());
  const from = new Date(`${key}T00:00:00-05:00`).toISOString();
  const to = new Date(`${key}T23:59:59-05:00`).toISOString();
  const { data, error } = await supabase
    .from("appointments")
    .select(SELECT)
    .gte("scheduled_at", from)
    .lte("scheduled_at", to)
    .neq("status", "cancelled")
    .order("scheduled_at", { ascending: true });
  if (error) throw error;
  return (data as unknown as RawRow[]).map(mapRow);
}

export async function getAppointment(id: string): Promise<Appointment | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("appointments")
    .select(SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRow(data as unknown as RawRow) : null;
}

/**
 * Busca una cita por su token de acceso a videollamada (para /join/[token]).
 * No requiere sesión — el token ES la autorización (ver spec §5/§8).
 */
export async function getAppointmentByJoinToken(token: string): Promise<Appointment | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("appointments")
    .select(SELECT)
    .eq("video_join_token", token)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRow(data as unknown as RawRow) : null;
}

export async function createAppointment(
  clinicId: string,
  input: AppointmentInput,
): Promise<Appointment> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("appointments")
    .insert({
      clinic_id: clinicId,
      patient_id: input.patientId,
      doctor_id: input.doctorId,
      scheduled_at: input.scheduledAt,
      duration_min: input.durationMin,
      notes: input.notes ?? null,
      status: input.status ?? "scheduled",
      modality: input.modality ?? "in_person",
    })
    .select(SELECT)
    .single();
  if (error) throw error;
  return mapRow(data as unknown as RawRow);
}

export async function updateAppointment(
  id: string,
  input: AppointmentInput,
): Promise<Appointment> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("appointments")
    .update({
      patient_id: input.patientId,
      doctor_id: input.doctorId,
      scheduled_at: input.scheduledAt,
      duration_min: input.durationMin,
      notes: input.notes ?? null,
      modality: input.modality ?? "in_person",
    })
    .eq("id", id)
    .select(SELECT)
    .single();
  if (error) throw error;
  return mapRow(data as unknown as RawRow);
}

export async function setAppointmentStatus(
  id: string,
  status: AppointmentStatus,
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("appointments").update({ status }).eq("id", id);
  if (error) throw error;
}

/**
 * Garantiza que la cita tenga sala de video + token de acceso, creándolos la
 * primera vez que hacen falta (al enviar el recordatorio o al iniciar la
 * videollamada — ver spec §3). Idempotente: si ya existen, los devuelve tal
 * cual sin llamar al proveedor de nuevo.
 */
export async function ensureVideoRoom(
  appointmentId: string,
): Promise<{ roomName: string; roomUrl: string; joinToken: string }> {
  const supabase = await createClient();
  const existing = await getAppointment(appointmentId);
  if (!existing) throw new Error(`Cita ${appointmentId} no encontrada`);
  if (existing.videoRoomName && existing.videoRoomUrl && existing.videoJoinToken) {
    return {
      roomName: existing.videoRoomName,
      roomUrl: existing.videoRoomUrl,
      joinToken: existing.videoJoinToken,
    };
  }

  const room = await getVideoProvider().createRoom(appointmentId);
  const joinToken = randomUUID();
  const { error } = await supabase
    .from("appointments")
    .update({
      video_room_name: room.roomName,
      video_room_url: room.roomUrl,
      video_join_token: joinToken,
    })
    .eq("id", appointmentId);
  if (error) throw error;
  return { roomName: room.roomName, roomUrl: room.roomUrl, joinToken };
}

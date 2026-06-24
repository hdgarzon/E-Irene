import { createClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/crypto";
import type { Database } from "@/types/database";

export type AppointmentStatus = Database["public"]["Enums"]["appointment_status"];

export interface AppointmentInput {
  patientId: string;
  doctorId: string;
  scheduledAt: string; // ISO
  durationMin: number;
  notes?: string | null;
  status?: AppointmentStatus;
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
}

const SELECT =
  "id, patient_id, doctor_id, scheduled_at, duration_min, status, notes, " +
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

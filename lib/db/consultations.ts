import { createClient } from "@/lib/supabase/server";
import { encrypt, decrypt } from "@/lib/crypto";
import type { Database } from "@/types/database";

export type ConsultationStatus = Database["public"]["Enums"]["consultation_status"];

export interface Consultation {
  id: string;
  patientId: string;
  patientName: string;
  doctorId: string;
  doctorName: string;
  status: ConsultationStatus;
  startedAt: string;
  endedAt: string | null;
  reason: string | null;
}

interface ConsultationRow {
  id: string;
  patient_id: string;
  doctor_id: string;
  status: ConsultationStatus;
  started_at: string;
  ended_at: string | null;
  reason_enc: string | null;
  patients: { full_name_enc: string } | null;
  doctor: { full_name: string } | null;
}

const SELECT =
  "id, patient_id, doctor_id, status, started_at, ended_at, reason_enc, " +
  "patients!consultations_patient_id_fkey(full_name_enc), " +
  "doctor:users!consultations_doctor_id_fkey(full_name)";

function mapRow(r: ConsultationRow): Consultation {
  return {
    id: r.id,
    patientId: r.patient_id,
    patientName: safeDecryptName(r.patients?.full_name_enc),
    doctorId: r.doctor_id,
    doctorName: r.doctor?.full_name ?? "—",
    status: r.status,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    reason: r.reason_enc ? decrypt(r.reason_enc) : null,
  };
}

/**
 * Descifra el nombre del paciente sin lanzar: si el cifrado no corresponde a
 * la clave actual (p. ej. tras rotar ENCRYPTION_KEY sin migrar datos
 * antiguos), muestra un placeholder en vez de romper toda la lista.
 */
function safeDecryptName(fullNameEnc: string | null | undefined): string {
  if (!fullNameEnc) return "—";
  try {
    return decrypt(fullNameEnc);
  } catch {
    return "(nombre no disponible)";
  }
}

export async function startConsultation(
  clinicId: string,
  input: { patientId: string; doctorId: string; consentId: string | null; reason?: string | null },
): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("consultations")
    .insert({
      clinic_id: clinicId,
      patient_id: input.patientId,
      doctor_id: input.doctorId,
      consent_id: input.consentId,
      status: "in_progress",
      reason_enc: input.reason ? encrypt(input.reason) : null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function getConsultation(id: string): Promise<Consultation | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("consultations").select(SELECT).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? mapRow(data as unknown as ConsultationRow) : null;
}

/** Todas las consultas de la clínica del usuario (RLS scoped), más recientes primero. */
export async function listConsultations(): Promise<Consultation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("consultations")
    .select(SELECT)
    .order("started_at", { ascending: false });
  if (error) throw error;
  return (data as unknown as ConsultationRow[]).map(mapRow);
}

export async function listConsultationsForPatient(patientId: string): Promise<Consultation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("consultations")
    .select(SELECT)
    .eq("patient_id", patientId)
    .order("started_at", { ascending: false });
  if (error) throw error;
  return (data as unknown as ConsultationRow[]).map(mapRow);
}

/** Inserta un fragmento de transcripción (texto cifrado). */
export async function appendChunk(
  clinicId: string,
  consultationId: string,
  chunk: { seq: number; speaker: string; text: string },
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("transcript_chunks").insert({
    clinic_id: clinicId,
    consultation_id: consultationId,
    seq: chunk.seq,
    speaker: chunk.speaker,
    text_enc: encrypt(chunk.text),
    is_final: true,
  });
  if (error) throw error;
}

/** Reconstruye la transcripción completa (descifrada) a partir de los chunks. */
export async function buildTranscript(consultationId: string): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("transcript_chunks")
    .select("speaker, text_enc")
    .eq("consultation_id", consultationId)
    .order("seq", { ascending: true });
  if (error) throw error;
  return (data ?? [])
    .map((c) => `${c.speaker}: ${decrypt(c.text_enc)}`)
    .join("\n");
}

/** Cierra la consulta: reconstruye y cifra la transcripción completa. Devuelve el texto. */
export async function endConsultation(consultationId: string): Promise<string> {
  const supabase = await createClient();
  const transcript = await buildTranscript(consultationId);
  const { error } = await supabase
    .from("consultations")
    .update({
      status: "ended",
      ended_at: new Date().toISOString(),
      transcript_enc: transcript ? encrypt(transcript) : null,
    })
    .eq("id", consultationId);
  if (error) throw error;
  return transcript;
}

export async function markConsultationAnalyzed(consultationId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("consultations")
    .update({ status: "analyzed" })
    .eq("id", consultationId);
  if (error) throw error;
}

export async function getTranscript(consultationId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("consultations")
    .select("transcript_enc")
    .eq("id", consultationId)
    .maybeSingle();
  if (error) throw error;
  return data?.transcript_enc ? decrypt(data.transcript_enc) : null;
}

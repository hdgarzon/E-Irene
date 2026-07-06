import { createClient } from "@/lib/supabase/server";
import {
  decryptPatient,
  encryptPatient,
  tryDecryptPatient,
  type Patient,
  type PatientInput,
  type PatientRow,
} from "./patient-mappers";

const COLUMNS =
  "id, clinic_id, full_name_enc, document_enc, phone_enc, email_enc, notes_enc, birth_date, gender, created_at, " +
  "emergency_contact_name_enc, emergency_contact_phone_enc, emergency_contact_relationship_enc, history_enc";

/** Lista los pacientes de la clínica del usuario (RLS scoped). */
export async function listPatients(): Promise<Patient[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("patients")
    .select(COLUMNS)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as unknown as PatientRow[])
    .map(tryDecryptPatient)
    .filter((p): p is Patient => p !== null);
}

/** Obtiene un paciente por id (o null si no existe o no se puede descifrar). */
export async function getPatient(id: string): Promise<Patient | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("patients")
    .select(COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? tryDecryptPatient(data as unknown as PatientRow) : null;
}

/** Crea un paciente con PII cifrada. `clinicId`/`createdBy` vienen de la sesión. */
export async function createPatient(
  clinicId: string,
  createdBy: string,
  input: PatientInput,
): Promise<Patient> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("patients")
    .insert({ clinic_id: clinicId, created_by: createdBy, ...encryptPatient(input) })
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return decryptPatient(data as unknown as PatientRow);
}

/** Actualiza un paciente (re-cifra los campos sensibles). */
export async function updatePatient(id: string, input: PatientInput): Promise<Patient> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("patients")
    .update(encryptPatient(input))
    .eq("id", id)
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return decryptPatient(data as unknown as PatientRow);
}

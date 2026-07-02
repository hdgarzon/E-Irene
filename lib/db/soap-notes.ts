import { createClient } from "@/lib/supabase/server";
import { encryptNullable, decryptNullable } from "@/lib/crypto";

export interface SoapNote {
  id: string;
  consultationId: string;
  subjective: string | null;
  objective: string | null;
  assessment: string | null;
  plan: string | null;
  updatedAt: string;
}

export interface SoapNoteInput {
  subjective: string | null;
  objective: string | null;
  assessment: string | null;
  plan: string | null;
}

interface SoapNoteRow {
  id: string;
  consultation_id: string;
  subjective_enc: string | null;
  objective_enc: string | null;
  assessment_enc: string | null;
  plan_enc: string | null;
  updated_at: string;
}

const COLS = "id, consultation_id, subjective_enc, objective_enc, assessment_enc, plan_enc, updated_at";

function mapRow(r: SoapNoteRow): SoapNote {
  return {
    id: r.id,
    consultationId: r.consultation_id,
    subjective: decryptNullable(r.subjective_enc),
    objective: decryptNullable(r.objective_enc),
    assessment: decryptNullable(r.assessment_enc),
    plan: decryptNullable(r.plan_enc),
    updatedAt: r.updated_at,
  };
}

export async function getSoapNoteByConsultation(consultationId: string): Promise<SoapNote | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("soap_notes")
    .select(COLS)
    .eq("consultation_id", consultationId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRow(data as unknown as SoapNoteRow) : null;
}

/** Todas las notas SOAP del paciente, indexadas por consultation_id. */
export async function listSoapNotesForPatient(patientId: string): Promise<Map<string, SoapNote>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("soap_notes")
    .select(COLS)
    .eq("patient_id", patientId);
  if (error) throw error;
  const map = new Map<string, SoapNote>();
  for (const row of data as unknown as SoapNoteRow[]) {
    const note = mapRow(row);
    map.set(note.consultationId, note);
  }
  return map;
}

/** Crea o actualiza (upsert por consultation_id) la nota SOAP de la consulta. */
export async function upsertSoapNote(
  clinicId: string,
  createdBy: string,
  input: { consultationId: string; patientId: string } & SoapNoteInput,
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("soap_notes")
    .upsert(
      {
        clinic_id: clinicId,
        consultation_id: input.consultationId,
        patient_id: input.patientId,
        created_by: createdBy,
        subjective_enc: encryptNullable(input.subjective),
        objective_enc: encryptNullable(input.objective),
        assessment_enc: encryptNullable(input.assessment),
        plan_enc: encryptNullable(input.plan),
      },
      { onConflict: "consultation_id" },
    );
  if (error) throw error;
}

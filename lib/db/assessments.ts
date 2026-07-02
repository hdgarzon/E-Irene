import { createClient } from "@/lib/supabase/server";
import { encrypt, decrypt } from "@/lib/crypto";
import type { AssessmentType, AssessmentResult } from "@/lib/psychometrics";

export interface Assessment {
  id: string;
  patientId: string;
  type: AssessmentType;
  result: AssessmentResult;
  administeredAt: string;
}

interface AssessmentRow {
  id: string;
  patient_id: string;
  type: AssessmentType;
  payload_enc: string;
  administered_at: string;
}

const COLS = "id, patient_id, type, payload_enc, administered_at";

function mapRow(r: AssessmentRow): Assessment {
  return {
    id: r.id,
    patientId: r.patient_id,
    type: r.type,
    result: JSON.parse(decrypt(r.payload_enc)) as AssessmentResult,
    administeredAt: r.administered_at,
  };
}

export async function createAssessment(
  clinicId: string,
  createdBy: string,
  input: { patientId: string; type: AssessmentType; result: AssessmentResult },
): Promise<Assessment> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("psychometric_assessments")
    .insert({
      clinic_id: clinicId,
      created_by: createdBy,
      patient_id: input.patientId,
      type: input.type,
      payload_enc: encrypt(JSON.stringify(input.result)),
    })
    .select(COLS)
    .single();
  if (error) throw error;
  return mapRow(data as unknown as AssessmentRow);
}

/** Historial de escalas del paciente, cronológico (más antigua primero). */
export async function listAssessmentsForPatient(patientId: string): Promise<Assessment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("psychometric_assessments")
    .select(COLS)
    .eq("patient_id", patientId)
    .order("administered_at", { ascending: true });
  if (error) throw error;
  return (data as unknown as AssessmentRow[]).map(mapRow);
}

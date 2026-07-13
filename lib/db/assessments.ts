import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { encrypt, decrypt } from "@/lib/crypto";
import { isPhq9SelfHarmRisk, type AssessmentType, type AssessmentResult } from "@/lib/psychometrics";
import { logger } from "@/lib/logger";

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

/**
 * Igual que `createAssessment`, pero para el flujo de link público sin
 * sesión: usa el cliente service-role, sin `created_by` (nadie del personal
 * lo administró) y registrando `link_id` para trazabilidad.
 */
export async function createAssessmentViaLink(
  clinicId: string,
  input: { patientId: string; type: AssessmentType; result: AssessmentResult; linkId: string },
): Promise<Assessment> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("psychometric_assessments")
    .insert({
      clinic_id: clinicId,
      patient_id: input.patientId,
      link_id: input.linkId,
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

export interface Phq9RiskCandidate {
  assessmentId: string;
  patientId: string;
  patientName: string;
  date: string;
  type: AssessmentType;
  answers: number[];
}

export interface Phq9RiskAlert {
  assessmentId: string;
  patientId: string;
  patientName: string;
  date: string;
}

/** Función pura: de un conjunto de escalas ya descifradas, cuáles son de riesgo. */
export function selectPhq9RiskAlerts(rows: Phq9RiskCandidate[]): Phq9RiskAlert[] {
  return rows
    .filter((r) => isPhq9SelfHarmRisk(r.type, r.answers))
    .map((r) => ({
      assessmentId: r.assessmentId,
      patientId: r.patientId,
      patientName: r.patientName,
      date: r.date,
    }));
}

interface RiskRow {
  id: string;
  patient_id: string;
  payload_enc: string;
  administered_at: string;
  patients: { full_name_enc: string } | null;
}

/**
 * Escalas PHQ-9 completadas vía link público cuya respuesta indica riesgo,
 * para la sección "Alertas de riesgo" del dashboard. Igual que
 * `listRiskAlerts` (lib/db/reports.ts): calcula el riesgo al leer, sin
 * columna de estado persistida.
 */
export async function listPhq9RiskAlerts(limit = 50): Promise<Phq9RiskAlert[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("psychometric_assessments")
    .select(
      "id, patient_id, payload_enc, administered_at, " +
        "patients!psychometric_assessments_patient_id_fkey(full_name_enc)",
    )
    .eq("type", "phq9")
    .not("link_id", "is", null)
    .order("administered_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  const candidates: Phq9RiskCandidate[] = [];
  for (const row of data as unknown as RiskRow[]) {
    try {
      const result = JSON.parse(decrypt(row.payload_enc)) as AssessmentResult;
      candidates.push({
        assessmentId: row.id,
        patientId: row.patient_id,
        patientName: row.patients ? decrypt(row.patients.full_name_enc) : "(nombre no disponible)",
        date: row.administered_at,
        type: "phq9",
        answers: result.answers,
      });
    } catch (error) {
      logger.warn("phq9_risk_alert.payload_decrypt_failed", { assessmentId: row.id, error });
    }
  }
  return selectPhq9RiskAlerts(candidates);
}

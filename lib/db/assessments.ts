import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { encrypt, decrypt } from "@/lib/crypto";
import { sha256 } from "@/lib/consent";
import { isPhq9SelfHarmRisk } from "@/lib/psychometrics";
import type { AssessmentType, AssessmentResult } from "@/lib/psychometrics";
import type { LatestAssessment } from "@/lib/clinical-state";

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

/**
 * Busca la escala asociada a un link público por su token en claro. Se usa
 * desde la página de agradecimiento, donde el link ya puede estar marcado
 * como completado. Usa service-role porque es una ruta pública sin sesión.
 */
export async function getAssessmentByLinkToken(token: string): Promise<Assessment | null> {
  const admin = createAdminClient();
  const tokenHash = sha256(token);
  const { data, error } = await admin
    .from("patient_links")
    .select("psychometric_assessments(id, patient_id, type, payload_enc, administered_at)")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const assessments = (
    data as unknown as {
      psychometric_assessments: AssessmentRow[] | null;
    }
  ).psychometric_assessments;
  if (!assessments || assessments.length === 0) return null;
  return mapRow(assessments[0]);
}

/**
 * ¿El PHQ-9 cifrado marca autolesión? Lógica pura, testeable sin base de datos.
 *
 * Lanza si el payload no se puede leer (p. ej. tras rotar ENCRYPTION_KEY): un
 * PHQ-9 ilegible no es un PHQ-9 sin riesgo, y quien llama tiene que poder
 * distinguirlos para no descartar una alerta en silencio.
 */
export function isPhq9SelfHarmPayload(type: AssessmentType, payloadEnc: string): boolean {
  const result = JSON.parse(decrypt(payloadEnc)) as AssessmentResult;
  if (!Array.isArray(result.answers)) {
    throw new Error("Payload de escala sin respuestas");
  }
  return isPhq9SelfHarmRisk(type, result.answers);
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

/**
 * La puntuación más reciente de cada tipo de escala (PHQ-9/GAD-7) que tenga
 * el paciente — contexto compacto para el análisis de IA. Nunca se le pasa
 * el historial completo (ver spec §2: "el modelo ve resumen de estado ...
 * nunca N transcripciones/historiales").
 */
export async function getLatestAssessments(patientId: string): Promise<LatestAssessment[]> {
  const all = await listAssessmentsForPatient(patientId);
  const latestByType = new Map<AssessmentType, Assessment>();
  for (const a of all) latestByType.set(a.type, a); // ascendente → el último sobrescribe = más reciente
  return [...latestByType.values()].map((a) => ({
    type: a.type,
    totalScore: a.result.totalScore,
    severity: a.result.severity,
    administeredAt: a.administeredAt,
  }));
}

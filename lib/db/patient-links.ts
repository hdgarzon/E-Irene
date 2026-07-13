import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sha256 } from "@/lib/consent";
import { generatePatientLinkToken, patientLinkExpiryDate } from "@/lib/patient-links";
import type { AssessmentType } from "@/lib/psychometrics";

export type PatientLinkPurpose = "consent" | "assessment";

export interface PatientLink {
  id: string;
  clinicId: string;
  patientId: string;
  purpose: PatientLinkPurpose;
  assessmentType: AssessmentType | null;
  expiresAt: string;
  completedAt: string | null;
}

interface PatientLinkRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  purpose: PatientLinkPurpose;
  assessment_type: AssessmentType | null;
  expires_at: string;
  completed_at: string | null;
}

const COLS = "id, clinic_id, patient_id, purpose, assessment_type, expires_at, completed_at";

function mapRow(r: PatientLinkRow): PatientLink {
  return {
    id: r.id,
    clinicId: r.clinic_id,
    patientId: r.patient_id,
    purpose: r.purpose,
    assessmentType: r.assessment_type,
    expiresAt: r.expires_at,
    completedAt: r.completed_at,
  };
}

/**
 * Crea un link de paciente. Llamado por el personal de la clínica (sesión con
 * RLS). Devuelve el token en claro UNA sola vez — solo se persiste su hash.
 */
export async function createPatientLink(
  clinicId: string,
  createdBy: string,
  input: { patientId: string; purpose: PatientLinkPurpose; assessmentType: AssessmentType | null },
): Promise<{ link: PatientLink; token: string }> {
  const supabase = await createClient();
  const { token, tokenHash } = generatePatientLinkToken();
  const { data, error } = await supabase
    .from("patient_links")
    .insert({
      clinic_id: clinicId,
      patient_id: input.patientId,
      purpose: input.purpose,
      assessment_type: input.assessmentType,
      token_hash: tokenHash,
      expires_at: patientLinkExpiryDate().toISOString(),
      created_by: createdBy,
    })
    .select(COLS)
    .single();
  if (error) throw error;
  return { link: mapRow(data as unknown as PatientLinkRow), token };
}

export type PatientLinkLookup =
  | { status: "valid"; link: PatientLink }
  | { status: "not_found" }
  | { status: "expired" }
  | { status: "completed" };

/**
 * Valida un token recibido en una ruta pública (sin sesión). Usa el cliente
 * service-role porque no hay `auth.uid()` que satisfaga RLS en este flujo.
 */
export async function getPatientLinkByToken(token: string): Promise<PatientLinkLookup> {
  const admin = createAdminClient();
  const tokenHash = sha256(token);
  const { data, error } = await admin
    .from("patient_links")
    .select(COLS)
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { status: "not_found" };
  const link = mapRow(data as unknown as PatientLinkRow);
  if (link.completedAt) return { status: "completed" };
  if (new Date(link.expiresAt).getTime() < Date.now()) return { status: "expired" };
  return { status: "valid", link };
}

/** Marca un link como completado. Cliente service-role — solo se llama tras
 * escribir exitosamente el consentimiento/escala asociado. */
export async function markPatientLinkCompleted(id: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("patient_links")
    .update({ completed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

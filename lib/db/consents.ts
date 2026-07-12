import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptNullable, decryptNullable } from "@/lib/crypto";
import { CONSENT_VERSION } from "@/lib/consent";

export interface Consent {
  id: string;
  patientId: string;
  documentVersion: string;
  documentHash: string;
  signaturePath: string | null;
  signerName: string | null;
  ip: string | null;
  userAgent: string | null;
  signedAt: string;
  isMinor: boolean;
  representativeDocument: string | null;
  representativeRelationship: string | null;
}

interface ConsentRow {
  id: string;
  patient_id: string;
  document_version: string;
  document_hash: string;
  signature_path: string | null;
  signer_name: string | null;
  ip: string | null;
  user_agent: string | null;
  signed_at: string;
  is_minor: boolean;
  representative_document_enc: string | null;
  representative_relationship: string | null;
}

function mapRow(r: ConsentRow): Consent {
  return {
    id: r.id,
    patientId: r.patient_id,
    documentVersion: r.document_version,
    documentHash: r.document_hash,
    signaturePath: r.signature_path,
    signerName: r.signer_name,
    ip: r.ip,
    userAgent: r.user_agent,
    signedAt: r.signed_at,
    isMinor: r.is_minor,
    representativeDocument: decryptNullable(r.representative_document_enc),
    representativeRelationship: r.representative_relationship,
  };
}

/** Consentimiento vigente del paciente (versión actual), o null. */
export async function getActiveConsent(patientId: string): Promise<Consent | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("consents")
    .select("*")
    .eq("patient_id", patientId)
    .eq("document_version", CONSENT_VERSION)
    .order("signed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRow(data as ConsentRow) : null;
}

/**
 * Nº de pacientes de la clínica SIN consentimiento vigente (versión actual).
 * Se comparan solo ids (no PII): trae los ids de pacientes y los ids con
 * consentimiento vigente, y calcula la diferencia.
 */
export async function countPatientsWithoutConsent(): Promise<number> {
  const supabase = await createClient();
  const [patientsRes, consentsRes] = await Promise.all([
    supabase.from("patients").select("id"),
    supabase.from("consents").select("patient_id").eq("document_version", CONSENT_VERSION),
  ]);
  if (patientsRes.error) throw patientsRes.error;
  if (consentsRes.error) throw consentsRes.error;
  const consented = new Set((consentsRes.data ?? []).map((c) => c.patient_id));
  return (patientsRes.data ?? []).filter((p) => !consented.has(p.id)).length;
}

export async function createConsent(input: {
  clinicId: string;
  patientId: string;
  documentVersion: string;
  documentHash: string;
  signaturePath: string | null;
  signerName: string;
  ip: string | null;
  userAgent: string | null;
  isMinor: boolean;
  representativeDocument?: string | null;
  representativeRelationship?: string | null;
}): Promise<Consent> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("consents")
    .insert({
      clinic_id: input.clinicId,
      patient_id: input.patientId,
      document_version: input.documentVersion,
      document_hash: input.documentHash,
      signature_path: input.signaturePath,
      signer_name: input.signerName,
      ip: input.ip,
      user_agent: input.userAgent,
      is_minor: input.isMinor,
      representative_document_enc: encryptNullable(input.representativeDocument ?? null),
      representative_relationship: input.representativeRelationship ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return mapRow(data as ConsentRow);
}

/**
 * Igual que `createConsent`, pero para el flujo de link público sin sesión:
 * usa el cliente service-role (bypassa RLS). SOLO debe invocarse después de
 * revalidar el token en `patient_links` — nunca desde una ruta autenticada.
 */
export async function createConsentViaLink(input: {
  clinicId: string;
  patientId: string;
  linkId: string;
  documentVersion: string;
  documentHash: string;
  signaturePath: string | null;
  signerName: string;
  ip: string | null;
  userAgent: string | null;
  isMinor: boolean;
  representativeDocument?: string | null;
  representativeRelationship?: string | null;
}): Promise<Consent> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("consents")
    .insert({
      clinic_id: input.clinicId,
      patient_id: input.patientId,
      link_id: input.linkId,
      document_version: input.documentVersion,
      document_hash: input.documentHash,
      signature_path: input.signaturePath,
      signer_name: input.signerName,
      ip: input.ip,
      user_agent: input.userAgent,
      is_minor: input.isMinor,
      representative_document_enc: encryptNullable(input.representativeDocument ?? null),
      representative_relationship: input.representativeRelationship ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return mapRow(data as ConsentRow);
}

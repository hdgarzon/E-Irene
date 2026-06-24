import { createClient } from "@/lib/supabase/server";
import { encrypt, decrypt } from "@/lib/crypto";
import { reportSchema, type ReportPayload } from "@/lib/providers/types";

export interface Report {
  id: string;
  consultationId: string;
  patientId: string;
  payload: ReportPayload;
  doctorEdited: boolean;
  validatedAt: string | null;
  validatedBy: string | null;
  pdfPath: string | null;
  createdAt: string;
}

interface ReportRow {
  id: string;
  consultation_id: string;
  patient_id: string;
  payload_enc: string;
  doctor_edited: boolean;
  validated_at: string | null;
  validated_by: string | null;
  pdf_path: string | null;
  created_at: string;
}

function mapRow(r: ReportRow): Report {
  return {
    id: r.id,
    consultationId: r.consultation_id,
    patientId: r.patient_id,
    payload: reportSchema.parse(JSON.parse(decrypt(r.payload_enc))),
    doctorEdited: r.doctor_edited,
    validatedAt: r.validated_at,
    validatedBy: r.validated_by,
    pdfPath: r.pdf_path,
    createdAt: r.created_at,
  };
}

const COLS =
  "id, consultation_id, patient_id, payload_enc, doctor_edited, validated_at, validated_by, pdf_path, created_at";

export async function createReport(
  clinicId: string,
  input: { consultationId: string; patientId: string; payload: ReportPayload },
): Promise<Report> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reports")
    .insert({
      clinic_id: clinicId,
      consultation_id: input.consultationId,
      patient_id: input.patientId,
      payload_enc: encrypt(JSON.stringify(input.payload)),
    })
    .select(COLS)
    .single();
  if (error) throw error;
  return mapRow(data as ReportRow);
}

export async function getReportByConsultation(consultationId: string): Promise<Report | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reports")
    .select(COLS)
    .eq("consultation_id", consultationId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRow(data as ReportRow) : null;
}

export async function getReport(reportId: string): Promise<Report | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("reports").select(COLS).eq("id", reportId).maybeSingle();
  if (error) throw error;
  return data ? mapRow(data as ReportRow) : null;
}

/** El doctor edita la sugerencia preliminar; marca el reporte como editado. */
export async function updateSuggestion(reportId: string, suggestion: string): Promise<void> {
  const supabase = await createClient();
  const current = await getReport(reportId);
  if (!current) throw new Error("Reporte no encontrado");
  const payload: ReportPayload = { ...current.payload, suggestion };
  const { error } = await supabase
    .from("reports")
    .update({ payload_enc: encrypt(JSON.stringify(payload)), doctor_edited: true })
    .eq("id", reportId);
  if (error) throw error;
}

/** El doctor valida (firma) el reporte. */
export async function validateReport(reportId: string, userId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("reports")
    .update({ validated_by: userId, validated_at: new Date().toISOString() })
    .eq("id", reportId);
  if (error) throw error;
}

export async function setReportPdfPath(reportId: string, path: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("reports").update({ pdf_path: path }).eq("id", reportId);
  if (error) throw error;
}

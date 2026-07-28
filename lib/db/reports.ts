import { createClient } from "@/lib/supabase/server";
import { encrypt, decrypt } from "@/lib/crypto";
import { reportSchema, type AnalysisProvenance, type ReportPayload } from "@/lib/providers/types";

export interface Report {
  id: string;
  consultationId: string;
  patientId: string;
  payload: ReportPayload;
  doctorEdited: boolean;
  doctorNotes: string | null;
  validatedAt: string | null;
  validatedBy: string | null;
  pdfPath: string | null;
  createdAt: string;
  /**
   * Procedencia del análisis de IA. `null` en reportes generados antes de que
   * existiera trazabilidad — es un dato desconocido, no un dato ausente por
   * error, y no debe rellenarse con suposiciones.
   */
  provenance: AnalysisProvenance | null;
}

interface ReportRow {
  id: string;
  consultation_id: string;
  patient_id: string;
  payload_enc: string;
  doctor_edited: boolean;
  doctor_notes_enc: string | null;
  validated_at: string | null;
  validated_by: string | null;
  pdf_path: string | null;
  created_at: string;
  model: string | null;
  prompt_version: string | null;
  generated_at: string | null;
}

/**
 * La procedencia solo se considera conocida si las tres columnas están
 * presentes. Una fila a medias significa que algo escribió el reporte sin
 * pasar por `createReport` — mejor tratarla como desconocida que reportar una
 * trazabilidad parcial como si fuera completa.
 */
function mapProvenance(r: ReportRow): AnalysisProvenance | null {
  if (!r.model || !r.prompt_version || !r.generated_at) return null;
  return { model: r.model, promptVersion: r.prompt_version, generatedAt: r.generated_at };
}

function mapRow(r: ReportRow): Report {
  return {
    id: r.id,
    consultationId: r.consultation_id,
    patientId: r.patient_id,
    payload: reportSchema.parse(JSON.parse(decrypt(r.payload_enc))),
    doctorEdited: r.doctor_edited,
    doctorNotes: r.doctor_notes_enc ? decrypt(r.doctor_notes_enc) : null,
    validatedAt: r.validated_at,
    validatedBy: r.validated_by,
    pdfPath: r.pdf_path,
    createdAt: r.created_at,
    provenance: mapProvenance(r),
  };
}

const COLS =
  "id, consultation_id, patient_id, payload_enc, doctor_edited, doctor_notes_enc, validated_at, validated_by, pdf_path, created_at, model, prompt_version, generated_at";

export async function createReport(
  clinicId: string,
  input: {
    consultationId: string;
    patientId: string;
    payload: ReportPayload;
    provenance: AnalysisProvenance;
  },
): Promise<Report> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reports")
    .insert({
      clinic_id: clinicId,
      consultation_id: input.consultationId,
      patient_id: input.patientId,
      payload_enc: encrypt(JSON.stringify(input.payload)),
      model: input.provenance.model,
      prompt_version: input.provenance.promptVersion,
      generated_at: input.provenance.generatedAt,
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

export interface ReportListItem {
  id: string;
  consultationId: string;
  patientId: string;
  patientName: string;
  date: string;
  validated: boolean;
}

/**
 * Todos los reportes de la clínica del usuario (RLS scoped), más recientes
 * primero. A diferencia de otras lecturas de `reports`, esta lista NO
 * necesita descifrar `payload_enc` — ninguno de sus campos depende del
 * contenido clínico (a propósito: ver deprecación de sentiment/keywords en
 * la UI, spec §2.1). Por eso tampoco puede fallar por payload ilegible.
 */
export async function listReports(): Promise<ReportListItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reports")
    .select(
      "id, consultation_id, patient_id, validated_at, created_at, " +
        "patients!reports_patient_id_fkey(full_name_enc), " +
        "consultations!reports_consultation_id_fkey(started_at)",
    )
    .order("created_at", { ascending: false });
  if (error) throw error;

  const rows = data as unknown as {
    id: string;
    consultation_id: string;
    patient_id: string;
    validated_at: string | null;
    created_at: string;
    patients: { full_name_enc: string } | null;
    consultations: { started_at: string } | null;
  }[];

  return rows.map((r) => {
    let patientName = "(nombre no disponible)";
    if (r.patients?.full_name_enc) {
      try {
        patientName = decrypt(r.patients.full_name_enc);
      } catch {
        // se mantiene el placeholder
      }
    }
    return {
      id: r.id,
      consultationId: r.consultation_id,
      patientId: r.patient_id,
      patientName,
      date: r.consultations?.started_at ?? r.created_at,
      validated: Boolean(r.validated_at),
    };
  });
}

export interface PatientSessionReport {
  consultationId: string;
  date: string;
  payload: ReportPayload;
  doctorNotes: string | null;
  validatedAt: string | null;
}

/** Reportes del paciente (descifrados) con la fecha de su consulta, cronológico. */
export async function listReportsForPatient(patientId: string): Promise<PatientSessionReport[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reports")
    .select(
      "consultation_id, payload_enc, doctor_notes_enc, validated_at, created_at, " +
        "consultations!reports_consultation_id_fkey(started_at)",
    )
    .eq("patient_id", patientId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (
    data as unknown as {
      consultation_id: string;
      payload_enc: string;
      doctor_notes_enc: string | null;
      validated_at: string | null;
      created_at: string;
      consultations: { started_at: string } | null;
    }[]
  ).map((r) => ({
    consultationId: r.consultation_id,
    date: r.consultations?.started_at ?? r.created_at,
    payload: reportSchema.parse(JSON.parse(decrypt(r.payload_enc))),
    doctorNotes: r.doctor_notes_enc ? decrypt(r.doctor_notes_enc) : null,
    validatedAt: r.validated_at,
  }));
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

/**
 * Notas privadas del profesional sobre la sesión — texto libre, escrito por
 * el doctor (no generado por IA), parte de la historia clínica. Vacío borra
 * las notas.
 */
export async function updateDoctorNotes(reportId: string, notes: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("reports")
    .update({ doctor_notes_enc: notes ? encrypt(notes) : null })
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

/** Nº de reportes de la clínica aún sin validar (firma del profesional). */
export async function countPendingReports(): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("reports")
    .select("*", { count: "exact", head: true })
    .is("validated_at", null);
  if (error) throw error;
  return count ?? 0;
}

// La detección de alertas de riesgo derivada de `reports` se retiró en favor
// de `lib/db/risk-alerts.ts` — un canal propio hacia el doctor tratante, con
// acuse de recibo persistido, que no depende de que el reporte exista (ver
// spec §5 en docs/superpowers/specs/2026-07-24-copiloto-clinico-design.md).

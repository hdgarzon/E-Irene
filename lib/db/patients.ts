import { createClient } from "@/lib/supabase/server";
import { computeTrigrams, isSearchableQuery, patientSearchText } from "@/lib/search-index";
import { normalizeSearchText } from "@/lib/text-normalize";
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

export const PATIENTS_PAGE_SIZE = 30;
// Tope de candidatos que trae el filtro de trigramas antes del match exacto
// en la app. Acota cuánto se descifra por búsqueda — nunca toda la tabla —
// a costa de, en clínicas enormes con fragmentos muy comunes, no garantizar
// el 100% de los resultados verdaderos más allá de este límite.
const SEARCH_CANDIDATE_CAP = 300;

export interface PatientSearchResult {
  patients: Patient[];
  total: number;
  hasMore: boolean;
  /** true si el candidate cap pudo haber recortado resultados verdaderos. */
  truncated: boolean;
}

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

/**
 * Búsqueda paginada de pacientes, escalable sobre datos cifrados.
 *
 * Sin consulta (o consulta < MIN_QUERY_LENGTH): paginación real en BD vía
 * `.range()` — solo se descifra la página pedida, nunca la tabla completa.
 *
 * Con consulta: el blind index de trigramas (`search_trigrams`, ver
 * lib/search-index.ts) acota los candidatos en BD por overlap (`&&`); recién
 * sobre ese conjunto acotado (como mucho SEARCH_CANDIDATE_CAP filas) se
 * descifra y se aplica el match exacto por substring, igual que antes. La
 * paginación del resultado ya filtrado ocurre en memoria sobre ese conjunto
 * pequeño, no sobre la tabla.
 */
export async function searchPatients(params: {
  query: string;
  page: number;
}): Promise<PatientSearchResult> {
  const { query, page } = params;
  const supabase = await createClient();
  const offset = Math.max(0, page - 1) * PATIENTS_PAGE_SIZE;

  if (!isSearchableQuery(query)) {
    const { data, error, count } = await supabase
      .from("patients")
      .select(COLUMNS, { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + PATIENTS_PAGE_SIZE - 1);
    if (error) throw error;
    const patients = (data as unknown as PatientRow[])
      .map(tryDecryptPatient)
      .filter((p): p is Patient => p !== null);
    const total = count ?? patients.length;
    return { patients, total, hasMore: offset + PATIENTS_PAGE_SIZE < total, truncated: false };
  }

  const queryTrigrams = computeTrigrams(query);
  const { data, error } = await supabase
    .from("patients")
    .select(COLUMNS)
    .filter("search_trigrams", "ov", `{${queryTrigrams.join(",")}}`)
    .order("created_at", { ascending: false })
    .limit(SEARCH_CANDIDATE_CAP);
  if (error) throw error;

  const normalizedQuery = normalizeSearchText(query.trim());
  const matches = (data as unknown as PatientRow[])
    .map(tryDecryptPatient)
    .filter((p): p is Patient => p !== null)
    .filter((p) => normalizeSearchText(patientSearchText(p)).includes(normalizedQuery));

  const total = matches.length;
  const truncated = (data?.length ?? 0) >= SEARCH_CANDIDATE_CAP;
  const patients = matches.slice(offset, offset + PATIENTS_PAGE_SIZE);
  return { patients, total, hasMore: offset + PATIENTS_PAGE_SIZE < total, truncated };
}

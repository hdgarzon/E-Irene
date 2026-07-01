import { encrypt, decrypt, encryptNullable, decryptNullable } from "@/lib/crypto";

export interface PatientInput {
  fullName: string;
  document?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
  birthDate?: string | null;
  gender?: string | null;
}

export interface Patient extends PatientInput {
  id: string;
  createdAt: string;
}

/** Fila de la tabla `patients` (columnas sensibles cifradas). */
export interface PatientRow {
  id: string;
  full_name_enc: string;
  document_enc: string | null;
  phone_enc: string | null;
  email_enc: string | null;
  notes_enc: string | null;
  birth_date: string | null;
  gender: string | null;
  created_at: string;
}

/** Datos en claro → columnas cifradas listas para insertar/actualizar. */
export function encryptPatient(input: PatientInput) {
  return {
    full_name_enc: encrypt(input.fullName),
    document_enc: encryptNullable(input.document),
    phone_enc: encryptNullable(input.phone),
    email_enc: encryptNullable(input.email),
    notes_enc: encryptNullable(input.notes),
    birth_date: input.birthDate ?? null,
    gender: input.gender ?? null,
  };
}

/** Fila cifrada → datos en claro. */
export function decryptPatient(row: PatientRow): Patient {
  return {
    id: row.id,
    fullName: decrypt(row.full_name_enc),
    document: decryptNullable(row.document_enc),
    phone: decryptNullable(row.phone_enc),
    email: decryptNullable(row.email_enc),
    notes: decryptNullable(row.notes_enc),
    birthDate: row.birth_date,
    gender: row.gender,
    createdAt: row.created_at,
  };
}

/**
 * Descifra una fila; si falla (p. ej. datos cifrados con una ENCRYPTION_KEY
 * distinta a la actual, como puede pasar si la clave se rota sin migrar los
 * datos antiguos), se omite en vez de romper toda la página. Se registra en
 * los logs del servidor para poder investigar/limpiar el registro afectado.
 */
export function tryDecryptPatient(row: PatientRow): Patient | null {
  try {
    return decryptPatient(row);
  } catch (error) {
    console.error(`[patients] no se pudo descifrar el paciente ${row.id}:`, error);
    return null;
  }
}

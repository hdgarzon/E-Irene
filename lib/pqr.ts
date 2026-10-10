import { addBusinessDaysColombia } from "@/lib/dates";

/**
 * PQR del sitio (Términos de Uso, cláusula duodécima, numeral 3). Constantes y
 * etiquetas compartidas por el formulario público (cliente), la consola del
 * admin y la capa de datos (lib/db/pqr.ts).
 */
export const PQR_KINDS = ["peticion", "queja", "reclamo"] as const;
export type PqrKind = (typeof PQR_KINDS)[number];

export const PQR_STATUSES = ["radicada", "en_tramite", "respondida"] as const;
export type PqrStatus = (typeof PQR_STATUSES)[number];

export const PQR_KIND_LABEL: Record<PqrKind, string> = {
  peticion: "Petición",
  queja: "Queja",
  reclamo: "Reclamo",
};

export const PQR_STATUS_LABEL: Record<PqrStatus, string> = {
  radicada: "Radicada",
  en_tramite: "En trámite",
  respondida: "Respondida",
};

/** Plazo de respuesta de los Términos (cláusula duodécima, numeral 3). */
export const PQR_RESPONSE_BUSINESS_DAYS = 15;

/** Último día para responder una PQR presentada en `createdAt` (YYYY-MM-DD, Bogotá). */
export function pqrDueDate(createdAt: string): string {
  return addBusinessDaysColombia(createdAt, PQR_RESPONSE_BUSINESS_DAYS);
}

import { AVISO_PRIVACIDAD } from "./aviso-privacidad";
import { POLITICA_DATOS } from "./politica-datos";
import { TERMINOS_USO } from "./terminos-uso";
import { VINCULACION_PROFESIONAL } from "./vinculacion-profesional";
import type { LegalDocument } from "./types";

export { AVISO_PRIVACIDAD, POLITICA_DATOS, TERMINOS_USO, VINCULACION_PROFESIONAL };
export { CONSENTIMIENTO_PACIENTE } from "./consentimiento-paciente";
export * from "./types";
export * from "./urls";

/**
 * Documentos publicados en el sitio, cada uno con su página y su PDF. El
 * consentimiento del paciente no está: se presenta dentro del flujo de firma,
 * no como página pública.
 */
export const PUBLISHED_LEGAL_DOCUMENTS: readonly LegalDocument[] = [
  POLITICA_DATOS,
  AVISO_PRIVACIDAD,
  TERMINOS_USO,
  VINCULACION_PROFESIONAL,
];

export function findPublishedDocument(slug: string): LegalDocument | undefined {
  return PUBLISHED_LEGAL_DOCUMENTS.find((doc) => doc.slug === slug);
}

/** Ruta del PDF de un documento publicado. */
export function legalPdfPath(doc: LegalDocument): string {
  return `/documentos/${doc.slug}.pdf`;
}

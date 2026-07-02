-- ============================================================================
-- Consentimiento firmado por representante legal cuando el paciente es
-- menor de edad (Ley 1098 de 2006 — Código de la Infancia y la
-- Adolescencia; Ley 1581 de 2012 para datos de menores). signer_name ya
-- captura el nombre de quien firma (representante en este caso); se agrega
-- el documento del representante (cifrado, es PII) y su parentesco.
-- ============================================================================

alter table consents add column is_minor boolean not null default false;
alter table consents add column representative_document_enc text;
alter table consents add column representative_relationship text;

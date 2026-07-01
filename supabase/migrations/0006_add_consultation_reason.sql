-- ============================================================================
-- Motivo de consulta: por qué viene el paciente a esta sesión. Cifrado como
-- el resto de contenido clínico (transcript_enc, payload_enc, etc.).
-- ============================================================================

alter table consultations add column reason_enc text;

-- ============================================================================
-- Contacto de emergencia y antecedentes básicos del paciente. Cifrados como
-- el resto de PII/contenido clínico del paciente (full_name_enc, notes_enc).
-- ============================================================================

alter table patients add column emergency_contact_name_enc text;
alter table patients add column emergency_contact_phone_enc text;
alter table patients add column emergency_contact_relationship_enc text;
alter table patients add column history_enc text; -- antecedentes básicos: alergias, medicación, diagnósticos previos

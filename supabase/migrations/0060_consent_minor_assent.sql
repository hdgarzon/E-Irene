-- ============================================================================
-- Asentimiento del menor en el consentimiento informado.
--
-- El Consentimiento Informado del Paciente (cláusula octava) sigue el régimen de
-- autonomía progresiva de la Resolución 309 de 2025: desde los 14 años el
-- paciente firma por sí mismo; por debajo, firma el representante legal y el
-- profesional evalúa y registra el asentimiento del menor ("Asentimiento del
-- menor registrado en la historia clínica: Sí / No").
--
-- Null = no se registró: firmas anteriores a esta columna, firmas del propio
-- paciente, y firmas por enlace público (ahí no hay profesional que lo evalúe).
-- Aditiva: el código anterior la ignora.
-- ============================================================================

alter table consents add column minor_assent boolean;

comment on column consents.minor_assent is
  'Asentimiento del menor evaluado por el profesional (Res. 309 de 2025). Null = no registrado.';

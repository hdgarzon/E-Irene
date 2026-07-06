-- ============================================================================
-- Revoca el acceso del super-admin de plataforma a los PACIENTES.
--
-- La migración 0014 amplió las políticas RLS de `patients` con
-- `or is_platform_admin()`, lo que permitía al operador de plataforma leer y
-- editar la PII de pacientes de TODAS las clínicas (nombre, documento,
-- teléfono, contacto de emergencia). Eso contradice la promesa "sin PHI" y
-- el secreto profesional (Ley 1581 / Habeas Data): el nombre y el documento
-- de un paciente SON datos sensibles, aunque no sean "contenido clínico".
--
-- Aquí se revierten esas políticas a su forma original (0001_init.sql): el
-- acceso a pacientes queda EXCLUSIVAMENTE dentro de la clínica. La gestión de
-- pacientes la hace el admin de cada clínica, nunca el super-admin.
--
-- Los CONTEOS agregados de pacientes que ve el super-admin siguen funcionando:
-- provienen de get_platform_clinic_overview() (SECURITY DEFINER, solo count,
-- sin PII), no de leer las filas de `patients`.
-- ============================================================================

alter policy patients_select on patients
  using (clinic_id = auth_clinic_id());

alter policy patients_update on patients
  using (clinic_id = auth_clinic_id());

alter policy patients_delete on patients
  using (clinic_id = auth_clinic_id() and auth_role() in ('admin', 'doctor'));

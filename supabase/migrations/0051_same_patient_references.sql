-- ============================================================================
-- Con la sesión, una fila clínica y lo que referencia tienen que ser del mismo
-- paciente.
--
-- La 0048 exige que cada referencia apunte a un registro de la misma clínica,
-- no que sea coherente dentro de ella. Con su JWT y un POST o PATCH directo a
-- /rest/v1, el admin verificado de una clínica podía, solo con registros de su
-- clínica (comprobado en local, caso por caso):
--
-- 1. Colgar de la consulta de un paciente el reporte, la nota SOAP, el estado
--    clínico o el progreso de otro: al insertar, o cambiando patient_id o
--    consultation_id en un UPDATE.
-- 2. Abrir la consulta de un paciente con la cita o el consentimiento de otro,
--    o cambiarle el paciente a una consulta que ya tiene cita, consentimiento,
--    reporte o progreso del anterior.
-- 3. Registrar el recordatorio de la cita de un paciente a nombre de otro.
-- 4. Cambiar el paciente de una cita que ya tiene consultas o recordatorios.
--    Esto lo hace también la app: el formulario de edición deja elegir otro
--    paciente y updateAppointment lo guarda tal cual.
--
-- Regla, con sesión:
--
-- a) Lo que la fila referencia (consulta, cita, consentimiento) tiene que ser
--    de su mismo patient_id. En un INSERT se comprueba siempre; en un UPDATE,
--    cuando cambian la referencia, patient_id o clinic_id.
-- b) Una consulta o una cita no cambia de patient_id si hay filas que la
--    referencian con otro paciente: reportes, notas SOAP, estado clínico,
--    progreso y alertas de riesgo de la consulta; consultas y notificaciones de
--    la cita. La consulta ocurrió con ese paciente y el recordatorio le llegó a
--    él, con el enlace /join de la cita, que solo valida el token. Una cita mal
--    asignada se cancela y se crea otra.
--
-- notifications.patient_id admite nulo: una notificación sin paciente no se
-- compara.
--
-- Escritores actuales: con la sesión todos pasan ids coherentes. createReport y
-- appendClinicalState toman el paciente de la consulta leída; las dos acciones
-- que abren consultas toman paciente, cita y consentimiento de la misma cita o
-- del mismo paciente; los recordatorios usan el paciente de la cita, y la nota
-- SOAP, el de la consulta que muestra la página. Ninguno cambia el paciente de
-- una consulta. El único cambio de comportamiento es el punto 4, que es justo
-- lo que se cierra: con el código anterior esa edición devuelve "No se pudo
-- actualizar la cita" durante el despliegue, y el nuevo explica por qué.
--
-- service-role y los jobs (auth.uid() nulo) no pasan por este control, igual
-- que en la 0044, la 0047 y la 0048.
--
-- Los triggers se llaman trg_<tabla>_patient_*: Postgres los dispara por orden
-- de nombre, así que corren después de trg_<tabla>_clinic_references (0048) y
-- una referencia de otra clínica da el error de la 0048. Por si ese orden
-- cambia, la búsqueda del paciente se limita a la clínica de la fila: el error
-- no dice nada de registros ajenos.
--
-- Una FK nueva hacia consultations o appointments desde una tabla con
-- patient_id tiene que sumarse a los triggers de esta migración.
--
-- SECURITY DEFINER por la misma razón que la 0048: RLS no debe ocultar la fila
-- que se compara. Las tablas van calificadas con public porque sus nombres
-- entran en SQL dinámico.
-- ============================================================================

/**
 * Punto a). Argumentos del trigger: una entrada 'columna:tabla' por referencia,
 * p. ej. 'consultation_id:consultations'. La tabla referenciada tiene que tener
 * id, clinic_id y patient_id.
 */
create or replace function enforce_same_patient_references()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  v_reference text;
  v_column text;
  v_table text;
  v_value text;
  v_patient_id uuid;
begin
  -- service-role / jobs: la autorización ya se hizo en la capa de aplicación.
  if auth.uid() is null then
    return new;
  end if;

  if v_new ->> 'patient_id' is null then
    return new;
  end if;

  foreach v_reference in array tg_argv loop
    v_column := split_part(v_reference, ':', 1);
    v_table := split_part(v_reference, ':', 2);
    v_value := v_new ->> v_column;

    continue when v_value is null;
    continue when tg_op = 'UPDATE'
      and v_value is not distinct from v_old ->> v_column
      and v_new ->> 'patient_id' is not distinct from v_old ->> 'patient_id'
      and v_new ->> 'clinic_id' is not distinct from v_old ->> 'clinic_id';

    execute format('select patient_id from public.%I where id = $1 and clinic_id = $2', v_table)
      into v_patient_id
      using v_value::uuid, (v_new ->> 'clinic_id')::uuid;

    if v_patient_id is distinct from (v_new ->> 'patient_id')::uuid then
      raise exception '%.% tiene que apuntar a un registro del mismo paciente', tg_table_name, v_column;
    end if;
  end loop;

  return new;
end $$;


/**
 * Punto b). Argumentos del trigger: una entrada 'tabla.columna' por cada FK que
 * apunta a esta tabla desde una tabla con patient_id, p. ej.
 * 'reports.consultation_id'. Solo se dispara cuando cambia patient_id.
 */
create or replace function enforce_same_patient_dependents()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_dependent text;
  v_table text;
  v_column text;
  v_conflict boolean;
begin
  -- service-role / jobs: la autorización ya se hizo en la capa de aplicación.
  if auth.uid() is null then
    return new;
  end if;

  foreach v_dependent in array tg_argv loop
    v_table := split_part(v_dependent, '.', 1);
    v_column := split_part(v_dependent, '.', 2);

    execute format('select exists (select 1 from public.%I where %I = $1 and patient_id <> $2)', v_table, v_column)
      into v_conflict
      using new.id, new.patient_id;

    if v_conflict then
      raise exception '%.patient_id tiene que coincidir con el de sus registros en %', tg_table_name, v_table;
    end if;
  end loop;

  return new;
end $$;


drop trigger if exists trg_consultations_patient_references on consultations;
create trigger trg_consultations_patient_references
  before insert or update on consultations
  for each row execute function enforce_same_patient_references(
    'appointment_id:appointments', 'consent_id:consents');

drop trigger if exists trg_consultations_patient_dependents on consultations;
create trigger trg_consultations_patient_dependents
  before update on consultations
  for each row when (old.patient_id is distinct from new.patient_id)
  execute function enforce_same_patient_dependents(
    'reports.consultation_id', 'soap_notes.consultation_id', 'patient_clinical_state.consultation_id',
    'patient_progress.consultation_id', 'risk_alerts.consultation_id');

drop trigger if exists trg_appointments_patient_dependents on appointments;
create trigger trg_appointments_patient_dependents
  before update on appointments
  for each row when (old.patient_id is distinct from new.patient_id)
  execute function enforce_same_patient_dependents(
    'consultations.appointment_id', 'notifications.appointment_id');

drop trigger if exists trg_reports_patient_references on reports;
create trigger trg_reports_patient_references
  before insert or update on reports
  for each row execute function enforce_same_patient_references('consultation_id:consultations');

drop trigger if exists trg_soap_notes_patient_references on soap_notes;
create trigger trg_soap_notes_patient_references
  before insert or update on soap_notes
  for each row execute function enforce_same_patient_references('consultation_id:consultations');

drop trigger if exists trg_patient_clinical_state_patient_references on patient_clinical_state;
create trigger trg_patient_clinical_state_patient_references
  before insert or update on patient_clinical_state
  for each row execute function enforce_same_patient_references('consultation_id:consultations');

drop trigger if exists trg_patient_progress_patient_references on patient_progress;
create trigger trg_patient_progress_patient_references
  before insert or update on patient_progress
  for each row execute function enforce_same_patient_references('consultation_id:consultations');

drop trigger if exists trg_notifications_patient_references on notifications;
create trigger trg_notifications_patient_references
  before insert or update on notifications
  for each row execute function enforce_same_patient_references('appointment_id:appointments');

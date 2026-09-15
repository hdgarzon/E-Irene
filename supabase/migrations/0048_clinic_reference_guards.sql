-- ============================================================================
-- Con la sesión, lo que una fila clínica referencia tiene que ser de su misma
-- clínica.
--
-- Las políticas de escritura de estas tablas solo miran clinic_id (y
-- consults_insert, además, la verificación de la 0032). Las FK solo exigen que
-- la fila referenciada exista, sea de la clínica que sea. Con su JWT y un POST
-- o PATCH directo a /rest/v1, el admin verificado de una clínica podía
-- (comprobado en local, tabla por tabla):
--
-- 1. Abrir en su clínica una consulta o una cita con el paciente o el
--    profesional de otra clínica, o colgarla de una cita o un consentimiento
--    ajenos. La 0047 exige que una alerta de riesgo coincida con el paciente y
--    el doctor de su consulta: eso solo protege si la consulta es coherente.
-- 2. Lo mismo con un UPDATE sobre filas propias: consults_update, appts_update
--    y las demás políticas de UPDATE no miran las referencias.
-- 3. Colgar de registros ajenos reportes, notas SOAP, fragmentos de
--    transcripción, estado clínico, progreso, escalas, planes y sus ítems,
--    enlaces, consentimientos y notificaciones; atribuirlos (created_by,
--    validated_by) a usuarios de otra clínica, o vincular uno a la propia en
--    clinic_doctors.
--
-- Ni siquiera hace falta la API: las Server Actions pasan tal cual los ids que
-- reciben del cliente (createAppointmentAction toma patientId y doctorId del
-- formulario y solo valida que sean UUID).
--
-- Regla: con sesión, cada referencia no nula tiene que apuntar a una fila de la
-- misma clinic_id. En un INSERT se comprueban todas; en un UPDATE, las que
-- cambian, o todas si cambia clinic_id. Los updates que no tocan referencias
-- (cerrar la consulta, cambiar el estado de la cita, reprogramarla desde la
-- consola del admin de plataforma, que actúa sobre citas de cualquier clínica)
-- no hacen la consulta extra ni dependen de que las filas antiguas sean
-- coherentes. Una referencia inexistente da el mismo error que una ajena, para
-- no delatar si el id existe en otra clínica.
--
-- Escritores actuales, sin cambios de código: con la sesión, todos usan
-- registros de la propia clínica —leídos con RLS o elegidos de sus listas— y el
-- usuario de la sesión como created_by y validated_by; create_clinic_and_admin
-- vincula en clinic_doctors al propio usuario con la clínica que acaba de crear.
-- Como el código no cambia, migrar antes de promover no abre ninguna ventana.
--
-- service-role y los jobs (auth.uid() nulo) no pasan por este control, igual
-- que en la 0044 y la 0047: addMember, el enlace público del paciente, la
-- conciliación de PHQ-9 y las purgas siguen igual. risk_alerts queda fuera: sus
-- escrituras con sesión las acotan la 0046 y la 0047.
--
-- Una FK nueva hacia una tabla con clinic_id tiene que sumarse al trigger de su
-- tabla.
--
-- SECURITY DEFINER para ver la fila referenciada aunque sea de otra clínica:
-- con los permisos de la sesión RLS la ocultaría, y la FK la acepta igual. La
-- tabla va calificada con public porque su nombre entra en SQL dinámico.
-- ============================================================================

/**
 * Argumentos del trigger: una entrada 'columna:tabla' por referencia, p. ej.
 * 'patient_id:patients'. La tabla referenciada tiene que tener id y clinic_id.
 */
create or replace function enforce_same_clinic_references()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  v_reference text;
  v_column text;
  v_table text;
  v_value text;
  v_clinic_id uuid;
begin
  -- service-role / jobs: la autorización ya se hizo en la capa de aplicación.
  if auth.uid() is null then
    return new;
  end if;

  foreach v_reference in array tg_argv loop
    v_column := split_part(v_reference, ':', 1);
    v_table := split_part(v_reference, ':', 2);
    v_value := v_new ->> v_column;

    continue when v_value is null;
    continue when tg_op = 'UPDATE'
      and v_value is not distinct from v_old ->> v_column
      and v_new ->> 'clinic_id' is not distinct from v_old ->> 'clinic_id';

    execute format('select clinic_id from public.%I where id = $1', v_table)
      into v_clinic_id
      using v_value::uuid;

    if v_clinic_id is distinct from (v_new ->> 'clinic_id')::uuid then
      raise exception '%.% tiene que apuntar a un registro de la misma clínica', tg_table_name, v_column;
    end if;
  end loop;

  return new;
end $$;


drop trigger if exists trg_patients_clinic_references on patients;
create trigger trg_patients_clinic_references
  before insert or update on patients
  for each row execute function enforce_same_clinic_references('created_by:users');

drop trigger if exists trg_appointments_clinic_references on appointments;
create trigger trg_appointments_clinic_references
  before insert or update on appointments
  for each row execute function enforce_same_clinic_references(
    'patient_id:patients', 'doctor_id:users');

drop trigger if exists trg_consents_clinic_references on consents;
create trigger trg_consents_clinic_references
  before insert or update on consents
  for each row execute function enforce_same_clinic_references(
    'patient_id:patients', 'link_id:patient_links');

drop trigger if exists trg_consultations_clinic_references on consultations;
create trigger trg_consultations_clinic_references
  before insert or update on consultations
  for each row execute function enforce_same_clinic_references(
    'patient_id:patients', 'doctor_id:users', 'appointment_id:appointments', 'consent_id:consents');

drop trigger if exists trg_transcript_chunks_clinic_references on transcript_chunks;
create trigger trg_transcript_chunks_clinic_references
  before insert or update on transcript_chunks
  for each row execute function enforce_same_clinic_references('consultation_id:consultations');

drop trigger if exists trg_reports_clinic_references on reports;
create trigger trg_reports_clinic_references
  before insert or update on reports
  for each row execute function enforce_same_clinic_references(
    'consultation_id:consultations', 'patient_id:patients', 'validated_by:users');

drop trigger if exists trg_patient_progress_clinic_references on patient_progress;
create trigger trg_patient_progress_clinic_references
  before insert or update on patient_progress
  for each row execute function enforce_same_clinic_references(
    'patient_id:patients', 'consultation_id:consultations');

drop trigger if exists trg_notifications_clinic_references on notifications;
create trigger trg_notifications_clinic_references
  before insert or update on notifications
  for each row execute function enforce_same_clinic_references(
    'patient_id:patients', 'appointment_id:appointments');

drop trigger if exists trg_clinic_doctors_clinic_references on clinic_doctors;
create trigger trg_clinic_doctors_clinic_references
  before insert or update on clinic_doctors
  for each row execute function enforce_same_clinic_references('doctor_id:users');

drop trigger if exists trg_psychometric_assessments_clinic_references on psychometric_assessments;
create trigger trg_psychometric_assessments_clinic_references
  before insert or update on psychometric_assessments
  for each row execute function enforce_same_clinic_references(
    'patient_id:patients', 'created_by:users', 'link_id:patient_links');

drop trigger if exists trg_treatment_plans_clinic_references on treatment_plans;
create trigger trg_treatment_plans_clinic_references
  before insert or update on treatment_plans
  for each row execute function enforce_same_clinic_references(
    'patient_id:patients', 'created_by:users');

drop trigger if exists trg_treatment_plan_items_clinic_references on treatment_plan_items;
create trigger trg_treatment_plan_items_clinic_references
  before insert or update on treatment_plan_items
  for each row execute function enforce_same_clinic_references('plan_id:treatment_plans');

drop trigger if exists trg_soap_notes_clinic_references on soap_notes;
create trigger trg_soap_notes_clinic_references
  before insert or update on soap_notes
  for each row execute function enforce_same_clinic_references(
    'consultation_id:consultations', 'patient_id:patients', 'created_by:users');

drop trigger if exists trg_patient_links_clinic_references on patient_links;
create trigger trg_patient_links_clinic_references
  before insert or update on patient_links
  for each row execute function enforce_same_clinic_references(
    'patient_id:patients', 'created_by:users');

drop trigger if exists trg_patient_clinical_state_clinic_references on patient_clinical_state;
create trigger trg_patient_clinical_state_clinic_references
  before insert or update on patient_clinical_state
  for each row execute function enforce_same_clinic_references(
    'patient_id:patients', 'consultation_id:consultations');

-- ============================================================================
-- Eliminación de la cuenta de una clínica, con 30 días para exportar o desistir.
--
-- Consentimiento y Términos de Vinculación del Profesional, cláusula séptima,
-- numeral 5: el Profesional puede solicitar la eliminación de su cuenta; durante
-- los 30 días calendario siguientes puede exportar su información o desistir, y
-- vencido ese plazo E-Irene suprime de forma definitiva los datos de la cuenta y
-- de sus pacientes, salvo los de identificación, auditoría y facturación que
-- deba conservar por los plazos de la sección 5 de la Política de Tratamiento.
--
-- Qué se suprime: los pacientes y, en cascada, toda su información clínica
-- (consentimientos, citas, consultas, transcripciones, reportes, notas SOAP,
-- evaluaciones, alertas de riesgo, planes de tratamiento, estado clínico,
-- enlaces). Los archivos de Storage (firmas, documentos de verificación) los
-- borra la aplicación antes de llamar a execute_account_deletion: desde SQL
-- quedarían huérfanos (ver app/api/cron/purge-documents).
--
-- Qué se conserva: la clínica y sus usuarios (identificación), audit_logs
-- (auditoría), las tablas billing_*, el consumo de transcripción y el libro de
-- videollamadas (facturación), y las aceptaciones de la política (prueba).
--
-- Quién: solo el admin de la clínica pide y desiste. La ejecución la hace el
-- cron diario con service-role, nunca un usuario.
-- ============================================================================

alter table clinics add column deleted_at timestamptz;

comment on column clinics.deleted_at is
  'Cuándo se ejecutó la eliminación de la cuenta (0062). La fila se conserva como dato de identificación.';

create table account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  requested_by uuid not null references users(id),
  requested_at timestamptz not null default now(),
  scheduled_for timestamptz not null,
  cancelled_at timestamptz,
  cancelled_by uuid references users(id),
  executed_at timestamptz,
  constraint account_deletion_closed_once check (cancelled_at is null or executed_at is null)
);

-- Una sola solicitud abierta por clínica.
create unique index account_deletion_one_open
  on account_deletion_requests (clinic_id)
  where cancelled_at is null and executed_at is null;

create index account_deletion_due_idx
  on account_deletion_requests (scheduled_for)
  where cancelled_at is null and executed_at is null;

alter table account_deletion_requests enable row level security;

-- La clínica ve sus solicitudes (para mostrar el plazo y el botón de desistir).
-- Las escrituras van solo por las funciones de abajo.
create policy account_deletion_select on account_deletion_requests for select
  using (clinic_id = auth_clinic_id() or is_platform_admin());

/** Días que tiene la clínica para exportar o desistir (cláusula séptima, numeral 5). */
create or replace function account_deletion_grace() returns interval
language sql immutable as $$ select interval '30 days' $$;

/**
 * El admin de la clínica pide eliminar la cuenta. Devuelve la solicitud abierta
 * (la nueva, o la que ya existía). Si la suscripción tiene un medio de pago
 * guardado, se cancela su renovación: no debe haber cobros durante el plazo.
 */
create or replace function request_account_deletion()
returns account_deletion_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic clinics%rowtype;
  v_request account_deletion_requests%rowtype;
begin
  if auth_role() is distinct from 'admin' then
    raise exception 'No autorizado';
  end if;

  select * into v_clinic from clinics where id = auth_clinic_id() for update;
  if not found or v_clinic.deleted_at is not null then
    raise exception 'No autorizado';
  end if;

  select * into v_request from account_deletion_requests
  where clinic_id = v_clinic.id and cancelled_at is null and executed_at is null;
  if found then
    return v_request;
  end if;

  insert into account_deletion_requests (clinic_id, requested_by, scheduled_for)
  values (v_clinic.id, auth.uid(), now() + account_deletion_grace())
  returning * into v_request;

  if v_clinic.plan <> 'free'
     and v_clinic.wompi_payment_source_id_enc is not null
     and not v_clinic.cancel_at_period_end then
    perform request_subscription_cancellation();
  end if;

  insert into audit_logs (clinic_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_clinic.id, auth.uid(), 'account.deletion_requested', 'account_deletion_requests', v_request.id,
          jsonb_build_object('scheduled_for', v_request.scheduled_for));

  return v_request;
end;
$$;

/** El admin desiste dentro del plazo. Devuelve true si había una solicitud abierta y vigente. */
create or replace function cancel_account_deletion()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request account_deletion_requests%rowtype;
begin
  if auth_role() is distinct from 'admin' then
    raise exception 'No autorizado';
  end if;

  -- Solo dentro del plazo: vencido, el cron ya puede estar borrando archivos y
  -- un desistimiento a mitad de camino dejaría la cuenta a medias.
  update account_deletion_requests
  set cancelled_at = now(), cancelled_by = auth.uid()
  where clinic_id = auth_clinic_id() and cancelled_at is null and executed_at is null
    and scheduled_for > now()
  returning * into v_request;
  if not found then
    return false;
  end if;

  insert into audit_logs (clinic_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_request.clinic_id, auth.uid(), 'account.deletion_cancelled', 'account_deletion_requests',
          v_request.id, jsonb_build_object('scheduled_for', v_request.scheduled_for));
  return true;
end;
$$;

-- El estado clínico es inmutable (0024): ni el profesional ni un admin lo
-- reescriben. La única excepción es la supresión que ordena la cláusula séptima,
-- y se habilita solo dentro de la transacción de execute_account_deletion.
create or replace function block_clinical_state_mutation()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and current_setting('e_irene.account_deletion', true) = 'on' then
    return old;
  end if;
  raise exception 'patient_clinical_state es inmutable: UPDATE/DELETE no permitido';
end; $$;

/**
 * Ejecuta una solicitud vencida: suprime los pacientes de la clínica (y en
 * cascada su información clínica), termina la suscripción, marca la clínica
 * como eliminada y suspendida, y deja constancia en audit_logs. Solo
 * service-role (cron). Devuelve cuántos pacientes suprimió, o null si la
 * solicitud no estaba abierta o aún no vencía.
 */
create or replace function execute_account_deletion(p_request uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request account_deletion_requests%rowtype;
  v_patients integer;
begin
  select * into v_request from account_deletion_requests
  where id = p_request for update;
  if not found
     or v_request.cancelled_at is not null
     or v_request.executed_at is not null
     or v_request.scheduled_for > now() then
    return null;
  end if;

  perform set_config('e_irene.account_deletion', 'on', true);

  delete from patients where clinic_id = v_request.clinic_id;
  get diagnostics v_patients = row_count;

  -- Lo que cuelga de la clínica y no del paciente, y no es facturación ni
  -- auditoría.
  delete from notifications where clinic_id = v_request.clinic_id;

  perform set_config('e_irene.account_deletion', 'off', true);

  -- Los documentos de verificación ya se borraron de Storage (la aplicación lo
  -- hace antes de llamar aquí): las rutas no deben quedar apuntando a la nada.
  update users
  set id_document_path = null,
      license_document_path = null,
      documents_purged_at = coalesce(documents_purged_at, now())
  where clinic_id = v_request.clinic_id
    and (id_document_path is not null or license_document_path is not null);

  perform end_subscription(v_request.clinic_id, 'cuenta_eliminada');

  update clinics
  set deleted_at = now(),
      suspended_at = coalesce(suspended_at, now())
  where id = v_request.clinic_id;

  update account_deletion_requests set executed_at = now() where id = v_request.id;

  insert into audit_logs (clinic_id, action, entity_type, entity_id, metadata)
  values (v_request.clinic_id, 'account.deleted', 'account_deletion_requests', v_request.id,
          jsonb_build_object('patients_deleted', v_patients, 'requested_at', v_request.requested_at));

  return v_patients;
end;
$$;

revoke all on function account_deletion_grace() from public, anon;
revoke all on function request_account_deletion() from public, anon;
revoke all on function cancel_account_deletion() from public, anon;
revoke all on function execute_account_deletion(uuid) from public, anon, authenticated;

grant execute on function account_deletion_grace() to authenticated, service_role;
grant execute on function request_account_deletion() to authenticated;
grant execute on function cancel_account_deletion() to authenticated;
-- Explícito por lo mismo que 0038/0041: un stack recién provisionado no
-- siempre replica los privilegios por defecto de Supabase Cloud.
grant execute on function execute_account_deletion(uuid) to service_role;

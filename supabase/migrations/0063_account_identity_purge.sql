-- ============================================================================
-- Supresión de los datos de identificación de una cuenta eliminada, 2 años
-- después de la eliminación.
--
-- La Política de Tratamiento (sección 5) fija para la "Cuenta del profesional"
-- el plazo "mientras esté vigente la relación, más 2 años" (ejecución del
-- contrato y términos de prescripción). La eliminación de la cuenta (0062)
-- termina la relación y conserva la identificación; esta migración la suprime
-- cuando vence ese plazo.
--
-- Qué se suprime: los datos personales de los usuarios de la clínica (nombre,
-- correo, documento, tarjeta profesional, notas y huellas de los documentos de
-- verificación) y sus aceptaciones de la política. La aplicación borra después
-- sus cuentas de acceso (auth.users), que arrastran las filas de `users`.
--
-- Qué se conserva: la fila de la clínica y las tablas de facturación, que tienen
-- su propio plazo de 10 años (Código de Comercio, arts. 28 y 60), y audit_logs
-- (10 años), que solo guarda identificadores, no datos personales.
-- ============================================================================

alter table clinics add column identity_purged_at timestamptz;

comment on column clinics.identity_purged_at is
  'Cuándo se suprimieron los datos de identificación de sus usuarios (0063), 2 años después de deleted_at.';

-- Las solicitudes de eliminación sobreviven a los usuarios que las firmaron:
-- borrarlos no debe estar bloqueado por ellas.
alter table account_deletion_requests alter column requested_by drop not null;
alter table account_deletion_requests drop constraint account_deletion_requests_requested_by_fkey;
alter table account_deletion_requests drop constraint account_deletion_requests_cancelled_by_fkey;
alter table account_deletion_requests
  add constraint account_deletion_requests_requested_by_fkey
  foreign key (requested_by) references users(id) on delete set null;
alter table account_deletion_requests
  add constraint account_deletion_requests_cancelled_by_fkey
  foreign key (cancelled_by) references users(id) on delete set null;

/** Plazo de la Política para la cuenta del profesional tras terminar la relación. */
create or replace function account_identity_retention() returns interval
language sql immutable as $$ select interval '2 years' $$;

-- policy_acceptances es inmutable (0035): es prueba. La única excepción es esta
-- supresión, cuando la cuenta ya no existe ni se tratan sus datos, y se habilita
-- solo dentro de la transacción de purge_deleted_account_identity.
create or replace function block_policy_acceptance_mutation()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' and current_setting('e_irene.identity_purge', true) = 'on' then
    return old;
  end if;
  raise exception 'policy_acceptances es inmutable: UPDATE/DELETE no permitido';
end; $$;

/**
 * Suprime la identificación de una clínica eliminada hace más de 2 años y
 * devuelve los usuarios cuyas cuentas de acceso debe borrar la aplicación (sin
 * los admins de plataforma). Idempotente: si ya se suprimió, solo devuelve los
 * usuarios que queden, para que un borrado de auth.users que falló se reintente.
 * Solo service-role (cron).
 */
create or replace function purge_deleted_account_identity(p_clinic uuid)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic clinics%rowtype;
  v_users integer;
begin
  select * into v_clinic from clinics where id = p_clinic for update;
  if not found
     or v_clinic.deleted_at is null
     or v_clinic.deleted_at > now() - account_identity_retention() then
    return array[]::uuid[];
  end if;

  if v_clinic.identity_purged_at is null then
    perform set_config('e_irene.identity_purge', 'on', true);
    delete from policy_acceptances where clinic_id = p_clinic;
    perform set_config('e_irene.identity_purge', 'off', true);

    update users
    set full_name = 'Usuario eliminado',
        email = id::text || '@eliminado.invalid',
        license_number = null,
        profession = null,
        document_enc = null,
        verification_notes = null,
        id_document_hash = null,
        license_document_hash = null,
        id_document_path = null,
        license_document_path = null
    where clinic_id = p_clinic
      and id not in (select user_id from platform_admins);
    get diagnostics v_users = row_count;

    update clinics set identity_purged_at = now() where id = p_clinic;

    insert into audit_logs (clinic_id, action, entity_type, entity_id, metadata)
    values (p_clinic, 'account.identity_purged', 'clinic', p_clinic,
            jsonb_build_object('users', v_users, 'deleted_at', v_clinic.deleted_at));
  end if;

  return coalesce(
    (select array_agg(u.id) from users u
     where u.clinic_id = p_clinic and u.id not in (select user_id from platform_admins)),
    array[]::uuid[]
  );
end;
$$;

revoke all on function account_identity_retention() from public, anon;
revoke all on function purge_deleted_account_identity(uuid) from public, anon, authenticated;
grant execute on function account_identity_retention() to service_role;
grant execute on function purge_deleted_account_identity(uuid) to service_role;

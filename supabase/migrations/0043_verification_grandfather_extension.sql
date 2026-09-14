-- ============================================================================
-- Prórroga del plazo de las verificaciones heredadas: del 18-sep al 18-oct-2026.
--
-- POR QUÉ SE CORRE (decisión del 14-sep-2026)
--   A cuatro días del plazo de la 0040 seguían las 11 cuentas profesionales
--   heredadas sin un solo documento. No tenían cómo cumplir:
--   · Su estado es 'verified', y /verificacion solo muestra el formulario de
--     documentos desde pending_documents, rejected o suspended. La acción del
--     servidor y el trigger de esta tabla también rechazaban su envío.
--   · El aviso de verificación no se muestra a cuentas verificadas y el correo
--     no está configurado en producción: nadie les avisó del plazo.
--   Hacer cumplir la fecha así habría cortado de golpe la creación de pacientes
--   y consultas —4 de las 11 ya atendían al 19-ago— por un camino que la
--   plataforma nunca les ofreció.
--
-- QUÉ SE HIZO JUNTO CON LA PRÓRROGA
--   · La app deja a las cuentas heredadas subir cédula y tarjeta profesional
--     sin perder acceso, les avisa la fecha límite, y el admin de plataforma
--     confirma la habilitación de forma retroactiva
--     (lib/db/legacy-verification.ts).
--   · Ese envío deja la decisión en blanco y reinicia la purga. El backfill de
--     la 0032 fechó la "decisión" de estas cuentas en su created_at, así que la
--     purga de 30 días (lib/db/verification-documents.ts) habría borrado los
--     documentos al día siguiente de subirlos, antes de revisarlos.
--   · El trigger de verificación deja de permitir que la sesión del usuario
--     reescriba la nota, las rutas o las huellas de los documentos, o la marca
--     de purga. Con un PATCH directo, una cuenta heredada podía borrar su nota o
--     poner rutas inventadas y quedar fuera del barrido sin aportar nada. Esos
--     campos solo cambian ahora con un envío a revisión válido o desde el
--     servidor (service-role).
--
-- LO QUE NO CAMBIA
--   El mecanismo de la 0040: cumplido el plazo, las cuentas heredadas sin
--   documentos vuelven a pending_documents. Si esta fecha tampoco alcanza, se
--   vuelve a correr con otra migración, que deja constancia.
-- ============================================================================


/**
 * Plazo vigente para que las cuentas heredadas aporten documentos. Única
 * fuente: el barrido lo toma por defecto y lib/verification.ts lo muestra
 * (LEGACY_VERIFICATION_DEADLINE); tests/verification-grandfather.test.ts
 * compara los dos. Una próxima prórroga solo cambia esta función.
 */
create or replace function grandfather_verification_deadline()
returns timestamptz
language sql immutable
set search_path = public
as $$
  -- 18 de octubre de 2026, 23:59 en hora de Bogotá.
  select timestamptz '2026-10-18 23:59:00-05';
$$;

revoke all on function grandfather_verification_deadline() from public, anon, authenticated;
grant execute on function grandfather_verification_deadline() to service_role;


/**
 * Mismo barrido que la 0040; solo cambia de dónde sale el plazo.
 */
create or replace function expire_grandfathered_verifications(
  -- Sigue siendo parámetro con valor por defecto para que las pruebas ejerzan
  -- el barrido sin esperar la fecha. El cron lo invoca sin argumentos.
  p_deadline timestamptz default grandfather_verification_deadline()
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_deadline constant timestamptz := p_deadline;
begin
  if now() < v_deadline then
    return;
  end if;

  with degradadas as (
    update users u
    set verification_status = 'pending_documents',
        verification_notes  = 'Verificación heredada vencida el ' ||
                              to_char(v_deadline at time zone 'America/Bogota', 'DD/MM/YYYY') ||
                              ' sin documentos aportados. Requiere verificación para volver a crear registros clínicos.',
        verification_decided_at = now()
    where u.verification_status = 'verified'
      and u.verification_notes like 'Cuenta anterior a la verificaci%'
      and u.id_document_path is null
      and u.license_document_path is null
      and u.id_document_hash is null
    returning u.clinic_id
  )
  insert into audit_logs (clinic_id, action, entity_type, metadata)
  select clinic_id, 'verification.grandfather_expired', 'users',
         jsonb_build_object('expired_count', count(*))
  from degradadas
  group by clinic_id;
end;
$$;


/**
 * Mismo trigger que la 0032, más la regla de la nota y los documentos.
 */
create or replace function enforce_verification_transition()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- service-role / jobs: la autorización ya se hizo en la capa de aplicación.
  if auth.uid() is null then
    return new;
  end if;

  if new.verified_by is distinct from old.verified_by then
    raise exception 'Solo el revisor puede asignar quién verificó';
  end if;

  if new.verification_status is distinct from old.verification_status then
    if auth.uid() <> new.id then
      raise exception 'No puedes cambiar el estado de verificación de otro usuario';
    end if;
    if new.verification_status <> 'pending_review' then
      raise exception 'Solo puedes enviar tu verificación a revisión';
    end if;
    if old.verification_status not in ('pending_documents', 'rejected', 'suspended') then
      raise exception 'Tu verificación no está en un estado que admita reenvío';
    end if;
    -- Un envío válido limpia la decisión anterior, no la conserva ni la inventa.
    if new.verification_decided_at is not null then
      raise exception 'No puedes fijar la fecha de decisión';
    end if;
  elsif new.verification_decided_at is distinct from old.verification_decided_at then
    raise exception 'Solo el revisor puede fijar la decisión de verificación';
  end if;

  -- Nota, documentos, huellas y marca de purga (0043): solo cambian con un envío
  -- a revisión válido —ya comprobado arriba— o desde el servidor. Sin esto, una
  -- cuenta heredada podía borrar su nota o poner rutas inventadas y quedar fuera
  -- de expire_grandfathered_verifications sin aportar nada.
  if new.verification_status is not distinct from old.verification_status
     and (new.verification_notes is distinct from old.verification_notes
          or new.id_document_path is distinct from old.id_document_path
          or new.license_document_path is distinct from old.license_document_path
          or new.id_document_hash is distinct from old.id_document_hash
          or new.license_document_hash is distinct from old.license_document_hash
          or new.documents_purged_at is distinct from old.documents_purged_at) then
    raise exception 'Solo el revisor puede cambiar la nota o los documentos de verificación';
  end if;

  return new;
end $$;

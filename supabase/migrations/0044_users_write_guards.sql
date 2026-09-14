-- ============================================================================
-- Lo que la sesión no puede escribir en users. Cierra lo que encontró la
-- revisión de la 0043, antes de desplegarla.
--
-- 1. INSERT sin control. La política users_insert (0001) dejaba a cualquier
--    admin de clínica —y todo registro nuevo es admin, verificado o no—
--    insertar con su sesión el perfil de otra cuenta de auth ya marcado
--    verification_status = 'verified'. Esa cuenta tenía acceso clínico
--    completo sin que nadie hubiera visto sus documentos. Ningún camino
--    legítimo inserta en users con la sesión: el alta usa
--    create_clinic_and_admin (SECURITY DEFINER) y el equipo, addMember
--    (service-role). Se retira el permiso, como hizo la 0041 con clinics.
--
-- 2. Cambio de rol propio. users_update permite editar la propia fila y nada
--    miraba el rol: una secretaria podía hacerse admin (comprobado en local).
--
-- 3. Envío a revisión con datos ajenos. La 0043 protegió nota, rutas, huellas
--    y marca de purga en los updates que no cambian el estado, pero en un
--    envío a revisión la sesión aún podía declarar rutas de otra persona o
--    fijar la marca de purga y dejar sus documentos fuera de la retención.
--    Ahora las rutas tienen que estar en la carpeta propia, y el envío reinicia
--    huellas y marca de purga.
--
-- 4. Documentos que nunca se purgaban. Las 11 cuentas heredadas ya tienen
--    documents_purged_at: la purga pasó sobre sus filas sin archivos. Si una
--    se degrada y se verifica por el camino normal, sus documentos nuevos
--    quedaban fuera de la purga para siempre. El punto 3 lo resuelve desde la
--    base, incluso para el código anterior durante el despliegue.
--
-- 5. Secretarias heredadas. El backfill de la 0032 marcó también a las
--    secretarias, que no se verifican: el barrido del plazo las degradaba sin
--    efecto sobre su acceso y sin forma de resolverlo. Ahora solo alcanza a
--    admin y doctor.
-- ============================================================================

drop policy if exists users_insert on users;
revoke insert on table users from anon, authenticated;


create or replace function enforce_verification_transition()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- service-role / jobs: la autorización ya se hizo en la capa de aplicación.
  if auth.uid() is null then
    return new;
  end if;

  -- Rol propio (0044): nadie se cambia de rol con su sesión. El admin de la
  -- clínica sigue cambiando el de otros, y el admin de plataforma, cualquiera.
  if new.role is distinct from old.role and old.id = auth.uid() and not is_platform_admin() then
    raise exception 'No puedes cambiar tu propio rol';
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
    -- Envío a revisión (0044): las rutas tienen que ser de la carpeta propia
    -- ({clinic_id}/{user_id}/…), y huellas y marca de purga se reinician: las
    -- huellas las calcula el revisor al decidir, y la purga corre desde esa
    -- decisión.
    if (new.id_document_path is not null
        and (new.id_document_path not like old.clinic_id::text || '/' || old.id::text || '/%'
             or position('..' in new.id_document_path) > 0))
       or (new.license_document_path is not null
        and (new.license_document_path not like old.clinic_id::text || '/' || old.id::text || '/%'
             or position('..' in new.license_document_path) > 0)) then
      raise exception 'Las rutas de los documentos tienen que ser de tu propia carpeta';
    end if;
    new.id_document_hash := null;
    new.license_document_hash := null;
    new.documents_purged_at := null;
  elsif new.verification_decided_at is distinct from old.verification_decided_at then
    raise exception 'Solo el revisor puede fijar la decisión de verificación';
  end if;

  -- Nota, documentos, huellas y marca de purga (0043): sin cambio de estado,
  -- solo los escribe el servidor.
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


/**
 * Mismo barrido que la 0043, limitado a quienes ejercen (punto 5).
 */
create or replace function expire_grandfathered_verifications(
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
      and u.role in ('admin', 'doctor')
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

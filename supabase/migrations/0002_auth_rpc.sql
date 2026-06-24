-- ============================================================================
-- RPC de bootstrap: crea clínica + perfil admin para el usuario recién registrado
-- ============================================================================
-- Se invoca desde el signup (con la sesión del usuario ya autenticado).
-- SECURITY DEFINER: inserta saltándose RLS, pero solo para el propio auth.uid().

create or replace function create_clinic_and_admin(clinic_name text, full_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  user_email text;
  new_clinic_id uuid;
  base_slug text;
  final_slug text;
begin
  if uid is null then
    raise exception 'No autenticado';
  end if;

  -- Un usuario solo puede bootstrapear una vez.
  if exists (select 1 from public.users where id = uid) then
    raise exception 'El usuario ya pertenece a una clínica';
  end if;

  select email into user_email from auth.users where id = uid;

  -- Slug único a partir del nombre + sufijo corto.
  base_slug := regexp_replace(lower(trim(clinic_name)), '[^a-z0-9]+', '-', 'g');
  base_slug := trim(both '-' from base_slug);
  if base_slug = '' then base_slug := 'clinica'; end if;
  final_slug := base_slug || '-' || substr(encode(gen_random_bytes(3), 'hex'), 1, 6);

  insert into public.clinics (name, slug)
  values (clinic_name, final_slug)
  returning id into new_clinic_id;

  insert into public.users (id, clinic_id, role, full_name, email)
  values (uid, new_clinic_id, 'admin', full_name, user_email);

  insert into public.clinic_doctors (clinic_id, doctor_id)
  values (new_clinic_id, uid);

  insert into public.audit_logs (clinic_id, actor_id, action, entity_type, entity_id)
  values (new_clinic_id, uid, 'clinic.created', 'clinic', new_clinic_id);

  return new_clinic_id;
end; $$;

revoke all on function create_clinic_and_admin(text, text) from public, anon;
grant execute on function create_clinic_and_admin(text, text) to authenticated;

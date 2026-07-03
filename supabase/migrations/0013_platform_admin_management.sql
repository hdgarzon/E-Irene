-- ============================================================================
-- Panel maestro — nivel "agregados sin PHI":
--   * Métricas ampliadas (reportes, citas, notificaciones) por clínica.
--   * Desglose global de citas por estado.
--   * Gestión de clínicas: cambiar plan y suspender/reactivar.
--
-- Todo sigue SIN exponer datos clínicos de pacientes (nombres, transcripciones,
-- reportes): solo conteos y metadatos de negocio, y solo para platform admins.
-- La suspensión bloquea el acceso de la clínica a la app (ver lib/auth.ts),
-- es totalmente reversible, y cada acción de gestión queda en audit_logs.
-- ============================================================================

alter table clinics add column suspended_at timestamptz;

-- Overview ampliado. Cambia el tipo de retorno, así que hay que recrear.
drop function if exists get_platform_clinic_overview();

create function get_platform_clinic_overview()
returns table (
  clinic_id uuid,
  clinic_name text,
  slug text,
  plan text,
  created_at timestamptz,
  suspended_at timestamptz,
  doctor_count bigint,
  patient_count bigint,
  consultation_count bigint,
  report_count bigint,
  appointment_count bigint,
  notifications_sent bigint
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not is_platform_admin() then
    raise exception 'No autorizado';
  end if;

  return query
  select
    c.id,
    c.name,
    c.slug,
    c.plan::text,
    c.created_at,
    c.suspended_at,
    (select count(*) from clinic_doctors cd where cd.clinic_id = c.id),
    (select count(*) from patients p where p.clinic_id = c.id),
    (select count(*) from consultations co where co.clinic_id = c.id),
    (select count(*) from reports r where r.clinic_id = c.id),
    (select count(*) from appointments a where a.clinic_id = c.id),
    (select count(*) from notifications n where n.clinic_id = c.id and n.status = 'sent')
  from clinics c
  order by c.created_at desc;
end; $$;
revoke all on function get_platform_clinic_overview() from public, anon;
grant execute on function get_platform_clinic_overview() to authenticated;

-- Desglose global de citas por estado (conteo, sin datos de paciente).
create or replace function get_platform_appointment_status()
returns table (status text, count bigint)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not is_platform_admin() then
    raise exception 'No autorizado';
  end if;

  return query
  select a.status::text, count(*)
  from appointments a
  group by a.status
  order by a.status::text;
end; $$;
revoke all on function get_platform_appointment_status() from public, anon;
grant execute on function get_platform_appointment_status() to authenticated;

-- Gestión: cambiar el plan de una clínica.
create or replace function platform_set_clinic_plan(target_clinic uuid, new_plan text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'No autorizado';
  end if;
  if new_plan not in ('free', 'pro', 'clinica', 'enterprise') then
    raise exception 'Plan inválido: %', new_plan;
  end if;

  update clinics set plan = new_plan::clinic_plan where id = target_clinic;

  insert into audit_logs (clinic_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_clinic, auth.uid(), 'platform.clinic_plan_changed', 'clinic', target_clinic,
          jsonb_build_object('plan', new_plan));
end; $$;
revoke all on function platform_set_clinic_plan(uuid, text) from public, anon;
grant execute on function platform_set_clinic_plan(uuid, text) to authenticated;

-- Gestión: suspender / reactivar una clínica (reversible).
create or replace function platform_set_clinic_suspended(target_clinic uuid, suspend boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'No autorizado';
  end if;

  update clinics
     set suspended_at = case when suspend then now() else null end
   where id = target_clinic;

  insert into audit_logs (clinic_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_clinic, auth.uid(),
          case when suspend then 'platform.clinic_suspended' else 'platform.clinic_reactivated' end,
          'clinic', target_clinic, '{}'::jsonb);
end; $$;
revoke all on function platform_set_clinic_suspended(uuid, boolean) from public, anon;
grant execute on function platform_set_clinic_suspended(uuid, boolean) to authenticated;

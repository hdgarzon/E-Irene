-- ============================================================================
-- Super-admin de plataforma: acceso de SOLO NEGOCIO (nombre de clínica, plan,
-- fecha de registro, conteos) a través de RPCs con SECURITY DEFINER —
-- NUNCA expone datos clínicos de pacientes (nombres, transcripciones,
-- reportes, notas). Esto evita chocar con el secreto profesional que el
-- consentimiento firmado por los pacientes promete (ver lib/consent.ts).
--
-- No hay ningún endpoint/RPC para auto-otorgarse este rol: solo se concede
-- insertando directamente en platform_admins (fuera de la app), una acción
-- deliberada y auditable.
-- ============================================================================

create table platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
-- RLS habilitado sin políticas: nadie puede leer/escribir esta tabla vía la
-- API (ni siquiera el propio admin) — solo se consulta internamente desde
-- funciones SECURITY DEFINER de abajo.
alter table platform_admins enable row level security;

create or replace function is_platform_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from platform_admins where user_id = auth.uid());
$$;
revoke all on function is_platform_admin() from public, anon;
grant execute on function is_platform_admin() to authenticated;

-- Vista de negocio de todas las clínicas: SIN pacientes, SIN transcripciones,
-- SIN reportes — solo metadatos de la clínica y conteos agregados.
create or replace function get_platform_clinic_overview()
returns table (
  clinic_id uuid,
  clinic_name text,
  slug text,
  plan text,
  created_at timestamptz,
  doctor_count bigint,
  patient_count bigint,
  consultation_count bigint
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
    (select count(*) from clinic_doctors cd where cd.clinic_id = c.id),
    (select count(*) from patients p where p.clinic_id = c.id),
    (select count(*) from consultations co where co.clinic_id = c.id)
  from clinics c
  order by c.created_at desc;
end; $$;
revoke all on function get_platform_clinic_overview() from public, anon;
grant execute on function get_platform_clinic_overview() to authenticated;

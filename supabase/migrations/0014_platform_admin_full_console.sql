-- ============================================================================
-- Centro de administración de plataforma (consola completa).
--
-- El platform admin puede gestionar cuentas de DOCTORES, PACIENTES y CITAS de
-- TODAS las clínicas — pero NO el contenido clínico (reportes, notas SOAP,
-- notas del profesional, transcripciones, antecedentes/notas del paciente):
-- las políticas RLS de reports/consultations/soap_notes/etc. NO se extienden,
-- así que ese contenido sigue fuera de su alcance. Se apoya en RLS (no en un
-- cliente service-role): cada tabla accesible suma `or is_platform_admin()`.
--
-- Además: plan_configs mueve el TÍTULO/DESCRIPCIÓN/PRECIO de cada plan a la
-- base de datos para que el maestro los edite sin tocar código (los LÍMITES de
-- cumplimiento siguen en lib/plans.ts, por seguridad de facturación).
-- ============================================================================

-- --- RLS: el platform admin ve/gestiona cross-clínica -----------------------
-- Metadatos de clínica (nombre) — necesario para los joins de la consola.
alter policy clinic_select on clinics using (id = auth_clinic_id() or is_platform_admin());

-- Cuentas de personal (doctores/usuarios): NO cifradas.
alter policy users_select on users using (clinic_id = auth_clinic_id() or is_platform_admin());
alter policy users_update on users
  using (id = auth.uid() or (clinic_id = auth_clinic_id() and auth_role() = 'admin') or is_platform_admin());
alter policy users_delete on users
  using ((clinic_id = auth_clinic_id() and auth_role() = 'admin') or is_platform_admin());

-- Pacientes: PII cifrada a nivel app (se descifra en Node, no en SQL). El
-- admin gestiona identidad/contacto; el contenido clínico (notes_enc,
-- history_enc) simplemente no se muestra ni edita desde la consola.
alter policy patients_select on patients using (clinic_id = auth_clinic_id() or is_platform_admin());
alter policy patients_update on patients using (clinic_id = auth_clinic_id() or is_platform_admin());
alter policy patients_delete on patients
  using ((clinic_id = auth_clinic_id() and auth_role() in ('admin','doctor')) or is_platform_admin());

-- Citas.
alter policy appts_select on appointments using (clinic_id = auth_clinic_id() or is_platform_admin());
alter policy appts_update on appointments using (clinic_id = auth_clinic_id() or is_platform_admin());
alter policy appts_delete on appointments using (clinic_id = auth_clinic_id() or is_platform_admin());

-- Mapa clínica ↔ doctores.
alter policy clinicdoc_select on clinic_doctors using (clinic_id = auth_clinic_id() or is_platform_admin());

-- --- plan_configs: título/descripción/precio editables ----------------------
create table plan_configs (
  plan clinic_plan primary key,
  label text not null,
  description text not null default '',
  price text not null default '',
  sort_order int not null default 0,
  updated_at timestamptz not null default now()
);
create trigger trg_plan_configs_updated before update on plan_configs
  for each row execute function set_updated_at();

insert into plan_configs (plan, label, description, price, sort_order) values
  ('free',       'Free',       'Para empezar y probar la plataforma.',        '$0/mes',        1),
  ('pro',        'Pro',        'Para profesionales independientes.',          '$49/mes',       2),
  ('clinica',    'Clínica',    'Para equipos y clínicas pequeñas.',           '$149/mes',      3),
  ('enterprise', 'Enterprise', 'Para redes y organizaciones grandes.',        'Personalizado', 4);

alter table plan_configs enable row level security;
-- Legible por cualquier usuario autenticado (se muestra en toda la app);
-- escritura solo por el RPC SECURITY DEFINER de abajo.
create policy plan_configs_select on plan_configs for select to authenticated using (true);

create or replace function platform_set_plan_config(
  p_plan text, p_label text, p_description text, p_price text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'No autorizado';
  end if;
  if p_plan not in ('free', 'pro', 'clinica', 'enterprise') then
    raise exception 'Plan inválido: %', p_plan;
  end if;

  update plan_configs
     set label = p_label, description = p_description, price = p_price
   where plan = p_plan::clinic_plan;
end; $$;
revoke all on function platform_set_plan_config(text, text, text, text) from public, anon;
grant execute on function platform_set_plan_config(text, text, text, text) to authenticated;

-- ============================================================================
-- Planes en pesos colombianos: Esencial en las validaciones y en plan_configs.
--
-- platform_set_clinic_plan (0013) y platform_set_plan_config (0014) validan el
-- plan contra una lista escrita a mano. Sin 'esencial' en ella, la consola no
-- podría asignar ni editar el plan nuevo. Se redefinen iguales, solo con la
-- lista ampliada.
--
-- plan_configs guarda el título, la descripción y el precio que muestra la
-- consola. Se reemplazan por la escala vigente para que la consola no siga
-- mostrando los precios anteriores. El monto que se cobra no vive aquí sino en
-- lib/plans.ts.
-- ============================================================================

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
  if new_plan not in ('free', 'esencial', 'pro', 'clinica', 'enterprise') then
    raise exception 'Plan inválido: %', new_plan;
  end if;

  update clinics set plan = new_plan::clinic_plan where id = target_clinic;

  insert into audit_logs (clinic_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_clinic, auth.uid(), 'platform.clinic_plan_changed', 'clinic', target_clinic,
          jsonb_build_object('plan', new_plan));
end; $$;
revoke all on function platform_set_clinic_plan(uuid, text) from public, anon;
grant execute on function platform_set_clinic_plan(uuid, text) to authenticated;

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
  if p_plan not in ('free', 'esencial', 'pro', 'clinica', 'enterprise') then
    raise exception 'Plan inválido: %', p_plan;
  end if;

  update plan_configs
     set label = p_label, description = p_description, price = p_price
   where plan = p_plan::clinic_plan;
end; $$;
revoke all on function platform_set_plan_config(text, text, text, text) from public, anon;
grant execute on function platform_set_plan_config(text, text, text, text) to authenticated;

insert into plan_configs (plan, label, description, price, sort_order) values
  ('free',       'Free',        'Para empezar y probar la plataforma.',                  '$0 COP/mes',       1),
  ('esencial',   'Esencial',    'Para profesionales que están empezando.',               '$59.000 COP/mes',  2),
  ('pro',        'Profesional', 'Para profesionales independientes con agenda completa.', '$99.000 COP/mes',  3),
  ('clinica',    'Clínica',     'Para equipos y clínicas pequeñas.',                     '$249.000 COP/mes', 4),
  ('enterprise', 'Enterprise',  'Para redes y organizaciones grandes.',                  'A convenir',       5)
on conflict (plan) do update
   set label = excluded.label,
       description = excluded.description,
       price = excluded.price,
       sort_order = excluded.sort_order;

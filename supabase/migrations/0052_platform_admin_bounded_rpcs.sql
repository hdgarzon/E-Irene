-- ============================================================================
-- Consola del admin de plataforma sin totales truncados.
--
-- PostgREST corta toda respuesta en max_rows (1000, supabase/config.toml),
-- también la de una función que devuelve un conjunto. Las dos que usaba la
-- consola devuelven una fila por clínica:
--
--   · get_platform_clinic_overview() (0013): el resumen contaba las filas y
--     sumaba sus conteos, así que pasadas las 1000 clínicas mostraba 1000
--     clínicas y los pacientes, consultas y citas de solo esas.
--   · get_platform_transcription_usage() (0039/0041) y la misma overview: el
--     mapa de clínicas cruzaba sus filas por id, así que las clínicas que
--     quedaban fuera aparecían con 0 pacientes y 0 horas transcritas.
--
-- Ninguno de los dos cortes daba error ni aviso. Estas funciones devuelven una
-- cantidad de filas acotada por diseño:
--
--   · get_platform_totals(): una sola fila con los totales globales.
--   · get_platform_clinic_stats(ids): una fila por clínica de la página que
--     muestra la consola (como mucho 100 por llamada).
--
-- Misma línea que 0013/0015: SECURITY DEFINER, solo platform admins, y solo
-- conteos y segundos — nunca identidad ni contenido clínico de pacientes.
--
-- Aditiva: las funciones anteriores se quedan aunque la app ya no las use.
-- Quitarlas es un cambio destructivo y va en un despliegue posterior.
-- ============================================================================

create or replace function get_platform_totals()
returns table (
  clinic_count bigint,
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
    (select count(*) from clinics),
    (select count(*) from patients),
    (select count(*) from consultations),
    (select count(*) from reports),
    (select count(*) from appointments),
    (select count(*) from notifications n where n.status = 'sent');
end; $$;

create or replace function get_platform_clinic_stats(p_clinic_ids uuid[])
returns table (
  clinic_id uuid,
  patient_count bigint,
  transcription_seconds_cycle bigint
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
  -- La consola pide las de una página. Un arreglo sin tope volvería a chocar
  -- con max_rows sin avisar.
  if coalesce(cardinality(p_clinic_ids), 0) > 100 then
    raise exception 'Demasiadas clínicas por consulta (máximo 100)';
  end if;

  return query
  select
    c.id,
    (select count(*) from patients p where p.clinic_id = c.id),
    -- Misma regla que la cuota (0041): ciclo vigente, sesión abierta ≤ 1 h.
    transcription_seconds_used(c.id)
  from clinics c
  where c.id = any(p_clinic_ids);
end; $$;

revoke all on function get_platform_totals() from public, anon;
revoke all on function get_platform_clinic_stats(uuid[]) from public, anon;
grant execute on function get_platform_totals() to authenticated;
grant execute on function get_platform_clinic_stats(uuid[]) to authenticated;

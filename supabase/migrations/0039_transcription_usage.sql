-- ============================================================================
-- Medición y cuota de transcripción por clínica/mes.
--
-- lib/plans.ts vende "horas de transcripción" por plan (free 2 h, pro 20 h,
-- clinica 100 h, enterprise ilimitado) pero hasta ahora nada las medía ni las
-- aplicaba: cualquier tenant podía transcribir sin límite y la exposición de
-- costo de Deepgram quedaba sin acotar (~$0.0068/min in-person, ~$0.0096/min
-- en video por las 2 conexiones — ver components/live-consultation.tsx).
--
-- DECISIÓN DE MEDICIÓN: la cuota mide la DURACIÓN DE LA CONSULTA con sesión
-- de transcripción otorgada, UNA sola vez por consulta — aunque el modo video
-- abra 2 conexiones Deepgram en paralelo (mic del doctor + pista remota del
-- paciente). El plan vende horas de consulta transcrita, la unidad que el
-- usuario entiende; que video cueste ~2x por minuto en Deepgram es un asunto
-- de márgenes del negocio, no de la cuota. La cuota aplica igual con el
-- proveedor mock (misma feature de producto, y así es demostrable/testeable).
--
-- Diseño (mismo espíritu que rate_limits en 0016):
--  · Ledger transcription_usage: UNA fila por consulta, abierta al renderizar
--    la página live (begin) y cerrada al terminar la consulta (finalize) con
--    la duración real. Mes de atribución = mes en Bogotá en que INICIÓ la
--    sesión (una consulta que cruce el fin de mes cuenta en el mes en que
--    empezó).
--  · SIN FK a consultations: el consumo es un registro de facturación y debe
--    sobrevivir al borrado de pacientes/consultas (mismo criterio que
--    audit_logs.entity_id) — con FK en cascada, borrar un paciente
--    "devolvería" las horas ya consumidas ese mes.
--  · Tabla bloqueada: RLS habilitado sin políticas y sin GRANTs — solo se
--    lee/escribe a través de las funciones SECURITY DEFINER de abajo, que
--    fijan el tenant con auth_clinic_id().
--  · El LÍMITE por plan NO vive aquí: sigue en lib/plans.ts (criterio de
--    0014: "los límites de cumplimiento siguen en lib/plans.ts") y llega como
--    argumento a begin_transcription_session. Invocar el RPC a mano con un
--    límite inflado no regala nada: su único efecto de escritura es registrar
--    consumo del PROPIO tenant, y quién decide si se acuña el token de
--    Deepgram es el servidor (app/(app)/consultations/[id]/live/page.tsx).
-- ============================================================================

create table transcription_usage (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  -- Sin FK a consultations (ver cabecera). UNIQUE → una consulta nunca cuenta
  -- dos veces, aunque la página live se recargue o el cierre se reintente.
  consultation_id uuid not null unique,
  -- Inicio de la sesión de transcripción (primer render de la página live).
  started_at timestamptz not null default now(),
  -- Duración final en segundos; 0 mientras la sesión sigue abierta.
  seconds int not null default 0 check (seconds >= 0),
  -- null = sesión abierta (la consulta aún no termina).
  finalized_at timestamptz,
  created_at timestamptz not null default now()
);
-- Para la suma mensual por clínica de transcription_seconds_used().
create index transcription_usage_clinic_started_idx
  on transcription_usage (clinic_id, started_at desc);

alter table transcription_usage enable row level security;
-- Sin políticas a propósito (ver cabecera) — y REVOKE explícito porque el
-- ALTER DEFAULT PRIVILEGES de 0004_grants.sql concede SELECT/INSERT/UPDATE/
-- DELETE a `authenticated` en cada tabla nueva: sin esto, un SELECT directo
-- "funcionaría" (vacío por RLS) en vez de ser denegado de plano.
revoke all on table transcription_usage from public, anon, authenticated;

-- Inicio del mes en curso en hora de Bogotá, la zona de toda la app (ver
-- lib/dates.ts). Con date_trunc sobre now() a secas (UTC), la cuota se
-- reiniciaría a las 19:00 del último día del mes en Colombia.
create or replace function transcription_month_start()
returns timestamptz
language sql stable
set search_path = public
as $$
  select date_trunc('month', now() at time zone 'America/Bogota')
           at time zone 'America/Bogota';
$$;

-- Segundos consumidos por la clínica en el mes en curso. Las sesiones aún
-- abiertas aportan su tiempo transcurrido, acotado a 1 h — el TTL de la key
-- efímera de Deepgram (TTL_SECONDS en lib/providers/deepgram.ts): pasado ese
-- tiempo la sesión no puede seguir acuñando tokens sin volver a pasar por
-- begin_transcription_session. El tope también acota el daño de sesiones
-- "zombi" (pestaña cerrada sin finalizar la consulta): aportan ≤1 h y solo
-- dentro de su propio mes. La duración real queda registrada al finalizar.
create or replace function transcription_seconds_used(p_clinic uuid)
returns bigint
language sql stable
set search_path = public
as $$
  select coalesce(sum(
    case
      when u.finalized_at is null
        then least(extract(epoch from (now() - u.started_at)), 3600)::bigint
      else u.seconds
    end
  ), 0)::bigint
  from transcription_usage u
  where u.clinic_id = p_clinic
    and u.started_at >= transcription_month_start();
$$;

/**
 * Abre (o retoma) la sesión de transcripción de una consulta si la clínica
 * aún tiene cuota. Devuelve jsonb { allowed boolean, used_seconds bigint }.
 * `p_limit_seconds` viene de lib/plans.ts; null = ilimitado (enterprise).
 *
 * El chequeo aplica igual a sesiones nuevas y a recargas de una sesión ya
 * abierta: si la recarga se re-permitiera incondicionalmente, una consulta
 * eterna + recargas cada hora darían transcripción sin tope. La sesión en
 * curso nunca se corta desde aquí (el WebSocket ya abierto no se toca); solo
 * se niega el PRÓXIMO token.
 */
create or replace function begin_transcription_session(
  p_consultation_id uuid,
  p_limit_seconds bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic uuid;
  v_status consultation_status;
  v_used bigint;
begin
  select c.clinic_id, c.status into v_clinic, v_status
  from consultations c
  where c.id = p_consultation_id;

  if v_clinic is null or v_clinic is distinct from auth_clinic_id() then
    raise exception 'No autorizado';
  end if;

  -- Solo consultas en curso abren sesión (la página live ya redirige si no).
  if v_status <> 'in_progress' then
    return jsonb_build_object(
      'allowed', false,
      'used_seconds', transcription_seconds_used(v_clinic)
    );
  end if;

  -- Serializa begins concurrentes de la misma clínica: sin esto, dos
  -- consultas arrancando a la vez podrían pasar ambas el chequeo con la
  -- cuota casi agotada (el excedente quedaría sin acotar).
  perform 1 from clinics where id = v_clinic for update;

  -- Red de seguridad: cierra sesiones cuya consulta ya terminó pero cuyo
  -- finalize nunca llegó (error de red, deploy a mitad de request).
  update transcription_usage u
  set seconds = greatest(0, round(extract(epoch from (c.ended_at - u.started_at))))::int,
      finalized_at = now()
  from consultations c
  where c.id = u.consultation_id
    and u.clinic_id = v_clinic
    and u.finalized_at is null
    and c.ended_at is not null;

  v_used := transcription_seconds_used(v_clinic);

  if p_limit_seconds is not null and v_used >= p_limit_seconds then
    return jsonb_build_object('allowed', false, 'used_seconds', v_used);
  end if;

  insert into transcription_usage (clinic_id, consultation_id)
  values (v_clinic, p_consultation_id)
  on conflict (consultation_id) do nothing;

  return jsonb_build_object('allowed', true, 'used_seconds', v_used);
end;
$$;

/**
 * Registra la duración real al terminar la consulta:
 * seconds = ended_at − started_at (del ledger). Idempotente (la segunda
 * llamada no cambia nada) y sin efecto mientras la consulta siga en curso —
 * así una llamada directa maliciosa no puede "congelar barato" una sesión
 * que sigue transcribiendo: mientras la consulta no termine, no se cierra.
 * Si la fila no existe (la sesión fue negada por cuota), no hace nada.
 */
create or replace function finalize_transcription_session(p_consultation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update transcription_usage u
  set seconds = greatest(0, round(extract(epoch from (c.ended_at - u.started_at))))::int,
      finalized_at = now()
  from consultations c
  where u.consultation_id = p_consultation_id
    and c.id = u.consultation_id
    and u.clinic_id = auth_clinic_id()
    and u.finalized_at is null
    and c.ended_at is not null;
end;
$$;

/** Consumo del mes en curso de la clínica del usuario:
 *  jsonb { used_seconds bigint, sessions bigint }. Para settings y
 *  settings/plan. */
create or replace function get_transcription_usage()
returns jsonb
language sql stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'used_seconds', transcription_seconds_used(auth_clinic_id()),
    'sessions', (
      select count(*)
      from transcription_usage
      where clinic_id = auth_clinic_id()
        and started_at >= transcription_month_start()
    )
  );
$$;

/** Consumo del mes en curso de TODAS las clínicas — solo platform admin.
 *  Metadatos de negocio (segundos y conteo), sin contenido clínico: misma
 *  línea que get_platform_clinic_overview (0014). */
create or replace function get_platform_transcription_usage()
returns table (clinic_id uuid, used_seconds bigint, sessions bigint)
language plpgsql stable
security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'No autorizado';
  end if;
  return query
    select u.clinic_id,
           -- Misma regla que transcription_seconds_used (sesión abierta ≤1 h).
           sum(case
                 when u.finalized_at is null
                   then least(extract(epoch from (now() - u.started_at)), 3600)::bigint
                 else u.seconds
               end)::bigint,
           count(*)::bigint
    from transcription_usage u
    where u.started_at >= transcription_month_start()
    group by u.clinic_id;
end;
$$;

-- Postgres da EXECUTE a PUBLIC por defecto en cada función nueva; se revoca
-- todo y se concede solo lo que la app usa (patrón de 0016/0021). Los helpers
-- internos quedan sin grants: solo corren anidados dentro de las funciones
-- SECURITY DEFINER (donde el usuario efectivo es el owner).
revoke all on function transcription_month_start() from public, anon, authenticated;
revoke all on function transcription_seconds_used(uuid) from public, anon, authenticated;
revoke all on function begin_transcription_session(uuid, bigint) from public, anon;
revoke all on function finalize_transcription_session(uuid) from public, anon;
revoke all on function get_transcription_usage() from public, anon;
revoke all on function get_platform_transcription_usage() from public, anon;

grant execute on function begin_transcription_session(uuid, bigint) to authenticated;
grant execute on function finalize_transcription_session(uuid) to authenticated;
grant execute on function get_transcription_usage() to authenticated;
grant execute on function get_platform_transcription_usage() to authenticated;

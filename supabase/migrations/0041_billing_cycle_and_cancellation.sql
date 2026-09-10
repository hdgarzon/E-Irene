-- ============================================================================
-- Ciclo de facturación anclado a la contratación + cancelación al final del
-- período.
--
-- QUÉ CORRIGE
--
-- 1. La cuota se reiniciaba el día 1 del mes, no en la fecha de contratación.
--    transcription_month_start() (0039) y el conteo de consultas de
--    lib/db/clinic.ts cortaban con date_trunc('month'). Quien contrataba el 18
--    recibía la cuota completa del 18 al 30 y OTRA completa el día 1: en su
--    primer período pagado podía consumir el doble de lo que pagó. Le pasaba a
--    cada cliente nuevo.
--
-- 2. La renovación contaba el período desde la fecha del cobro y no desde el
--    fin del período anterior (renewBilling: now() + 30 días). Como el cron
--    cobra hasta 3 días antes del vencimiento, cada renovación le quitaba días
--    al cliente y la fecha de corte se iba corriendo mes a mes. Un cobro
--    recurrente aprobado que llegaba por webhook se trataba además como una
--    compra nueva (activateBilling), con el mismo efecto.
--
-- 3. No había forma de cancelar. La única salida era elegir Free en la grilla
--    de planes, que bajaba el plan AL INSTANTE —perdiendo lo ya pagado del
--    período— y dejaba guardado el token de cobro.
--
-- Y UN HUECO que había que cerrar antes de confiar en nada de lo anterior: la
-- política clinic_update (0001) dejaba al admin de una clínica actualizar
-- CUALQUIER columna de su fila con un PATCH directo a la API. Podía ponerse
-- plan enterprise sin pagar, fijarse un período pagado, quitarse una
-- suspensión de la plataforma o —con esta migración— reiniciar su propio ciclo
-- de cuota. Ningún camino legítimo escribe clinics con la sesión del usuario
-- (el único que lo intentaba era ese cambio a Free), así que se le quita la
-- escritura a los roles de la app. Plataforma, webhook y cron siguen escribiendo
-- con service-role o con funciones SECURITY DEFINER.
--
-- EL CICLO
--   clinics.billing_cycle_anchor fija el día y la hora del ciclo. Los ciclos se
--   cuentan SIEMPRE desde el ancla (ancla + k meses, en hora de Bogotá), nunca
--   encadenando el fin del anterior: un ancla del 31 da 28-feb y vuelve al
--   31-mar. lib/dates.ts replica el cálculo (billingCycleBounds) para la
--   interfaz y el conteo de consultas; tests/billing-cycle.test.ts verifica que
--   ambos den lo mismo.
--
--   · Pago de un plan (checkout): el ancla pasa a ser el momento del pago y el
--     período pagado termina un ciclo después. Es una suscripción nueva: la
--     cuota arranca de cero. Todavía no hay prorrateo, así que pasar de un plan
--     pago a otro cobra el precio completo y empieza un ciclo nuevo.
--   · Renovación: el período pagado avanza exactamente un ciclo desde donde
--     terminaba. Idempotente: se aplica contra el fin de período que se cobró,
--     así que el cron y el webhook del mismo cobro no la duplican.
--   · Free usa la misma ancla. Una suscripción cancelada termina justo en un
--     borde de ciclo, y la cuota Free arranca ahí.
--
-- LA CANCELACIÓN
--   La pide el admin de la clínica. Conserva el plan hasta current_period_end,
--   no se le vuelve a cobrar y puede revertirla antes de esa fecha. Al vencer,
--   end_canceled_subscriptions() (pg_cron, cada hora) la pasa a Free y borra el
--   token de cobro. NO se borra ningún dato de la clínica: cancelar la
--   suscripción no es eliminar la cuenta. Cada paso queda en audit_logs.
-- ============================================================================


-- ── 1. La fila de la clínica no se escribe con la sesión del usuario ────────

drop policy if exists clinic_update on clinics;
revoke insert, update, delete on table clinics from anon, authenticated;


-- ── 2. Columnas ─────────────────────────────────────────────────────────────

alter table clinics
  add column billing_cycle_anchor timestamptz,
  add column cancel_at_period_end boolean not null default false,
  add column cancel_requested_at timestamptz;

comment on column clinics.billing_cycle_anchor is
  'Día y hora que definen el ciclo mensual de cuota y facturación (ancla + k meses, hora de Bogotá). Lo fija el pago de un plan; en Free, el alta de la clínica. Ver billing_cycle_bounds().';
comment on column clinics.cancel_at_period_end is
  'La clínica pidió cancelar: conserva el plan hasta current_period_end, no se renueva y end_canceled_subscriptions() la pasa a Free al vencer.';
comment on column clinics.cancel_requested_at is
  'Cuándo se pidió la cancelación en curso (null si no hay ninguna). El historial completo está en audit_logs.';

-- Backfill sin efecto retroactivo sobre el consumo:
--  · con período pagado: el ancla es el fin de ese período, así la próxima
--    renovación cae en la misma fecha que ya tenía.
--  · el resto (Free, o un plan asignado desde la consola sin pago): el inicio
--    del mes en curso, que es exactamente el corte que ya tenían. Su ciclo
--    sigue reiniciándose el día 1.
update clinics
set billing_cycle_anchor = case
  when plan <> 'free' and current_period_end is not null
    then date_trunc('second', current_period_end)
  else transcription_month_start()
end;

-- Al segundo: lib/dates.ts calcula en milisegundos y Postgres guarda
-- microsegundos. Un ancla sin fracción da el mismo borde en los dos lados.
alter table clinics
  alter column billing_cycle_anchor set default date_trunc('second', now()),
  alter column billing_cycle_anchor set not null;


-- ── 3. Cálculo del ciclo ────────────────────────────────────────────────────

/** Suma meses en hora de Bogotá; si el día no existe en el mes destino, cae
 *  en el último (31-ene + 1 mes = 28-feb). Espejo de addMonthsBogota. */
create or replace function add_billing_months(p_from timestamptz, p_months integer)
returns timestamptz
language sql stable
set search_path = public
as $$
  select ((p_from at time zone 'America/Bogota') + make_interval(months => p_months))
           at time zone 'America/Bogota';
$$;

/** Ciclo [cycle_start, cycle_end) que contiene p_at, contado desde el ancla.
 *  Espejo de billingCycleBounds (lib/dates.ts). */
create or replace function billing_cycle_bounds(
  p_anchor timestamptz,
  p_at timestamptz default now()
)
returns table (cycle_start timestamptz, cycle_end timestamptz)
language plpgsql stable
set search_path = public
as $$
declare
  v_anchor timestamp := p_anchor at time zone 'America/Bogota';
  v_at     timestamp := p_at at time zone 'America/Bogota';
  v_months integer;
begin
  v_months := (extract(year from v_at)::int - extract(year from v_anchor)::int) * 12
            + (extract(month from v_at)::int - extract(month from v_anchor)::int);
  -- En el mes de p_at el ciclo puede no haber empezado todavía (el día del
  -- ancla es posterior): entonces el vigente es el que empezó el mes anterior.
  if add_billing_months(p_anchor, v_months) > p_at then
    v_months := v_months - 1;
  end if;
  cycle_start := add_billing_months(p_anchor, v_months);
  cycle_end   := add_billing_months(p_anchor, v_months + 1);
  return next;
end;
$$;

/** Inicio del ciclo vigente de una clínica: el corte de sus cuotas. */
create or replace function clinic_cycle_start(p_clinic uuid)
returns timestamptz
language sql stable
set search_path = public
as $$
  select b.cycle_start
  from clinics c
  cross join lateral billing_cycle_bounds(c.billing_cycle_anchor) b
  where c.id = p_clinic;
$$;

comment on function transcription_month_start() is
  'Obsoleta desde 0041: la cuota corta por ciclo (clinic_cycle_start), no por mes calendario. Se conserva porque la usa el backfill de 0041.';


-- ── 4. La cuota de transcripción corta por ciclo ────────────────────────────
-- Mismas firmas y mismo contrato que en 0039; solo cambia el corte.

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
    and u.started_at >= clinic_cycle_start(p_clinic);
$$;

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
        and started_at >= clinic_cycle_start(auth_clinic_id())
    )
  );
$$;

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
    join clinics c on c.id = u.clinic_id
    cross join lateral billing_cycle_bounds(c.billing_cycle_anchor) b
    where u.started_at >= b.cycle_start
    group by u.clinic_id;
end;
$$;


-- ── 5. Transiciones de la suscripción ───────────────────────────────────────

/** Días que un cobro vencido puede demorarse sin perder su ciclo. Única fuente
 *  para renew_subscription_period y para el futuro barrido de morosos. */
create or replace function billing_grace_period()
returns interval
language sql immutable
set search_path = public
as $$
  select interval '5 days';
$$;

/**
 * Pago aprobado de un plan por checkout: empieza una suscripción. El ancla es
 * el momento del pago y el período pagado termina un ciclo después. Anula una
 * cancelación pendiente: quien paga un plan nuevo no quiere perderlo.
 *
 * NO es idempotente (reinicia el ciclo): el llamador la protege con el registro
 * único de billing_events por (transacción, estado). Los cobros recurrentes NO
 * pasan por aquí, sino por renew_subscription_period.
 */
create or replace function activate_subscription(
  p_clinic uuid,
  p_plan clinic_plan,
  p_payment_source_enc text default null
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_previous clinics%rowtype;
  v_anchor timestamptz;
  v_period_end timestamptz;
begin
  if p_plan = 'free' then
    raise exception 'activate_subscription: el plan free no se activa con un pago';
  end if;

  select * into v_previous from clinics where id = p_clinic for update;
  if not found then
    raise exception 'activate_subscription: clínica inexistente %', p_clinic;
  end if;

  v_anchor := date_trunc('second', now());
  v_period_end := add_billing_months(v_anchor, 1);

  update clinics
  set plan = p_plan,
      billing_status = 'activo',
      billing_cycle_anchor = v_anchor,
      current_period_end = v_period_end,
      cancel_at_period_end = false,
      cancel_requested_at = null,
      -- Sin token nuevo se conserva el anterior: la consulta de la transacción
      -- no siempre lo trae (ver lib/billing/reconcile.ts).
      wompi_payment_source_id_enc = coalesce(p_payment_source_enc, wompi_payment_source_id_enc)
  where id = p_clinic;

  insert into audit_logs (clinic_id, action, entity_type, entity_id, metadata)
  values (p_clinic, 'subscription.activated', 'clinic', p_clinic, jsonb_build_object(
    'plan', p_plan,
    'previous_plan', v_previous.plan,
    'cycle_anchor', v_anchor,
    'period_end', v_period_end,
    'superseded_cancellation', v_previous.cancel_at_period_end
  ));

  return v_period_end;
end;
$$;

/**
 * Cobro recurrente aprobado: el período pagado avanza un ciclo desde donde
 * terminaba. Devuelve el nuevo fin, o null si no se aplicó.
 *
 * Idempotente por construcción: renueva el período que terminaba en
 * p_charged_period_end. Si la clínica ya no termina ahí, ese período se renovó
 * antes (el cron y el webhook del mismo cobro llegan los dos) o la suscripción
 * cambió entre tanto, y no se toca nada.
 */
create or replace function renew_subscription_period(
  p_clinic uuid,
  p_charged_period_end timestamptz
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic clinics%rowtype;
  v_anchor timestamptz;
  v_period_end timestamptz;
  v_reanchored boolean := false;
begin
  select * into v_clinic from clinics where id = p_clinic for update;
  if not found then
    raise exception 'renew_subscription_period: clínica inexistente %', p_clinic;
  end if;

  if v_clinic.current_period_end is distinct from p_charged_period_end then
    return null;
  end if;

  if p_charged_period_end is not null
     and p_charged_period_end >= now() - billing_grace_period() then
    -- A tiempo o dentro de la gracia: se conserva el ciclo.
    v_anchor := v_clinic.billing_cycle_anchor;
    select b.cycle_end into v_period_end
    from billing_cycle_bounds(v_anchor, p_charged_period_end) b;
  else
    -- Pagado pasada la gracia: conservar el ancla cobraría ciclos ya vencidos
    -- y dejaría la clínica lista para otro cobro al día siguiente. Se trata
    -- como una suscripción que vuelve a empezar hoy.
    v_anchor := date_trunc('second', now());
    v_period_end := add_billing_months(v_anchor, 1);
    v_reanchored := true;
  end if;

  update clinics
  set current_period_end = v_period_end,
      billing_cycle_anchor = v_anchor,
      billing_status = 'activo'
  where id = p_clinic;

  insert into audit_logs (clinic_id, action, entity_type, entity_id, metadata)
  values (p_clinic, 'subscription.renewed', 'clinic', p_clinic, jsonb_build_object(
    'plan', v_clinic.plan,
    'period_end_from', p_charged_period_end,
    'period_end_to', v_period_end,
    'reanchored', v_reanchored
  ));

  return v_period_end;
end;
$$;

/**
 * Termina la suscripción: plan Free, sin período pagado y sin token de cobro.
 * Uso interno (cancelación inmediata y barrido). No toca ningún dato clínico
 * ni de la cuenta: la clínica sigue entrando y viendo todo lo que tiene.
 */
create or replace function end_subscription(
  p_clinic uuid,
  p_reason text,
  p_actor uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic clinics%rowtype;
begin
  select * into v_clinic from clinics where id = p_clinic for update;
  if not found then
    return;
  end if;

  update clinics
  set plan = 'free',
      billing_status = 'sin_configurar',
      current_period_end = null,
      -- El token solo sirve para renovar esta suscripción. Terminada, guardarlo
      -- no tiene finalidad (Ley 1581 de 2012, art. 4, principio de finalidad).
      wompi_payment_source_id_enc = null,
      cancel_at_period_end = false,
      cancel_requested_at = null
  where id = p_clinic;

  insert into audit_logs (clinic_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_clinic, p_actor, 'subscription.ended', 'clinic', p_clinic, jsonb_build_object(
    'previous_plan', v_clinic.plan,
    'reason', p_reason,
    'paid_through', v_clinic.current_period_end
  ));
end;
$$;

/**
 * El admin de la clínica pide cancelar. Devuelve jsonb { status, effective_at }:
 *  · scheduled          conserva el plan hasta effective_at (fin del período pagado)
 *  · already_scheduled  ya estaba pedida; no cambia nada
 *  · ended              no había período pagado vigente (cobro vencido, o plan
 *                       asignado sin pago): no hay nada que conservar y termina ya
 */
create or replace function request_subscription_cancellation()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic clinics%rowtype;
begin
  if auth_role() is distinct from 'admin' then
    raise exception 'No autorizado';
  end if;

  select * into v_clinic from clinics where id = auth_clinic_id() for update;
  if not found then
    raise exception 'No autorizado';
  end if;

  if v_clinic.plan = 'free' then
    raise exception 'La clínica no tiene una suscripción que cancelar';
  end if;

  if v_clinic.cancel_at_period_end then
    return jsonb_build_object('status', 'already_scheduled', 'effective_at', v_clinic.current_period_end);
  end if;

  if v_clinic.current_period_end is not null and v_clinic.current_period_end > now() then
    update clinics
    set cancel_at_period_end = true,
        cancel_requested_at = now()
    where id = v_clinic.id;

    insert into audit_logs (clinic_id, actor_id, action, entity_type, entity_id, metadata)
    values (v_clinic.id, auth.uid(), 'subscription.cancel_requested', 'clinic', v_clinic.id,
            jsonb_build_object('plan', v_clinic.plan, 'effective_at', v_clinic.current_period_end));

    return jsonb_build_object('status', 'scheduled', 'effective_at', v_clinic.current_period_end);
  end if;

  perform end_subscription(v_clinic.id, 'cancelada_sin_periodo_vigente', auth.uid());
  return jsonb_build_object('status', 'ended', 'effective_at', now());
end;
$$;

/**
 * Deshace una cancelación pedida mientras el período pagado siga vigente.
 * Devuelve jsonb { status }: reverted | not_scheduled | too_late.
 */
create or replace function revert_subscription_cancellation()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic clinics%rowtype;
begin
  if auth_role() is distinct from 'admin' then
    raise exception 'No autorizado';
  end if;

  select * into v_clinic from clinics where id = auth_clinic_id() for update;
  if not found then
    raise exception 'No autorizado';
  end if;

  if not v_clinic.cancel_at_period_end then
    return jsonb_build_object('status', 'not_scheduled');
  end if;

  if v_clinic.current_period_end is null or v_clinic.current_period_end <= now() then
    return jsonb_build_object('status', 'too_late');
  end if;

  update clinics
  set cancel_at_period_end = false,
      cancel_requested_at = null
  where id = v_clinic.id;

  insert into audit_logs (clinic_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_clinic.id, auth.uid(), 'subscription.cancel_reverted', 'clinic', v_clinic.id,
          jsonb_build_object('plan', v_clinic.plan, 'period_end', v_clinic.current_period_end));

  return jsonb_build_object('status', 'reverted', 'period_end', v_clinic.current_period_end);
end;
$$;

/** Barrido: pasa a Free las suscripciones canceladas cuyo período ya terminó.
 *  Devuelve cuántas terminó. Idempotente: al terminar se apaga la marca. */
create or replace function end_canceled_subscriptions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic uuid;
  v_count integer := 0;
begin
  for v_clinic in
    select id from clinics
    where cancel_at_period_end
      and current_period_end <= now()
    for update skip locked
  loop
    perform end_subscription(v_clinic, 'cancelacion_al_final_del_periodo');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;


-- ── 6. Permisos ─────────────────────────────────────────────────────────────
-- Postgres concede EXECUTE a PUBLIC en cada función nueva: se revoca todo y se
-- concede solo lo que se usa. service_role se otorga EXPLÍCITAMENTE por lo
-- mismo que la 0038 y la 0040: un stack recién provisionado no siempre replica
-- los privilegios por defecto de Supabase Cloud.

revoke all on function add_billing_months(timestamptz, integer) from public, anon, authenticated;
revoke all on function billing_cycle_bounds(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function clinic_cycle_start(uuid) from public, anon, authenticated;
revoke all on function billing_grace_period() from public, anon, authenticated;
revoke all on function activate_subscription(uuid, clinic_plan, text) from public, anon, authenticated;
revoke all on function renew_subscription_period(uuid, timestamptz) from public, anon, authenticated;
revoke all on function end_subscription(uuid, text, uuid) from public, anon, authenticated;
revoke all on function end_canceled_subscriptions() from public, anon, authenticated;
revoke all on function request_subscription_cancellation() from public, anon;
revoke all on function revert_subscription_cancellation() from public, anon;

-- El cálculo del ciclo se expone a service_role para que las pruebas lo
-- comparen con lib/dates.ts; no toca datos.
grant execute on function add_billing_months(timestamptz, integer) to service_role;
grant execute on function billing_cycle_bounds(timestamptz, timestamptz) to service_role;
grant execute on function activate_subscription(uuid, clinic_plan, text) to service_role;
grant execute on function renew_subscription_period(uuid, timestamptz) to service_role;
grant execute on function end_canceled_subscriptions() to service_role;
grant execute on function request_subscription_cancellation() to authenticated;
grant execute on function revert_subscription_cancellation() to authenticated;


-- ── 7. Barrido ──────────────────────────────────────────────────────────────
-- Cada hora y no a diario: el período pagado termina a la hora en que se pagó,
-- no a medianoche. Con un barrido diario la clínica conservaría hasta ~24 h de
-- plan que ya no pagó.
select cron.schedule(
  'end-canceled-subscriptions',
  '15 * * * *',
  'select end_canceled_subscriptions()'
);

create index clinics_cancel_due_idx
  on clinics (current_period_end)
  where cancel_at_period_end;

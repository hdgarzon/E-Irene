-- ============================================================================
-- Cambios de plan a mitad de ciclo: upgrade con prorrateo y downgrade programado.
-- Diseño: docs/superpowers/specs/2026-09-15-cambios-de-plan-y-adicionales-design.md
--
-- QUÉ CORRIGE
--
-- 1. Pagar otro plan reiniciaba el ciclo. activate_subscription (0041) ancla el
--    ciclo al momento del pago: la clínica perdía lo que quedaba del período ya
--    pagado, la cuota volvía a cero y la fecha de renovación se corría.
--
-- 2. Bajar de plan pago no existía como tal: se pagaba el plan menor completo y
--    empezaba un ciclo nuevo en ese instante.
--
-- 3. Una compra aprobada no se podía reintentar. El webhook registraba el evento
--    en billing_events y DESPUÉS activaba; si la activación fallaba, el reintento
--    de Wompi veía el evento ya registrado y nunca activaba. Con más tipos de
--    compra el hueco crece, así que se cierra antes.
--
-- CÓMO FUNCIONA
--
--   · billing_checkouts distingue el tipo de compra (kind). Wompi reescribe la
--     referencia de los payment links, así que esa fila es lo único que dice qué
--     se compró; hasta ahora toda fila era la compra de un plan.
--   · billing_fulfillments registra, por transacción, si el pago se aplicó o se
--     rechazó. Cada función de cumplimiento bloquea la clínica, consulta ese
--     registro y aplica en la MISMA transacción: si algo falla no queda nada
--     escrito y el reintento vuelve a intentarlo; si ya se aplicó, no se repite.
--   · Upgrade: se cobra la diferencia prorrateada con un link. Al aprobarse, sube
--     el plan sin tocar el ancla ni el fin del período: la fecha de renovación y
--     lo consumido en el ciclo se conservan.
--   · Downgrade: se programa en clinics.scheduled_plan y lo aplica la renovación,
--     que cobra el precio del plan menor. No se borra nada ni se quita acceso.
-- ============================================================================


-- ── 1. Tipo de compra en los checkouts ──────────────────────────────────────

alter table billing_checkouts
  add column kind text not null default 'plan',
  add column quantity integer,
  add column details jsonb not null default '{}'::jsonb,
  add column expires_at timestamptz;

alter table billing_checkouts
  add constraint billing_checkouts_kind_check
    check (kind in ('plan', 'upgrade', 'transcription_pack', 'video_pack'));

comment on column billing_checkouts.kind is
  'Qué se compra con el link: plan (suscripción nueva), upgrade (diferencia prorrateada), transcription_pack o video_pack. Wompi no devuelve nuestra referencia en los links: esta columna es la que decide cómo se aplica el pago.';
comment on column billing_checkouts.details is
  'Datos de la cotización que el cumplimiento vuelve a comprobar. Upgrade: from_plan, to_plan, period_end, cycle_start, quoted_at.';


-- ── 2. Cumplimiento idempotente de los pagos ────────────────────────────────

create table billing_fulfillments (
  wompi_transaction_id text primary key,
  clinic_id uuid not null references clinics(id) on delete cascade,
  checkout_id uuid references billing_checkouts(id),
  kind text not null
    check (kind in ('plan', 'upgrade', 'transcription_pack', 'video_pack')),
  outcome text not null check (outcome in ('applied', 'rejected')),
  reason text,
  amount_in_cents bigint not null,
  created_at timestamptz not null default now()
);

create index billing_fulfillments_clinic_idx on billing_fulfillments(clinic_id, created_at desc);

alter table billing_fulfillments enable row level security;

-- Lectura para el admin de la clínica (historial de compras). Las escrituras
-- solo las hacen las funciones de cumplimiento.
create policy billing_fulfillments_select on billing_fulfillments
  for select using (clinic_id = auth_clinic_id() and auth_role() = 'admin');

revoke insert, update, delete on table billing_fulfillments from anon, authenticated;
grant select on table billing_fulfillments to service_role;

create or replace function block_billing_fulfillments_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'billing_fulfillments es inmutable: UPDATE/DELETE no permitido';
end; $$;

create trigger trg_billing_fulfillments_immutable
  before update or delete on billing_fulfillments
  for each row execute function block_billing_fulfillments_mutation();


-- ── 3. Downgrade programado ─────────────────────────────────────────────────

alter table clinics
  add column scheduled_plan clinic_plan,
  add column scheduled_plan_requested_at timestamptz;

alter table clinics
  add constraint clinics_scheduled_plan_paid_check
    check (scheduled_plan is null or scheduled_plan in ('esencial', 'pro', 'clinica'));

comment on column clinics.scheduled_plan is
  'Plan pago menor que rige desde la próxima renovación: el cobro recurrente cobra su precio y renew_subscription_period lo aplica. null si no hay cambio programado.';
comment on column clinics.scheduled_plan_requested_at is
  'Cuándo se programó el cambio vigente. El historial completo está en audit_logs.';


-- ── 4. Funciones de cumplimiento ────────────────────────────────────────────

/**
 * Registra un pago aprobado que no se puede aplicar y deja constancia para
 * reembolsarlo o aplicarlo a mano. Uso interno: lo llaman las funciones de
 * cumplimiento con la clínica ya bloqueada.
 */
create or replace function reject_billing_payment(
  p_clinic uuid,
  p_transaction_id text,
  p_checkout_id uuid,
  p_kind text,
  p_amount bigint,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into billing_fulfillments
    (wompi_transaction_id, clinic_id, checkout_id, kind, outcome, reason, amount_in_cents)
  values
    -- Un checkout inexistente no puede quedar referenciado (FK): se registra sin él
    -- y su id queda en audit_logs. Lanzar aquí haría reintentar el pago sin fin.
    (p_transaction_id, p_clinic, (select id from billing_checkouts where id = p_checkout_id),
     p_kind, 'rejected', p_reason, p_amount);

  insert into audit_logs (clinic_id, action, entity_type, entity_id, metadata)
  values (p_clinic, 'billing.payment_rejected', 'clinic', p_clinic, jsonb_build_object(
    'kind', p_kind,
    'reason', p_reason,
    'amount_in_cents', p_amount,
    'transaction_id', p_transaction_id,
    'checkout_id', p_checkout_id
  ));

  return jsonb_build_object('outcome', 'rejected', 'reason', p_reason, 'already_processed', false);
end;
$$;

/**
 * Pago aprobado de un plan por checkout (suscripción nueva): valida el monto y
 * activa con activate_subscription, una sola vez por transacción.
 *
 * p_expected_amount es el precio del plan en lib/plans.ts, la única fuente de
 * precios; null o 0 = el plan no se vende por la app. Los argumentos que pueden
 * faltar van al final con default: se llaman por nombre desde la API.
 */
create or replace function fulfill_plan_purchase(
  p_clinic uuid,
  p_transaction_id text,
  p_plan clinic_plan,
  p_amount bigint,
  -- null si el pago se resolvió por nuestra referencia, sin fila de checkout.
  p_checkout_id uuid default null,
  p_expected_amount bigint default null,
  p_payment_source_enc text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing billing_fulfillments%rowtype;
  v_period_end timestamptz;
begin
  -- Bloquear la clínica serializa los cumplimientos del mismo pago que llegan a
  -- la vez (webhook y reconciliación al volver del checkout).
  perform 1 from clinics where id = p_clinic for update;
  if not found then
    raise exception 'fulfill_plan_purchase: clínica inexistente %', p_clinic;
  end if;

  select * into v_existing from billing_fulfillments where wompi_transaction_id = p_transaction_id;
  if found then
    return jsonb_build_object(
      'outcome', v_existing.outcome, 'reason', v_existing.reason, 'already_processed', true
    );
  end if;

  if p_checkout_id is not null and not exists (
    select 1 from billing_checkouts
    where id = p_checkout_id and clinic_id = p_clinic and kind = 'plan'
  ) then
    return reject_billing_payment(p_clinic, p_transaction_id, p_checkout_id, 'plan', p_amount,
                                  'checkout_no_corresponde');
  end if;

  if p_plan = 'free' or p_expected_amount is null or p_expected_amount <= 0 then
    return reject_billing_payment(p_clinic, p_transaction_id, p_checkout_id, 'plan', p_amount,
                                  'plan_sin_precio_fijo');
  end if;

  if p_amount <> p_expected_amount then
    return reject_billing_payment(p_clinic, p_transaction_id, p_checkout_id, 'plan', p_amount,
                                  'monto_no_coincide_con_el_plan');
  end if;

  v_period_end := activate_subscription(p_clinic, p_plan, p_payment_source_enc);

  insert into billing_fulfillments
    (wompi_transaction_id, clinic_id, checkout_id, kind, outcome, amount_in_cents)
  values
    (p_transaction_id, p_clinic, p_checkout_id, 'plan', 'applied', p_amount);

  return jsonb_build_object(
    'outcome', 'applied', 'plan', p_plan, 'period_end', v_period_end, 'already_processed', false
  );
end;
$$;

/**
 * Pago aprobado de la diferencia prorrateada de un upgrade. Sube el plan SIN
 * tocar el ancla ni el fin del período: la fecha de renovación y lo consumido
 * en el ciclo se conservan, y los límites del plan nuevo rigen desde ya.
 *
 * Se rechaza (y queda para reembolso) si desde la cotización cambió el plan o el
 * período, o si el monto no es el cotizado. Pagar un plan mayor anula una
 * cancelación pedida y un downgrade programado: es la decisión contraria.
 */
create or replace function apply_plan_upgrade(
  p_clinic uuid,
  p_transaction_id text,
  p_checkout_id uuid,
  p_amount bigint,
  p_payment_source_enc text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic clinics%rowtype;
  v_checkout billing_checkouts%rowtype;
  v_existing billing_fulfillments%rowtype;
  v_from clinic_plan;
  v_to clinic_plan;
  v_quoted_period_end timestamptz;
  v_reason text;
begin
  select * into v_clinic from clinics where id = p_clinic for update;
  if not found then
    raise exception 'apply_plan_upgrade: clínica inexistente %', p_clinic;
  end if;

  select * into v_existing from billing_fulfillments where wompi_transaction_id = p_transaction_id;
  if found then
    return jsonb_build_object(
      'outcome', v_existing.outcome, 'reason', v_existing.reason, 'already_processed', true
    );
  end if;

  select * into v_checkout from billing_checkouts where id = p_checkout_id;

  if not found or v_checkout.clinic_id <> p_clinic or v_checkout.kind <> 'upgrade' then
    v_reason := 'checkout_no_corresponde';
  else
    v_from := (v_checkout.details->>'from_plan')::clinic_plan;
    v_to := (v_checkout.details->>'to_plan')::clinic_plan;
    v_quoted_period_end := (v_checkout.details->>'period_end')::timestamptz;

    if p_amount <> v_checkout.amount_in_cents then
      v_reason := 'monto_no_coincide_con_la_cotizacion';
    elsif v_clinic.plan <> v_from then
      v_reason := 'el_plan_cambio_desde_la_cotizacion';
    elsif v_clinic.current_period_end is distinct from v_quoted_period_end then
      v_reason := 'el_periodo_cambio_desde_la_cotizacion';
    elsif v_clinic.current_period_end <= now() then
      v_reason := 'el_periodo_ya_termino';
    -- El orden del enum clinic_plan es el de los planes: free < esencial < pro
    -- < clinica < enterprise (0053 agregó esencial antes de pro).
    elsif v_to not in ('esencial', 'pro', 'clinica') or v_to <= v_from then
      v_reason := 'no_es_un_upgrade';
    end if;
  end if;

  if v_reason is not null then
    return reject_billing_payment(p_clinic, p_transaction_id, p_checkout_id, 'upgrade', p_amount,
                                  v_reason);
  end if;

  update clinics
  set plan = v_to,
      cancel_at_period_end = false,
      cancel_requested_at = null,
      scheduled_plan = null,
      scheduled_plan_requested_at = null,
      -- Sin token nuevo se conserva el anterior: es el que cobra la renovación.
      wompi_payment_source_id_enc = coalesce(p_payment_source_enc, wompi_payment_source_id_enc)
  where id = p_clinic;

  insert into audit_logs (clinic_id, action, entity_type, entity_id, metadata)
  values (p_clinic, 'subscription.upgraded', 'clinic', p_clinic, jsonb_build_object(
    'from_plan', v_from,
    'to_plan', v_to,
    'amount_in_cents', p_amount,
    'period_end', v_clinic.current_period_end,
    'transaction_id', p_transaction_id,
    'superseded_cancellation', v_clinic.cancel_at_period_end,
    'superseded_downgrade', v_clinic.scheduled_plan
  ));

  insert into billing_fulfillments
    (wompi_transaction_id, clinic_id, checkout_id, kind, outcome, amount_in_cents)
  values
    (p_transaction_id, p_clinic, p_checkout_id, 'upgrade', 'applied', p_amount);

  return jsonb_build_object(
    'outcome', 'applied', 'plan', v_to, 'period_end', v_clinic.current_period_end,
    'already_processed', false
  );
end;
$$;


-- ── 5. Programar y anular un downgrade ──────────────────────────────────────

/**
 * El admin de la clínica programa bajar a un plan pago menor desde la próxima
 * renovación. Devuelve jsonb { status, effective_at }:
 *  · scheduled / already_scheduled  rige desde effective_at (fin del período)
 *  · invalid_plan                   el destino no es un plan pago
 *  · not_a_downgrade                el destino no es menor que el plan actual
 *  · canceling                      hay una cancelación pedida: esa manda
 *  · no_active_period               no hay período pagado vigente que renovar
 */
create or replace function schedule_plan_downgrade(p_plan clinic_plan)
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

  if p_plan not in ('esencial', 'pro', 'clinica') then
    return jsonb_build_object('status', 'invalid_plan');
  end if;
  if v_clinic.plan not in ('esencial', 'pro', 'clinica') or p_plan >= v_clinic.plan then
    return jsonb_build_object('status', 'not_a_downgrade');
  end if;
  if v_clinic.cancel_at_period_end then
    return jsonb_build_object('status', 'canceling');
  end if;
  if v_clinic.current_period_end is null or v_clinic.current_period_end <= now() then
    return jsonb_build_object('status', 'no_active_period');
  end if;
  if v_clinic.scheduled_plan = p_plan then
    return jsonb_build_object('status', 'already_scheduled', 'effective_at', v_clinic.current_period_end);
  end if;

  update clinics
  set scheduled_plan = p_plan,
      scheduled_plan_requested_at = now()
  where id = v_clinic.id;

  insert into audit_logs (clinic_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_clinic.id, auth.uid(), 'subscription.downgrade_scheduled', 'clinic', v_clinic.id,
          jsonb_build_object(
            'from_plan', v_clinic.plan,
            'to_plan', p_plan,
            'effective_at', v_clinic.current_period_end,
            'replaced', v_clinic.scheduled_plan
          ));

  return jsonb_build_object('status', 'scheduled', 'effective_at', v_clinic.current_period_end);
end;
$$;

/** Anula el downgrade programado. Devuelve jsonb { status }: canceled | not_scheduled. */
create or replace function cancel_scheduled_plan_change()
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

  if v_clinic.scheduled_plan is null then
    return jsonb_build_object('status', 'not_scheduled');
  end if;

  update clinics
  set scheduled_plan = null,
      scheduled_plan_requested_at = null
  where id = v_clinic.id;

  insert into audit_logs (clinic_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_clinic.id, auth.uid(), 'subscription.downgrade_canceled', 'clinic', v_clinic.id,
          jsonb_build_object('plan', v_clinic.plan, 'scheduled_plan', v_clinic.scheduled_plan));

  return jsonb_build_object('status', 'canceled');
end;
$$;


-- ── 6. La renovación aplica el plan cobrado ─────────────────────────────────

/**
 * Cobro recurrente aprobado, con el plan que se cobró. Igual que la versión de
 * dos argumentos (0041) —avanza el período un ciclo, idempotente contra
 * p_charged_period_end— y además:
 *  · si se cobró el plan programado, lo aplica y limpia la programación;
 *  · si se cobró el plan vigente, lo conserva (un downgrade programado después
 *    de reservar el cobro sigue pendiente para la renovación siguiente);
 *  · si el plan cobrado no es ninguno de los dos (la clínica subió de plan
 *    mientras el cobro estaba en curso), conserva el plan vigente —lo pagó— y
 *    deja constancia para cobrar la diferencia a mano.
 *
 * La versión de dos argumentos se conserva para el código anterior durante el
 * despliegue: ese código no puede programar downgrades.
 */
create or replace function renew_subscription_period(
  p_clinic uuid,
  p_charged_period_end timestamptz,
  p_charged_plan clinic_plan
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
  v_new_plan clinic_plan;
  v_plan_mismatch boolean := false;
begin
  if p_charged_plan not in ('esencial', 'pro', 'clinica') then
    raise exception 'renew_subscription_period: el plan % no se renueva por cobro', p_charged_plan;
  end if;

  select * into v_clinic from clinics where id = p_clinic for update;
  if not found then
    raise exception 'renew_subscription_period: clínica inexistente %', p_clinic;
  end if;

  if v_clinic.current_period_end is distinct from p_charged_period_end then
    return null;
  end if;

  if p_charged_period_end is not null
     and p_charged_period_end >= now() - billing_grace_period() then
    v_anchor := v_clinic.billing_cycle_anchor;
    select b.cycle_end into v_period_end
    from billing_cycle_bounds(v_anchor, p_charged_period_end) b;
  else
    v_anchor := date_trunc('second', now());
    v_period_end := add_billing_months(v_anchor, 1);
    v_reanchored := true;
  end if;

  if p_charged_plan = v_clinic.plan or p_charged_plan = v_clinic.scheduled_plan then
    v_new_plan := p_charged_plan;
  else
    v_new_plan := v_clinic.plan;
    v_plan_mismatch := true;
  end if;

  update clinics
  set current_period_end = v_period_end,
      billing_cycle_anchor = v_anchor,
      billing_status = 'activo',
      plan = v_new_plan,
      scheduled_plan = case when scheduled_plan = v_new_plan then null else scheduled_plan end,
      scheduled_plan_requested_at =
        case when scheduled_plan = v_new_plan then null else scheduled_plan_requested_at end
  where id = p_clinic;

  insert into audit_logs (clinic_id, action, entity_type, entity_id, metadata)
  values (p_clinic, 'subscription.renewed', 'clinic', p_clinic, jsonb_build_object(
    'plan', v_new_plan,
    'previous_plan', v_clinic.plan,
    'charged_plan', p_charged_plan,
    'downgrade_applied', v_clinic.scheduled_plan = v_new_plan and v_clinic.plan <> v_new_plan,
    'period_end_from', p_charged_period_end,
    'period_end_to', v_period_end,
    'reanchored', v_reanchored
  ));

  if v_plan_mismatch then
    insert into audit_logs (clinic_id, action, entity_type, entity_id, metadata)
    values (p_clinic, 'subscription.renewal_plan_mismatch', 'clinic', p_clinic, jsonb_build_object(
      'charged_plan', p_charged_plan,
      'kept_plan', v_clinic.plan,
      'period_end_to', v_period_end,
      'action', 'se cobró un plan distinto del vigente: cobrar o reembolsar la diferencia a mano'
    ));
  end if;

  return v_period_end;
end;
$$;


-- ── 7. Lo que limpia un cambio programado ───────────────────────────────────
-- Mismas funciones de 0041 y 0054, con la limpieza de scheduled_plan agregada.

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
      -- Una suscripción nueva no hereda un cambio programado de la anterior.
      scheduled_plan = null,
      scheduled_plan_requested_at = null,
      wompi_payment_source_id_enc = coalesce(p_payment_source_enc, wompi_payment_source_id_enc)
  where id = p_clinic;

  insert into audit_logs (clinic_id, action, entity_type, entity_id, metadata)
  values (p_clinic, 'subscription.activated', 'clinic', p_clinic, jsonb_build_object(
    'plan', p_plan,
    'previous_plan', v_previous.plan,
    'cycle_anchor', v_anchor,
    'period_end', v_period_end,
    'superseded_cancellation', v_previous.cancel_at_period_end,
    'superseded_downgrade', v_previous.scheduled_plan
  ));

  return v_period_end;
end;
$$;

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
      cancel_requested_at = null,
      scheduled_plan = null,
      scheduled_plan_requested_at = null
  where id = p_clinic;

  insert into audit_logs (clinic_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_clinic, p_actor, 'subscription.ended', 'clinic', p_clinic, jsonb_build_object(
    'previous_plan', v_clinic.plan,
    'reason', p_reason,
    'paid_through', v_clinic.current_period_end,
    'discarded_downgrade', v_clinic.scheduled_plan
  ));
end;
$$;

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
    -- Cancelar deja sin efecto un downgrade programado: al fin del período la
    -- clínica pasa a Free, no al plan menor.
    update clinics
    set cancel_at_period_end = true,
        cancel_requested_at = now(),
        scheduled_plan = null,
        scheduled_plan_requested_at = null
    where id = v_clinic.id;

    insert into audit_logs (clinic_id, actor_id, action, entity_type, entity_id, metadata)
    values (v_clinic.id, auth.uid(), 'subscription.cancel_requested', 'clinic', v_clinic.id,
            jsonb_build_object(
              'plan', v_clinic.plan,
              'effective_at', v_clinic.current_period_end,
              'superseded_downgrade', v_clinic.scheduled_plan
            ));

    return jsonb_build_object('status', 'scheduled', 'effective_at', v_clinic.current_period_end);
  end if;

  perform end_subscription(v_clinic.id, 'cancelada_sin_periodo_vigente', auth.uid());
  return jsonb_build_object('status', 'ended', 'effective_at', now());
end;
$$;

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

  -- Asignar un plan desde la consola reemplaza cualquier cambio programado.
  update clinics
  set plan = new_plan::clinic_plan,
      scheduled_plan = null,
      scheduled_plan_requested_at = null
  where id = target_clinic;

  insert into audit_logs (clinic_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_clinic, auth.uid(), 'platform.clinic_plan_changed', 'clinic', target_clinic,
          jsonb_build_object('plan', new_plan));
end; $$;


-- ── 8. Permisos ─────────────────────────────────────────────────────────────
-- create or replace conserva los permisos de las funciones que ya existían.

revoke all on function reject_billing_payment(uuid, text, uuid, text, bigint, text)
  from public, anon, authenticated;
revoke all on function fulfill_plan_purchase(uuid, text, clinic_plan, bigint, uuid, bigint, text)
  from public, anon, authenticated;
revoke all on function apply_plan_upgrade(uuid, text, uuid, bigint, text)
  from public, anon, authenticated;
revoke all on function renew_subscription_period(uuid, timestamptz, clinic_plan)
  from public, anon, authenticated;
revoke all on function schedule_plan_downgrade(clinic_plan) from public, anon;
revoke all on function cancel_scheduled_plan_change() from public, anon;

grant execute on function fulfill_plan_purchase(uuid, text, clinic_plan, bigint, uuid, bigint, text)
  to service_role;
grant execute on function apply_plan_upgrade(uuid, text, uuid, bigint, text) to service_role;
grant execute on function renew_subscription_period(uuid, timestamptz, clinic_plan) to service_role;
grant execute on function schedule_plan_downgrade(clinic_plan) to authenticated;
grant execute on function cancel_scheduled_plan_change() to authenticated;

-- Bolsa de transcripción (punto 7 del listado de cambios de plan).
--
-- 5 horas por $25.000 que se suman al límite del plan hasta el fin del ciclo en
-- que se aprueba el pago. Se pueden comprar varias. El precio que se cobra sale de
-- lib/plans.ts (TRANSCRIPTION_PACK); las horas que se otorgan salen de aquí
-- (transcription_pack_seconds) y tests/transcription-packs.test.ts exige que
-- coincidan.
--
-- Las horas de la bolsa se resuelven dentro de begin_transcription_session, nunca
-- por parámetro: llamar la RPC directo no permite inflar la cuota.
--
-- Diseño: docs/superpowers/specs/2026-09-15-cambios-de-plan-y-adicionales-design.md §4.


-- ── 1. Bolsas ───────────────────────────────────────────────────────────────

create table transcription_packs (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  seconds integer not null check (seconds > 0),
  valid_from timestamptz not null default now(),
  valid_until timestamptz not null,
  source text not null default 'purchase' check (source in ('purchase', 'grant')),
  wompi_transaction_id text unique,
  checkout_id uuid references billing_checkouts(id) on delete set null,
  amount_in_cents bigint,
  created_at timestamptz not null default now(),
  constraint transcription_packs_valid_range check (valid_until > valid_from),
  constraint transcription_packs_purchase_has_payment check (
    source <> 'purchase' or (wompi_transaction_id is not null and amount_in_cents is not null)
  )
);

create index transcription_packs_clinic_valid_idx on transcription_packs (clinic_id, valid_until);

alter table transcription_packs enable row level security;

-- Igual que transcription_usage (0039): sin políticas ni grants para la app. Se lee
-- por get_transcription_usage y se escribe solo por grant_transcription_pack.
revoke all on table transcription_packs from public, anon, authenticated;
grant select on table transcription_packs to service_role;


-- ── 2. Horas vigentes ───────────────────────────────────────────────────────

/** Segundos que otorga una bolsa. Espejo de TRANSCRIPTION_PACK.hours en lib/plans.ts. */
create or replace function transcription_pack_seconds()
returns integer
language sql
immutable
as $$
  select 18000
$$;

/** Segundos de bolsas vigentes ahora: valid_from <= now() < valid_until. */
create or replace function transcription_extra_seconds(p_clinic uuid)
returns bigint
language sql
stable
set search_path = public
as $$
  select coalesce(sum(p.seconds), 0)::bigint
  from transcription_packs p
  where p.clinic_id = p_clinic
    and p.valid_from <= now()
    and now() < p.valid_until;
$$;


-- ── 3. Cumplimiento de la compra ────────────────────────────────────────────

/**
 * Pago aprobado de una bolsa: la otorga una sola vez por transacción
 * (billing_fulfillments, 0056). Vence con el ciclo vigente al aprobarse el pago,
 * el mismo borde en que se reinicia la cuota; si el pago llega ya en el ciclo
 * siguiente (PSE tardío), las horas son de ese ciclo.
 *
 * Se rechaza (y queda para reembolso) si el checkout no es de esta clínica o no es
 * una bolsa, si el monto no es el de la compra, o si la clínica ya no tiene un plan
 * pago con período vigente.
 */
create or replace function grant_transcription_pack(
  p_clinic uuid,
  p_transaction_id text,
  p_checkout_id uuid,
  p_amount bigint
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
  v_cycle_end timestamptz;
  v_seconds integer;
  v_reason text;
begin
  select * into v_clinic from clinics where id = p_clinic for update;
  if not found then
    raise exception 'grant_transcription_pack: clínica inexistente %', p_clinic;
  end if;

  select * into v_existing from billing_fulfillments where wompi_transaction_id = p_transaction_id;
  if found then
    return jsonb_build_object(
      'outcome', v_existing.outcome, 'reason', v_existing.reason, 'already_processed', true
    );
  end if;

  select * into v_checkout from billing_checkouts where id = p_checkout_id;

  if v_clinic.billing_cycle_anchor is not null then
    select b.cycle_end into v_cycle_end
    from billing_cycle_bounds(v_clinic.billing_cycle_anchor, now()) b;
  end if;

  -- v_checkout.id y no FOUND: el select del ciclo de arriba ya lo sobrescribió.
  if v_checkout.id is null
     or v_checkout.clinic_id <> p_clinic or v_checkout.kind <> 'transcription_pack' then
    v_reason := 'checkout_no_corresponde';
  elsif p_amount <> v_checkout.amount_in_cents then
    v_reason := 'monto_no_coincide_con_la_compra';
  elsif coalesce(v_checkout.quantity, 1) <> 1 then
    v_reason := 'cantidad_invalida';
  elsif v_clinic.plan not in ('esencial', 'pro', 'clinica') then
    v_reason := 'el_plan_no_admite_bolsa';
  elsif v_clinic.current_period_end is null or v_clinic.current_period_end <= now()
        or v_cycle_end is null or v_cycle_end <= now() then
    v_reason := 'sin_periodo_vigente';
  end if;

  if v_reason is not null then
    return reject_billing_payment(p_clinic, p_transaction_id, p_checkout_id, 'transcription_pack',
                                  p_amount, v_reason);
  end if;

  v_seconds := transcription_pack_seconds();

  insert into transcription_packs
    (clinic_id, seconds, valid_until, source, wompi_transaction_id, checkout_id, amount_in_cents)
  values
    (p_clinic, v_seconds, v_cycle_end, 'purchase', p_transaction_id, p_checkout_id, p_amount);

  insert into audit_logs (clinic_id, action, entity_type, entity_id, metadata)
  values (p_clinic, 'billing.transcription_pack_granted', 'clinic', p_clinic, jsonb_build_object(
    'plan', v_clinic.plan,
    'seconds', v_seconds,
    'valid_until', v_cycle_end,
    'amount_in_cents', p_amount,
    'transaction_id', p_transaction_id
  ));

  insert into billing_fulfillments
    (wompi_transaction_id, clinic_id, checkout_id, kind, outcome, amount_in_cents)
  values
    (p_transaction_id, p_clinic, p_checkout_id, 'transcription_pack', 'applied', p_amount);

  return jsonb_build_object(
    'outcome', 'applied', 'plan', v_clinic.plan, 'seconds', v_seconds,
    'valid_until', v_cycle_end, 'already_processed', false
  );
end;
$$;


-- ── 4. La cuota suma las bolsas vigentes ────────────────────────────────────
-- Misma firma y comportamiento que 0039; lo nuevo es v_extra.

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
  v_extra bigint;
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
      'used_seconds', transcription_seconds_used(v_clinic),
      'extra_seconds', transcription_extra_seconds(v_clinic)
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
  -- Las bolsas vigentes se resuelven aquí, no por parámetro.
  v_extra := transcription_extra_seconds(v_clinic);

  if p_limit_seconds is not null and v_used >= p_limit_seconds + v_extra then
    return jsonb_build_object('allowed', false, 'used_seconds', v_used, 'extra_seconds', v_extra);
  end if;

  insert into transcription_usage (clinic_id, consultation_id)
  values (v_clinic, p_consultation_id)
  on conflict (consultation_id) do nothing;

  return jsonb_build_object('allowed', true, 'used_seconds', v_used, 'extra_seconds', v_extra);
end;
$$;

-- Misma forma que 0041, con las horas adicionales vigentes y su vencimiento.
create or replace function get_transcription_usage()
returns jsonb
language sql
stable
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
    ),
    'extra_seconds', transcription_extra_seconds(auth_clinic_id()),
    'extra_valid_until', (
      select max(p.valid_until)
      from transcription_packs p
      where p.clinic_id = auth_clinic_id()
        and p.valid_from <= now()
        and now() < p.valid_until
    )
  );
$$;


-- ── 5. Permisos ─────────────────────────────────────────────────────────────
-- create or replace conserva los permisos de begin_transcription_session y
-- get_transcription_usage (0039).

revoke all on function transcription_extra_seconds(uuid) from public, anon, authenticated;
revoke all on function transcription_pack_seconds() from public, anon, authenticated;
revoke all on function grant_transcription_pack(uuid, text, uuid, bigint)
  from public, anon, authenticated;

grant execute on function grant_transcription_pack(uuid, text, uuid, bigint) to service_role;
grant execute on function transcription_pack_seconds() to service_role;

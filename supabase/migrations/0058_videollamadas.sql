-- Videollamadas: saldo, packs, reserva al iniciar y descuento cuando el paciente se
-- conecta (puntos 8 y 9 del listado de cambios de plan).
--
-- · Free no tiene video; Esencial, Profesional y Clínica lo compran como adicional;
--   Enterprise lo incluye. Ese flag vive en lib/plans.ts (PLANS[plan].video): la
--   base no decide quién necesita saldo, lleva el saldo y lo protege.
-- · Packs de 1, 5 y 10 videollamadas a $9.000 cada una. No vencen.
-- · Iniciar exige saldo disponible y deja una reserva. Se descuenta una sola vez por
--   consulta, cuando Daily avisa que el paciente se conectó o, si ese aviso se
--   pierde, cuando la API de reuniones lo confirma al finalizar. Sin confirmación la
--   reserva se libera: ante la duda, no se cobra.
--
-- Diseño: docs/superpowers/specs/2026-09-15-cambios-de-plan-y-adicionales-design.md §5.


-- ── 1. Saldo ────────────────────────────────────────────────────────────────

create table video_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  delta integer not null check (delta <> 0),
  reason text not null check (reason in ('purchase', 'consumption', 'adjustment')),
  wompi_transaction_id text unique,
  checkout_id uuid references billing_checkouts(id) on delete set null,
  -- Sin FK a consultations, igual que transcription_usage (0039): la retención
  -- borra consultas y el movimiento de saldo debe sobrevivir. UNIQUE: una
  -- consulta nunca descuenta dos veces.
  consultation_id uuid unique,
  actor_id uuid references users(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  constraint video_credit_ledger_purchase
    check (reason <> 'purchase' or (delta > 0 and wompi_transaction_id is not null)),
  constraint video_credit_ledger_consumption
    check (reason <> 'consumption' or (delta = -1 and consultation_id is not null)),
  constraint video_credit_ledger_adjustment
    check (reason <> 'adjustment' or length(btrim(coalesce(note, ''))) >= 5)
);

create index video_credit_ledger_clinic_idx on video_credit_ledger (clinic_id, created_at desc);

alter table video_credit_ledger enable row level security;

-- Sin políticas ni grants para la app: el saldo se lee por get_video_credits y se
-- escribe solo por las funciones de abajo.
revoke all on table video_credit_ledger from public, anon, authenticated;
grant select on table video_credit_ledger to service_role;

-- Un movimiento no se corrige: se compensa con otro. (DELETE queda para el borrado
-- en cascada de una clínica.)
create or replace function block_video_credit_ledger_update()
returns trigger language plpgsql as $$
begin
  raise exception 'video_credit_ledger es inmutable: un ajuste se registra como un movimiento nuevo';
end; $$;

create trigger trg_video_credit_ledger_immutable
  before update on video_credit_ledger
  for each row execute function block_video_credit_ledger_update();


-- ── 2. Reservas ─────────────────────────────────────────────────────────────

create table video_call_reservations (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  appointment_id uuid not null references appointments(id) on delete cascade,
  -- null entre la reserva y la creación de la consulta (startVideoConsultationAction).
  consultation_id uuid unique references consultations(id) on delete cascade,
  status text not null default 'held' check (status in ('held', 'consumed', 'released')),
  release_reason text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint video_call_reservations_resolved check ((status = 'held') = (resolved_at is null))
);

create index video_call_reservations_clinic_held_idx
  on video_call_reservations (clinic_id) where status = 'held';

-- Una reserva abierta sin consulta por cita: un doble clic no reserva dos veces.
create unique index video_call_reservations_open_per_appointment
  on video_call_reservations (appointment_id) where status = 'held' and consultation_id is null;

alter table video_call_reservations enable row level security;
revoke all on table video_call_reservations from public, anon, authenticated;
grant select on table video_call_reservations to service_role;


-- ── 3. Saldo disponible ─────────────────────────────────────────────────────

/** Precio de una videollamada en centavos. Espejo de VIDEO_CALL_PRICE_IN_CENTS en lib/plans.ts. */
create or replace function video_call_price_cents()
returns bigint language sql immutable as $$
  select 900000::bigint
$$;

/**
 * Plazo para enlazar la reserva con su consulta. Pasado, la reserva es un inicio que
 * falló a mitad de camino y no retiene saldo.
 */
create or replace function video_reservation_attach_timeout()
returns interval language sql immutable as $$
  select interval '15 minutes'
$$;

create or replace function video_credit_balance(p_clinic uuid)
returns bigint
language sql
stable
set search_path = public
as $$
  select coalesce(sum(delta), 0)::bigint from video_credit_ledger where clinic_id = p_clinic;
$$;

/** Reservas que retienen saldo: recién hechas, o de una consulta que sigue en curso. */
create or replace function video_credits_held(p_clinic uuid)
returns bigint
language sql
stable
set search_path = public
as $$
  select count(*)::bigint
  from video_call_reservations r
  left join consultations c on c.id = r.consultation_id
  where r.clinic_id = p_clinic
    and r.status = 'held'
    and (
      (r.consultation_id is null and r.created_at > now() - video_reservation_attach_timeout())
      or c.status = 'in_progress'
    );
$$;

/** Saldo de la clínica de la sesión: comprado − consumido, y lo retenido por reservas. */
create or replace function get_video_credits()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'balance', video_credit_balance(auth_clinic_id()),
    'held', video_credits_held(auth_clinic_id()),
    'available', video_credit_balance(auth_clinic_id()) - video_credits_held(auth_clinic_id())
  );
$$;


-- ── 4. Compra ───────────────────────────────────────────────────────────────

/**
 * Pago aprobado de un pack: suma la cantidad al saldo una sola vez por transacción
 * (billing_fulfillments, 0056). Se rechaza (y queda para reembolso) si el checkout
 * no es de esta clínica o no es un pack, si la cantidad no es 1, 5 o 10, si el monto
 * no es cantidad × precio, o si el plan no compra video como adicional.
 */
create or replace function grant_video_pack(
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
  v_reason text;
begin
  select * into v_clinic from clinics where id = p_clinic for update;
  if not found then
    raise exception 'grant_video_pack: clínica inexistente %', p_clinic;
  end if;

  select * into v_existing from billing_fulfillments where wompi_transaction_id = p_transaction_id;
  if found then
    return jsonb_build_object(
      'outcome', v_existing.outcome, 'reason', v_existing.reason, 'already_processed', true
    );
  end if;

  select * into v_checkout from billing_checkouts where id = p_checkout_id;

  if v_checkout.id is null
     or v_checkout.clinic_id <> p_clinic or v_checkout.kind <> 'video_pack' then
    v_reason := 'checkout_no_corresponde';
  elsif v_checkout.quantity is null or v_checkout.quantity not in (1, 5, 10) then
    v_reason := 'cantidad_invalida';
  elsif p_amount <> v_checkout.amount_in_cents
        or p_amount <> v_checkout.quantity * video_call_price_cents() then
    v_reason := 'monto_no_coincide_con_la_compra';
  elsif v_clinic.plan not in ('esencial', 'pro', 'clinica') then
    v_reason := 'el_plan_no_admite_video';
  end if;

  if v_reason is not null then
    return reject_billing_payment(p_clinic, p_transaction_id, p_checkout_id, 'video_pack',
                                  p_amount, v_reason);
  end if;

  insert into video_credit_ledger (clinic_id, delta, reason, wompi_transaction_id, checkout_id)
  values (p_clinic, v_checkout.quantity, 'purchase', p_transaction_id, p_checkout_id);

  insert into audit_logs (clinic_id, action, entity_type, entity_id, metadata)
  values (p_clinic, 'billing.video_pack_granted', 'clinic', p_clinic, jsonb_build_object(
    'plan', v_clinic.plan,
    'quantity', v_checkout.quantity,
    'amount_in_cents', p_amount,
    'transaction_id', p_transaction_id,
    'balance', video_credit_balance(p_clinic)
  ));

  insert into billing_fulfillments
    (wompi_transaction_id, clinic_id, checkout_id, kind, outcome, amount_in_cents)
  values
    (p_transaction_id, p_clinic, p_checkout_id, 'video_pack', 'applied', p_amount);

  return jsonb_build_object(
    'outcome', 'applied', 'plan', v_clinic.plan, 'quantity', v_checkout.quantity,
    'balance', video_credit_balance(p_clinic), 'already_processed', false
  );
end;
$$;


-- ── 5. Reserva al iniciar ───────────────────────────────────────────────────

/**
 * Reserva una videollamada para iniciar la consulta por video de una cita. Bloquea
 * la clínica: con saldo 1, dos inicios a la vez no pasan los dos. Devuelve jsonb:
 *  · { status: 'reserved', reservation_id, available }  reservada (o la abierta de la cita)
 *  · { status: 'insufficient', available }             sin saldo disponible
 *  · { status: 'not_video' }                           la cita no es por video
 */
create or replace function reserve_video_call(p_appointment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic uuid;
  v_modality text;
  v_reservation uuid;
  v_available bigint;
begin
  select a.clinic_id, a.modality::text into v_clinic, v_modality
  from appointments a
  where a.id = p_appointment_id;

  if v_clinic is null or v_clinic is distinct from auth_clinic_id() then
    raise exception 'No autorizado';
  end if;
  if v_modality <> 'video' then
    return jsonb_build_object('status', 'not_video');
  end if;

  perform 1 from clinics where id = v_clinic for update;

  -- Reservas que ya no retienen saldo se cierran aquí, donde se decide el saldo:
  -- un inicio que nunca enlazó su consulta, o una consulta cerrada cuya reserva no
  -- se resolvió (el cierre falló antes de liberarla). Ninguna se cobra.
  update video_call_reservations
  set status = 'released', resolved_at = now(), release_reason = 'inicio_incompleto'
  where clinic_id = v_clinic
    and status = 'held'
    and consultation_id is null
    and created_at <= now() - video_reservation_attach_timeout();

  update video_call_reservations r
  set status = 'released', resolved_at = now(), release_reason = 'consulta_cerrada_sin_confirmacion'
  from consultations c
  where r.clinic_id = v_clinic
    and r.status = 'held'
    and c.id = r.consultation_id
    and c.status <> 'in_progress';

  select id into v_reservation
  from video_call_reservations
  where appointment_id = p_appointment_id and status = 'held' and consultation_id is null;
  if found then
    return jsonb_build_object(
      'status', 'reserved', 'reservation_id', v_reservation,
      'available', video_credit_balance(v_clinic) - video_credits_held(v_clinic)
    );
  end if;

  v_available := video_credit_balance(v_clinic) - video_credits_held(v_clinic);
  if v_available < 1 then
    return jsonb_build_object('status', 'insufficient', 'available', greatest(v_available, 0));
  end if;

  insert into video_call_reservations (clinic_id, appointment_id)
  values (v_clinic, p_appointment_id)
  returning id into v_reservation;

  insert into audit_logs (clinic_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_clinic, auth.uid(), 'video.call_reserved', 'appointment', p_appointment_id,
          jsonb_build_object('reservation_id', v_reservation, 'available_before', v_available));

  return jsonb_build_object(
    'status', 'reserved', 'reservation_id', v_reservation, 'available', v_available - 1
  );
end;
$$;

/** Enlaza la reserva con la consulta recién creada para su cita. */
create or replace function attach_video_reservation(p_reservation_id uuid, p_consultation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update video_call_reservations r
  set consultation_id = p_consultation_id
  from consultations c
  where r.id = p_reservation_id
    and r.clinic_id = auth_clinic_id()
    and r.status = 'held'
    and r.consultation_id is null
    and c.id = p_consultation_id
    and c.clinic_id = r.clinic_id
    and c.appointment_id = r.appointment_id
    and c.status = 'in_progress';
  return found;
end;
$$;

/** Estado de la reserva de una consulta de la clínica de la sesión, o null si no tiene. */
create or replace function get_video_reservation_status(p_consultation_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select r.status
  from video_call_reservations r
  where r.consultation_id = p_consultation_id and r.clinic_id = auth_clinic_id();
$$;


-- ── 6. Liberación ───────────────────────────────────────────────────────────

/** Libera una reserva que no llegó a enlazar consulta (el inicio falló). */
create or replace function release_video_reservation(p_reservation_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update video_call_reservations
  set status = 'released', resolved_at = now(), release_reason = p_reason
  where id = p_reservation_id
    and clinic_id = auth_clinic_id()
    and status = 'held'
    and consultation_id is null;
  return found;
end;
$$;

/**
 * Libera la reserva de una consulta ya cerrada que no se descontó. Mientras la
 * consulta sigue en curso no libera nada: si no, bastaría liberar antes de que el
 * paciente se conecte para no pagar la videollamada.
 */
create or replace function release_video_call(p_consultation_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update video_call_reservations r
  set status = 'released', resolved_at = now(), release_reason = p_reason
  from consultations c
  where r.consultation_id = p_consultation_id
    and r.clinic_id = auth_clinic_id()
    and r.status = 'held'
    and c.id = r.consultation_id
    and c.status <> 'in_progress';
  return found;
end;
$$;


-- ── 7. Consumo ──────────────────────────────────────────────────────────────

/**
 * El paciente se conectó: descuenta la videollamada de la consulta una sola vez.
 * Solo el servidor (webhook de Daily o cierre de la consulta). Devuelve jsonb:
 *  · consumed          descontada ahora
 *  · already_consumed  ya se había descontado (reconexión, reintento, otra pestaña)
 *  · released          la reserva ya se liberó y la conexión fue posterior: no se cobra
 *  · no_reservation    la consulta no reservó (plan que incluye video, o anterior a 0058)
 *
 * Un aviso que llega tarde, con la reserva ya liberada pero una conexión anterior a
 * la liberación, sí descuenta: el paciente se conectó durante la consulta.
 */
create or replace function consume_video_call(
  p_consultation_id uuid,
  p_source text,
  p_joined_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res video_call_reservations%rowtype;
  v_late boolean := false;
begin
  select * into v_res from video_call_reservations where consultation_id = p_consultation_id;
  if not found then
    return jsonb_build_object('status', 'no_reservation');
  end if;

  perform 1 from clinics where id = v_res.clinic_id for update;
  -- Relectura con la clínica bloqueada: dos avisos a la vez ven el mismo estado.
  select * into v_res from video_call_reservations where id = v_res.id;

  if v_res.status = 'consumed' then
    return jsonb_build_object('status', 'already_consumed');
  end if;

  if v_res.status = 'released' then
    if p_joined_at is null or p_joined_at > v_res.resolved_at then
      insert into audit_logs (clinic_id, action, entity_type, entity_id, metadata)
      values (v_res.clinic_id, 'video.join_after_release', 'consultation', p_consultation_id,
              jsonb_build_object('source', p_source, 'joined_at', p_joined_at,
                                 'released_at', v_res.resolved_at,
                                 'release_reason', v_res.release_reason));
      return jsonb_build_object('status', 'released');
    end if;
    v_late := true;
  end if;

  update video_call_reservations
  set status = 'consumed', resolved_at = now(), release_reason = null
  where id = v_res.id;

  insert into video_credit_ledger (clinic_id, delta, reason, consultation_id, note)
  values (v_res.clinic_id, -1, 'consumption', p_consultation_id, p_source)
  on conflict (consultation_id) do nothing;

  insert into audit_logs (clinic_id, action, entity_type, entity_id, metadata)
  values (v_res.clinic_id, 'video.call_consumed', 'consultation', p_consultation_id,
          jsonb_build_object('appointment_id', v_res.appointment_id, 'source', p_source,
                             'joined_at', p_joined_at, 'late', v_late,
                             'balance', video_credit_balance(v_res.clinic_id)));

  return jsonb_build_object('status', 'consumed', 'balance', video_credit_balance(v_res.clinic_id));
end;
$$;


-- ── 8. Consola de plataforma ────────────────────────────────────────────────

/** Reembolso o cortesía: suma o resta videollamadas con nota obligatoria. */
create or replace function platform_adjust_video_credits(
  target_clinic uuid,
  p_delta integer,
  p_note text
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance bigint;
begin
  if not is_platform_admin() then
    raise exception 'No autorizado';
  end if;
  if p_delta is null or p_delta = 0 or abs(p_delta) > 100 then
    raise exception 'Ajuste inválido: un entero entre -100 y 100, distinto de 0';
  end if;
  if length(btrim(coalesce(p_note, ''))) < 5 then
    raise exception 'El ajuste requiere una nota';
  end if;

  perform 1 from clinics where id = target_clinic for update;
  if not found then
    raise exception 'Clínica inexistente';
  end if;

  v_balance := video_credit_balance(target_clinic) + p_delta;
  if v_balance < 0 then
    raise exception 'El saldo no puede quedar negativo';
  end if;

  insert into video_credit_ledger (clinic_id, delta, reason, actor_id, note)
  values (target_clinic, p_delta, 'adjustment', auth.uid(), btrim(p_note));

  insert into audit_logs (clinic_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_clinic, auth.uid(), 'platform.video_credits_adjusted', 'clinic', target_clinic,
          jsonb_build_object('delta', p_delta, 'note', btrim(p_note), 'balance', v_balance));

  return v_balance;
end;
$$;

/** Saldo de video de las clínicas de una página de la consola (máximo 100, como 0052). */
create or replace function get_platform_video_credits(p_clinic_ids uuid[])
returns table (clinic_id uuid, balance bigint)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not is_platform_admin() then
    raise exception 'No autorizado';
  end if;
  if coalesce(cardinality(p_clinic_ids), 0) > 100 then
    raise exception 'Demasiadas clínicas por consulta (máximo 100)';
  end if;

  return query
  select c.id, video_credit_balance(c.id)
  from clinics c
  where c.id = any(p_clinic_ids);
end; $$;


-- ── 9. Permisos ─────────────────────────────────────────────────────────────

revoke all on function block_video_credit_ledger_update() from public, anon, authenticated;
revoke all on function video_call_price_cents() from public, anon, authenticated;
revoke all on function video_reservation_attach_timeout() from public, anon, authenticated;
revoke all on function video_credit_balance(uuid) from public, anon, authenticated;
revoke all on function video_credits_held(uuid) from public, anon, authenticated;
revoke all on function grant_video_pack(uuid, text, uuid, bigint) from public, anon, authenticated;
revoke all on function consume_video_call(uuid, text, timestamptz) from public, anon, authenticated;

revoke all on function get_video_credits() from public, anon;
revoke all on function reserve_video_call(uuid) from public, anon;
revoke all on function attach_video_reservation(uuid, uuid) from public, anon;
revoke all on function get_video_reservation_status(uuid) from public, anon;
revoke all on function release_video_reservation(uuid, text) from public, anon;
revoke all on function release_video_call(uuid, text) from public, anon;
revoke all on function platform_adjust_video_credits(uuid, integer, text) from public, anon;
revoke all on function get_platform_video_credits(uuid[]) from public, anon;

grant execute on function grant_video_pack(uuid, text, uuid, bigint) to service_role;
grant execute on function consume_video_call(uuid, text, timestamptz) to service_role;
grant execute on function video_call_price_cents() to service_role;

grant execute on function get_video_credits() to authenticated;
grant execute on function reserve_video_call(uuid) to authenticated;
grant execute on function attach_video_reservation(uuid, uuid) to authenticated;
grant execute on function get_video_reservation_status(uuid) to authenticated;
grant execute on function release_video_reservation(uuid, text) to authenticated;
grant execute on function release_video_call(uuid, text) to authenticated;
grant execute on function platform_adjust_video_credits(uuid, integer, text) to authenticated;
grant execute on function get_platform_video_credits(uuid[]) to authenticated;

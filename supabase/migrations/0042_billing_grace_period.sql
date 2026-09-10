-- ============================================================================
-- Período de gracia por impago: 5 días desde el fin del período pagado.
--
-- QUÉ FALTABA
--   Un cobro recurrente fallido solo marcaba billing_status = 'vencido'
--   (markBillingFailed). Nada terminaba la suscripción después: la clínica
--   conservaba el plan pago indefinidamente sin pagarlo, el cron reintentaba el
--   cobro a diario para siempre y la clínica no veía ningún aviso. Lo mismo
--   pasaba, sin siquiera marcarse vencida, con una clínica sin token de cobro.
--
-- CÓMO FUNCIONA
--   · La gracia se cuenta desde current_period_end —hasta donde cubre lo
--     pagado—, no desde el primer intento fallido: el cron empieza a cobrar 3
--     días antes del vencimiento y la clínica tiene derecho a esos días.
--   · Durante la gracia la clínica conserva el plan, el cron sigue reintentando
--     una vez al día y la app muestra el aviso con la fecha límite y la opción
--     de pagar (lib/billing/subscription-state.ts aplica la misma regla).
--   · Vencida la gracia, end_overdue_subscriptions() (pg_cron, cada hora) la
--     pasa a Free con end_subscription (0041): sin período pagado y sin token
--     de cobro. NO se borra ningún dato ni se suspende la cuenta: la clínica
--     sigue entrando y viendo sus historias clínicas y alertas de riesgo. La
--     suspensión sigue siendo una decisión manual de la plataforma.
--   · Aplica a toda suscripción cuyo período terminó sin renovarse, sea cual
--     sea la causa: tarjeta rechazada, error de Wompi o clínica sin token de
--     cobro (a esa, el aviso la lleva a pagar desde la app). No aplica a las
--     canceladas —terminan al fin del período, sin gracia— ni a los planes
--     asignados sin cobro (sin current_period_end).
--   · Ante la duda, no cortar: con un cobro todavía en curso (Nequi o PSE sin
--     desenlace) el barrido la deja pasar, hasta que ese cobro se resuelva o
--     expireStaleProcessingCharges lo dé por fallido.
--
--   El plazo es billing_grace_period() (0041), la misma función que decide si
--   un pago tardío conserva el ciclo en renew_subscription_period.
--
-- CONSTANCIA
--   El primer cobro fallido de cada período queda en audit_logs
--   (subscription.payment_failed) con la fecha límite de la gracia; el paso a
--   Free, como subscription.ended con motivo impago_tras_gracia. Cada intento
--   de cobro ya quedaba en billing_scheduled_charges.
-- ============================================================================


/**
 * Cobro recurrente fallido: marca la suscripción como vencida y deja constancia
 * solo la primera vez en el período (el cron reintenta a diario y cada intento
 * ya queda en billing_scheduled_charges). Devuelve true si este fallo la marcó.
 */
create or replace function mark_subscription_payment_failed(p_clinic uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic clinics%rowtype;
begin
  select * into v_clinic from clinics where id = p_clinic for update;
  if not found then
    raise exception 'mark_subscription_payment_failed: clínica inexistente %', p_clinic;
  end if;

  if v_clinic.billing_status = 'vencido' then
    return false;
  end if;

  update clinics set billing_status = 'vencido' where id = p_clinic;

  insert into audit_logs (clinic_id, action, entity_type, entity_id, metadata)
  values (p_clinic, 'subscription.payment_failed', 'clinic', p_clinic, jsonb_build_object(
    'plan', v_clinic.plan,
    'period_end', v_clinic.current_period_end,
    'grace_ends_at', v_clinic.current_period_end + billing_grace_period(),
    'reason', left(p_reason, 200)
  ));

  return true;
end;
$$;

/**
 * Barrido: pasa a Free las suscripciones cuyo período terminó hace más que la
 * gracia sin renovarse. Devuelve cuántas terminó. Idempotente: una suscripción
 * terminada queda en Free y sin período, fuera del predicado.
 */
create or replace function end_overdue_subscriptions()
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
    select c.id
    from clinics c
    where c.plan <> 'free'
      and not c.cancel_at_period_end
      and c.current_period_end is not null
      and c.current_period_end + billing_grace_period() <= now()
      and not exists (
        select 1
        from billing_scheduled_charges s
        where s.clinic_id = c.id
          and s.status in ('pending', 'processing')
      )
    for update of c skip locked
  loop
    perform end_subscription(v_clinic, 'impago_tras_gracia');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;


-- ── Permisos ────────────────────────────────────────────────────────────────
-- Mismo criterio que 0041: se revoca a los roles de la app y service_role se
-- concede de forma explícita.

revoke all on function mark_subscription_payment_failed(uuid, text) from public, anon, authenticated;
revoke all on function end_overdue_subscriptions() from public, anon, authenticated;

grant execute on function mark_subscription_payment_failed(uuid, text) to service_role;
grant execute on function end_overdue_subscriptions() to service_role;
-- Para que las pruebas comparen el plazo con BILLING_GRACE_DAYS, el que muestra
-- la interfaz (lib/billing/subscription-state.ts). No toca datos.
grant execute on function billing_grace_period() to service_role;


-- ── Barrido ─────────────────────────────────────────────────────────────────
-- Cada hora, como el de cancelaciones (a :15): la gracia vence a la hora en que
-- terminó el período, no a medianoche.
select cron.schedule(
  'end-overdue-subscriptions',
  '45 * * * *',
  'select end_overdue_subscriptions()'
);

create index clinics_overdue_due_idx
  on clinics (current_period_end)
  where plan <> 'free' and not cancel_at_period_end;

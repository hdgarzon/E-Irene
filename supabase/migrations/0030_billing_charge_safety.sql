-- Salvaguardas contra doble cobro en la facturación recurrente.
--
-- PROBLEMA QUE RESUELVE (bug real, verificado contra la BD de producción):
-- `billing_scheduled_charges` se creó con un trigger que bloquea UPDATE, pero
-- el flujo de cobro necesita registrar el resultado de un intento que ya se
-- insertó como 'processing'. Con el trigger tal cual, la secuencia real era:
--   1. Se cobra en Wompi (el dinero SÍ sale de la tarjeta del cliente).
--   2. markScheduledChargeSuccess() lanza excepción (trigger).
--   3. renewBilling() nunca corre → current_period_end no avanza.
--   4. Al día siguiente el cron vuelve a ver la clínica como vencida y
--      COBRA DE NUEVO. Indefinidamente, sin registro de ningún cobro.
--
-- Dos cambios:
--
-- 1. `period_key` + índice único parcial: la base de datos —no el código—
--    garantiza que no puede haber dos cobros simultáneos ni dos cobros
--    exitosos para el mismo período de una misma clínica. Es la única
--    defensa que sobrevive a un bug de lógica, un reintento concurrente del
--    cron, o una doble invocación de Vercel (su entrega es "best effort" y
--    puede duplicar (https://vercel.com/docs/cron-jobs/manage-cron-jobs)).
--
-- 2. Trigger de inmutabilidad más preciso: sigue prohibiendo DELETE y
--    reescribir la historia (montos, clínica, período), pero permite cerrar
--    un intento en curso con su resultado. La bitácora sigue siendo
--    auditable; lo que se bloquea es alterar lo ya liquidado.

alter table billing_scheduled_charges
  add column period_key text not null default to_char(now(), 'YYYY-MM-DD');

comment on column billing_scheduled_charges.period_key is
  'Período de facturación que cubre este cobro (YYYY-MM-DD del current_period_end vigente). Junto con el índice único parcial, impide cobrar dos veces el mismo período.';

-- Un único intento vivo o liquidado con éxito por (clínica, período). Un
-- intento 'failed' sale del índice a propósito: permite reintentar mañana
-- sin permitir jamás dos cobros exitosos del mismo período.
create unique index billing_scheduled_charges_period_unique
  on billing_scheduled_charges(clinic_id, period_key)
  where status in ('pending', 'processing', 'success');

create or replace function block_billing_scheduled_charges_mutation()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'billing_scheduled_charges es inmutable: DELETE no permitido';
  end if;

  -- Solo se puede cerrar un intento en curso, nunca reabrir ni reescribir
  -- uno ya liquidado (evita, por ejemplo, marcar como 'failed' un cobro que
  -- el cliente sí pagó, o revivir un cobro para volver a ejecutarlo).
  if old.status not in ('pending', 'processing') then
    raise exception 'billing_scheduled_charges: un cobro en estado % ya está liquidado y no se puede modificar', old.status;
  end if;

  -- Los datos económicos y de identidad del cobro son inmutables incluso
  -- mientras está en curso: lo único que puede cambiar es su desenlace.
  if new.clinic_id is distinct from old.clinic_id
     or new.plan is distinct from old.plan
     or new.amount_in_cents is distinct from old.amount_in_cents
     or new.due_at is distinct from old.due_at
     or new.period_key is distinct from old.period_key
     or new.created_at is distinct from old.created_at then
    raise exception 'billing_scheduled_charges: solo se puede actualizar el desenlace del cobro (status, charged_at, wompi_transaction_id, failure_reason)';
  end if;

  return new;
end; $$;

-- El trigger anterior era FOR EACH ROW sobre update or delete; se recrea para
-- que la función nueva reciba también el caso DELETE con tg_op correcto.
drop trigger if exists trg_billing_scheduled_charges_immutable on billing_scheduled_charges;
create trigger trg_billing_scheduled_charges_immutable
  before update or delete on billing_scheduled_charges
  for each row execute function block_billing_scheduled_charges_mutation();

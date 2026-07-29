-- Fase 1 de facturación real (Wompi): schema + registro de eventos de cobro.
--
-- Wompi no gestiona "suscripciones" como Stripe Billing — tokeniza el medio
-- de pago (tarjeta/Nequi) y nosotros somos responsables de cobrar el token
-- periódicamente (ver Fase 3, cron mensual). Este esquema es la base para
-- eso: estado de facturación por clínica + bitácora inmutable de cada
-- transacción que Wompi nos notifica por webhook.

alter table clinics add column billing_status text not null default 'sin_configurar'
  check (billing_status in ('sin_configurar', 'activo', 'pendiente', 'vencido', 'suspendido'));

-- Referencia al medio de pago tokenizado en Wompi (payment_source_id), NO el
-- número de tarjeta — eso nunca toca nuestros servidores, se queda en Wompi
-- (alcance PCI). Aun así se cifra: es una credencial de cobro capaz de
-- generar cargos, mismo nivel de cuidado que otros secretos de la clínica.
alter table clinics add column wompi_payment_source_id_enc text;

-- Hasta cuándo cubre el último pago aprobado. NULL mientras billing_status
-- sea 'sin_configurar'. Lo usa el cron de Fase 3 para decidir a quién cobrar.
alter table clinics add column current_period_end timestamptz;

-- Bitácora inmutable de cada evento de transacción que Wompi notifica por
-- webhook — igual principio que audit_logs/patient_clinical_state: nunca se
-- edita ni se borra, da trazabilidad completa de cobros para soporte y
-- disputas. Idempotente por (wompi_transaction_id, status): Wompi puede
-- reintentar la entrega del mismo evento, no debe procesarse dos veces: pero
-- una misma transacción sí pasa por varios status reales (PENDING→APPROVED),
-- y cada uno debe quedar registrado.
create table billing_events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  wompi_transaction_id text not null,
  wompi_event text not null,
  status text not null,
  amount_in_cents bigint not null,
  -- Payload completo del webhook, cifrado — soporte/disputas necesitan poder
  -- ver exactamente qué envió Wompi, no solo los campos que decidimos indexar.
  raw_payload_enc text not null,
  created_at timestamptz not null default now(),
  unique (wompi_transaction_id, status)
);

create index billing_events_clinic_idx on billing_events(clinic_id, created_at desc);

alter table billing_events enable row level security;

-- Solo lectura desde la app (admin de la clínica); las escrituras solo las
-- hace el webhook con el cliente service-role, que no pasa por RLS.
create policy billing_events_select on billing_events
  for select using (clinic_id = auth_clinic_id() and auth_role() = 'admin');

create or replace function block_billing_events_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'billing_events es inmutable: UPDATE/DELETE no permitido';
end; $$;

create trigger trg_billing_events_immutable
  before update or delete on billing_events
  for each row execute function block_billing_events_mutation();

-- Fase 3 de facturación: tabla de trazabilidad de cobros recurrentes.
-- Cada intento de cobro mensual queda registrado con su estado. La tabla es
-- inmutable (solo INSERT) para mantener una bitácora completa de intentos.

create table billing_scheduled_charges (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  plan text not null,
  amount_in_cents bigint not null,
  due_at timestamptz not null,
  charged_at timestamptz,
  wompi_transaction_id text,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'success', 'failed')),
  failure_reason text,
  created_at timestamptz not null default now()
);

create index billing_scheduled_charges_due_idx on billing_scheduled_charges(clinic_id, due_at desc);
create index billing_scheduled_charges_status_idx on billing_scheduled_charges(status, due_at);

alter table billing_scheduled_charges enable row level security;

-- Solo lectura para admins de la clínica. Las escrituras las hace el cron
-- con el cliente service-role (sin RLS).
create policy billing_scheduled_charges_select on billing_scheduled_charges
  for select using (clinic_id = auth_clinic_id() and auth_role() = 'admin');

create or replace function block_billing_scheduled_charges_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'billing_scheduled_charges es inmutable: UPDATE/DELETE no permitido';
end; $$;

create trigger trg_billing_scheduled_charges_immutable
  before update or delete on billing_scheduled_charges
  for each row execute function block_billing_scheduled_charges_mutation();

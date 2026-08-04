-- ============================================================================
-- E-Irene — Migración a producción: Facturación Wompi Fase 2-3
-- Fecha: 2026-08-04
-- Rama: feat/telehealth
-- Aplica: 0028_billing_recurring.sql
-- ============================================================================
-- INSTRUCCIONES:
-- 1. Conectá a tu base de datos de producción de Supabase.
-- 2. Corré este archivo completo (por ejemplo, desde el SQL Editor de Supabase
--    o `psql -f deploy/production-migration.sql`).
-- 3. El cron diario se ejecuta vía Vercel Cron Jobs (ver `vercel.json`),
--    NO desde Postgres. No se requiere pg_net ni pg_cron en la DB.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. billing_scheduled_charges — trazabilidad de cobros recurrentes
-- ----------------------------------------------------------------------------

create table if not exists billing_scheduled_charges (
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

create index if not exists billing_scheduled_charges_due_idx
  on billing_scheduled_charges(clinic_id, due_at desc);
create index if not exists billing_scheduled_charges_status_idx
  on billing_scheduled_charges(status, due_at);

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

-- Evitar error si el trigger ya existe
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_billing_scheduled_charges_immutable'
    and tgrelid = 'billing_scheduled_charges'::regclass
  ) then
    create trigger trg_billing_scheduled_charges_immutable
      before update or delete on billing_scheduled_charges
      for each row execute function block_billing_scheduled_charges_mutation();
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 2. Cron diario
-- ----------------------------------------------------------------------------
-- El cron se configura en Vercel (ver `vercel.json`), no en Postgres.
-- Vercel llamará a POST /api/cron/billing todos los días a las 6 AM UTC.
-- El endpoint está protegido por CRON_SECRET.
-- ============================================================================

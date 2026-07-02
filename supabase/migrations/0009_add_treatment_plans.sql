-- ============================================================================
-- Plan de tratamiento por paciente: objetivos y checkpoints con seguimiento
-- de estado. Contenido clínico cifrado (title_enc, description_enc), igual
-- que el resto de campos sensibles.
-- ============================================================================

create table treatment_plans (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  created_by uuid references users(id),
  title_enc text not null,
  status text not null default 'activo' check (status in ('activo', 'completado', 'archivado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index treatment_plans_patient_idx on treatment_plans(patient_id);
create index treatment_plans_clinic_idx on treatment_plans(clinic_id);
create trigger trg_treatment_plans_updated before update on treatment_plans
  for each row execute function set_updated_at();

create table treatment_plan_items (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  plan_id uuid not null references treatment_plans(id) on delete cascade,
  type text not null check (type in ('objetivo', 'checkpoint')),
  description_enc text not null,
  target_date date,
  status text not null default 'pendiente' check (status in ('pendiente', 'logrado')),
  completed_at timestamptz,
  order_index int not null default 0,
  created_at timestamptz not null default now()
);
create index treatment_plan_items_plan_idx on treatment_plan_items(plan_id, order_index);
create index treatment_plan_items_clinic_idx on treatment_plan_items(clinic_id);

alter table treatment_plans enable row level security;
alter table treatment_plan_items enable row level security;

create policy treatment_plans_select on treatment_plans
  for select using (clinic_id = auth_clinic_id());
create policy treatment_plans_insert on treatment_plans
  for insert with check (clinic_id = auth_clinic_id());
create policy treatment_plans_update on treatment_plans
  for update using (clinic_id = auth_clinic_id()) with check (clinic_id = auth_clinic_id());

create policy treatment_plan_items_select on treatment_plan_items
  for select using (clinic_id = auth_clinic_id());
create policy treatment_plan_items_insert on treatment_plan_items
  for insert with check (clinic_id = auth_clinic_id());
create policy treatment_plan_items_update on treatment_plan_items
  for update using (clinic_id = auth_clinic_id()) with check (clinic_id = auth_clinic_id());

-- Ver 0008: el ALTER DEFAULT PRIVILEGES de 0004 no cubre de forma fiable
-- tablas creadas en migraciones posteriores; GRANT explícito.
grant select, insert, update on treatment_plans to authenticated;
grant select, insert, update on treatment_plan_items to authenticated;

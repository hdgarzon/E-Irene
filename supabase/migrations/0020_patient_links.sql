-- ============================================================================
-- patient_links: enlaces únicos con token para que el paciente firme
-- consentimiento o responda escalas psicométricas sin necesitar cuenta.
-- ============================================================================

create table patient_links (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  purpose text not null check (purpose in ('consent', 'assessment')),
  assessment_type text check (assessment_type in ('phq9', 'gad7')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  completed_at timestamptz,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  constraint patient_links_purpose_assessment_type_check
    check (purpose <> 'assessment' or assessment_type is not null)
);
create index patient_links_patient_idx on patient_links(patient_id);
create index patient_links_token_hash_idx on patient_links(token_hash);

alter table patient_links enable row level security;

create policy patient_links_select on patient_links
  for select using (clinic_id = auth_clinic_id());
create policy patient_links_insert on patient_links
  for insert with check (clinic_id = auth_clinic_id());

-- El ALTER DEFAULT PRIVILEGES de 0004_grants.sql no se aplica retroactivamente
-- a la sesión de migración actual (ver 0004/0008/0009): sigue haciendo falta
-- un GRANT explícito por tabla nueva.
grant select, insert on patient_links to authenticated;

-- Trazabilidad: qué link (si alguno) originó cada consentimiento/escala.
alter table consents add column link_id uuid references patient_links(id);
alter table psychometric_assessments add column link_id uuid references patient_links(id);

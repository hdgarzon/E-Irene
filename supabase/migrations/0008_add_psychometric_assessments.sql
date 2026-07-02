-- ============================================================================
-- Escalas psicométricas estandarizadas (PHQ-9, GAD-7) aplicadas al paciente
-- a lo largo del tiempo. Respuestas y puntaje cifrados como el resto de
-- contenido clínico (payload_enc, igual que reports).
-- ============================================================================

create table psychometric_assessments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  created_by uuid references users(id),
  type text not null check (type in ('phq9', 'gad7')),
  payload_enc text not null, -- JSON cifrado: { answers: number[], totalScore, severity }
  administered_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index psychometric_assessments_clinic_idx on psychometric_assessments(clinic_id);
create index psychometric_assessments_patient_idx on psychometric_assessments(patient_id, administered_at);

alter table psychometric_assessments enable row level security;

create policy psychometric_assessments_select on psychometric_assessments
  for select using (clinic_id = auth_clinic_id());
create policy psychometric_assessments_insert on psychometric_assessments
  for insert with check (clinic_id = auth_clinic_id());

-- El ALTER DEFAULT PRIVILEGES de 0004_grants.sql no se aplica retroactivamente
-- a la sesión de migración actual (ver 0004/0005): sigue haciendo falta un
-- GRANT explícito por tabla nueva.
grant select, insert on psychometric_assessments to authenticated;

-- ============================================================================
-- Nota SOAP (Subjetivo / Objetivo / Análisis / Plan) por consulta — formato
-- clínico estándar, complementario al reporte generado por IA, escrito
-- enteramente por el profesional. Contenido cifrado como el resto de
-- datos clínicos.
-- ============================================================================

create table soap_notes (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  consultation_id uuid not null references consultations(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  created_by uuid references users(id),
  subjective_enc text,
  objective_enc text,
  assessment_enc text,
  plan_enc text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (consultation_id)
);
create index soap_notes_clinic_idx on soap_notes(clinic_id);
create index soap_notes_patient_idx on soap_notes(patient_id);
create trigger trg_soap_notes_updated before update on soap_notes
  for each row execute function set_updated_at();

alter table soap_notes enable row level security;

create policy soap_notes_select on soap_notes
  for select using (clinic_id = auth_clinic_id());
create policy soap_notes_insert on soap_notes
  for insert with check (clinic_id = auth_clinic_id());
create policy soap_notes_update on soap_notes
  for update using (clinic_id = auth_clinic_id()) with check (clinic_id = auth_clinic_id());

grant select, insert, update on soap_notes to authenticated;

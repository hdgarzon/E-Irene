-- Estado clínico longitudinal del paciente — append-only, versionado.
--
-- Es el activo central de la Fase 1 del copiloto: cada análisis de sesión ya
-- no solo produce un reporte, actualiza este estado acumulado (objetivos
-- terapéuticos, riesgos activos, temas recurrentes, hipótesis clínicas,
-- técnicas usadas). El reporte de sesión sigue existiendo, pero deja de ser
-- la única salida — ver docs/superpowers/specs/2026-07-24-copiloto-clinico-design.md §2-3.
--
-- Append-only (nunca UPDATE/DELETE), mismo principio que audit_logs: da
-- trazabilidad de cómo evolucionó la comprensión de la IA sobre el paciente,
-- y permite revertir si una versión de modelo/prompt corrompe el estado.

create table patient_clinical_state (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  version int not null,
  -- Consulta que originó esta versión. Único por consulta: es lo que hace
  -- idempotente un reintento del análisis (ver lib/db/clinical-state.ts) —
  -- sin esto, un reintento fusionaría el mismo delta dos veces sobre el estado.
  consultation_id uuid references consultations(id) on delete set null,
  -- JSON cifrado (AES-256-GCM app-layer) del ClinicalState acumulado —
  -- mismo nivel de protección que reports.payload_enc: es contenido clínico
  -- sensible (evidencia con citas textuales del paciente).
  state_enc text not null,
  model text not null,
  prompt_version text not null,
  created_at timestamptz not null default now(),
  unique (patient_id, version),
  unique (consultation_id)
);

-- Es la consulta que hace getLatestClinicalState() en cada análisis.
create index patient_clinical_state_latest_idx on patient_clinical_state(patient_id, version desc);

alter table patient_clinical_state enable row level security;

create policy patient_clinical_state_select on patient_clinical_state
  for select using (clinic_id = auth_clinic_id());
create policy patient_clinical_state_insert on patient_clinical_state
  for insert with check (clinic_id = auth_clinic_id());

-- Inmutable: ni UPDATE ni DELETE, igual que audit_logs. Función dedicada (no
-- se reutiliza block_audit_mutation(), que tiene "audit_logs" hardcodeado en
-- el mensaje de error y confundiría a quien lo vea disparado por esta tabla).
create or replace function block_clinical_state_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'patient_clinical_state es inmutable: UPDATE/DELETE no permitido';
end; $$;

create trigger trg_patient_clinical_state_immutable
  before update or delete on patient_clinical_state
  for each row execute function block_clinical_state_mutation();

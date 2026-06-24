-- ============================================================================
-- E-Irene · Migración inicial: schema multi-tenant + RLS + audit inmutable
-- ============================================================================

-- ── Enums ──────────────────────────────────────────────────────────────────
create type user_role as enum ('admin', 'doctor', 'secretaria', 'paciente');
create type clinic_plan as enum ('free', 'pro', 'clinica', 'enterprise');
create type appointment_status as enum ('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show');
create type consultation_status as enum ('in_progress', 'ended', 'analyzed');
create type notification_channel as enum ('email', 'whatsapp');
create type notification_status as enum ('pending', 'sent', 'failed');

-- ── Trigger genérico de updated_at ──────────────────────────────────────────
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

-- ── Tablas ──────────────────────────────────────────────────────────────────

create table clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  plan clinic_plan not null default 'free',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Perfil de usuario enlazado 1:1 a auth.users
create table users (
  id uuid primary key references auth.users(id) on delete cascade,
  clinic_id uuid not null references clinics(id) on delete cascade,
  role user_role not null default 'doctor',
  full_name text not null,
  email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index users_clinic_idx on users(clinic_id);

create table patients (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  -- PII cifrada (AES-256-GCM a nivel app); se guarda ciphertext.
  full_name_enc text not null,
  document_enc text,
  phone_enc text,
  email_enc text,
  notes_enc text,
  birth_date date,
  gender text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index patients_clinic_idx on patients(clinic_id);

create table consents (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  document_version text not null,
  document_hash text not null,            -- SHA-256 del texto del consentimiento
  signature_path text,                    -- ruta en Storage (firma canvas)
  signer_name text,
  ip text,
  user_agent text,
  signed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index consents_patient_idx on consents(patient_id);

create table appointments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  doctor_id uuid not null references users(id),
  scheduled_at timestamptz not null,
  duration_min int not null default 50,
  status appointment_status not null default 'scheduled',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index appointments_clinic_idx on appointments(clinic_id);
create index appointments_doctor_time_idx on appointments(doctor_id, scheduled_at);

create table consultations (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  doctor_id uuid not null references users(id),
  appointment_id uuid references appointments(id) on delete set null,
  consent_id uuid references consents(id),
  status consultation_status not null default 'in_progress',
  transcript_enc text,                    -- transcripción completa cifrada
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index consultations_clinic_idx on consultations(clinic_id);
create index consultations_patient_idx on consultations(patient_id);

create table transcript_chunks (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  consultation_id uuid not null references consultations(id) on delete cascade,
  seq int not null,
  speaker text,
  text_enc text not null,                 -- fragmento cifrado
  is_final boolean not null default true,
  confidence real,
  ts_ms int,
  created_at timestamptz not null default now()
);
create index transcript_chunks_consultation_idx on transcript_chunks(consultation_id, seq);

create table reports (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  consultation_id uuid not null references consultations(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  payload_enc text not null,              -- JSON del ReportPayload, cifrado
  doctor_edited boolean not null default false,
  doctor_notes_enc text,
  validated_by uuid references users(id),
  validated_at timestamptz,
  pdf_path text,                          -- ruta en Storage
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index reports_consultation_idx on reports(consultation_id);

create table patient_progress (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  consultation_id uuid references consultations(id) on delete set null,
  notes_enc text,
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index patient_progress_patient_idx on patient_progress(patient_id);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  ip text,
  created_at timestamptz not null default now()
);
create index audit_logs_clinic_idx on audit_logs(clinic_id, created_at desc);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  patient_id uuid references patients(id) on delete cascade,
  appointment_id uuid references appointments(id) on delete cascade,
  channel notification_channel not null default 'email',
  type text not null,
  status notification_status not null default 'pending',
  payload jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_clinic_idx on notifications(clinic_id);

create table clinic_doctors (
  clinic_id uuid not null references clinics(id) on delete cascade,
  doctor_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (clinic_id, doctor_id)
);

-- ── Triggers updated_at ─────────────────────────────────────────────────────
create trigger trg_clinics_updated   before update on clinics       for each row execute function set_updated_at();
create trigger trg_users_updated      before update on users         for each row execute function set_updated_at();
create trigger trg_patients_updated   before update on patients      for each row execute function set_updated_at();
create trigger trg_appts_updated      before update on appointments  for each row execute function set_updated_at();
create trigger trg_consults_updated   before update on consultations for each row execute function set_updated_at();
create trigger trg_reports_updated    before update on reports       for each row execute function set_updated_at();

-- ── Audit logs inmutable: bloquea UPDATE/DELETE ─────────────────────────────
create or replace function block_audit_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'audit_logs es inmutable: UPDATE/DELETE no permitido';
end; $$;
create trigger trg_audit_immutable
  before update or delete on audit_logs
  for each row execute function block_audit_mutation();

-- ── Helpers para RLS (SECURITY DEFINER → evitan recursión en users) ─────────
create or replace function auth_clinic_id()
returns uuid language sql stable security definer set search_path = public as $$
  select clinic_id from public.users where id = auth.uid();
$$;

create or replace function auth_role()
returns user_role language sql stable security definer set search_path = public as $$
  select role from public.users where id = auth.uid();
$$;

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table clinics            enable row level security;
alter table users              enable row level security;
alter table patients           enable row level security;
alter table consents           enable row level security;
alter table appointments       enable row level security;
alter table consultations      enable row level security;
alter table transcript_chunks  enable row level security;
alter table reports            enable row level security;
alter table patient_progress   enable row level security;
alter table audit_logs         enable row level security;
alter table notifications      enable row level security;
alter table clinic_doctors     enable row level security;

-- clinics: el usuario ve / edita su propia clínica
create policy clinic_select on clinics for select using (id = auth_clinic_id());
create policy clinic_update on clinics for update using (id = auth_clinic_id() and auth_role() = 'admin');

-- users: ver miembros de la misma clínica; admin gestiona
create policy users_select on users for select using (clinic_id = auth_clinic_id());
create policy users_insert on users for insert with check (clinic_id = auth_clinic_id() and auth_role() = 'admin');
create policy users_update on users for update using (id = auth.uid() or (clinic_id = auth_clinic_id() and auth_role() = 'admin'));
create policy users_delete on users for delete using (clinic_id = auth_clinic_id() and auth_role() = 'admin');

-- Macro de políticas tenant-scoped para tablas de negocio.
-- (Se expanden manualmente porque PL/SQL no permite DDL parametrizado simple aquí.)

-- patients
create policy patients_select on patients for select using (clinic_id = auth_clinic_id());
create policy patients_insert on patients for insert with check (clinic_id = auth_clinic_id());
create policy patients_update on patients for update using (clinic_id = auth_clinic_id());
create policy patients_delete on patients for delete using (clinic_id = auth_clinic_id() and auth_role() in ('admin','doctor'));

-- consents
create policy consents_select on consents for select using (clinic_id = auth_clinic_id());
create policy consents_insert on consents for insert with check (clinic_id = auth_clinic_id());

-- appointments
create policy appts_select on appointments for select using (clinic_id = auth_clinic_id());
create policy appts_insert on appointments for insert with check (clinic_id = auth_clinic_id());
create policy appts_update on appointments for update using (clinic_id = auth_clinic_id());
create policy appts_delete on appointments for delete using (clinic_id = auth_clinic_id());

-- consultations
create policy consults_select on consultations for select using (clinic_id = auth_clinic_id());
create policy consults_insert on consultations for insert with check (clinic_id = auth_clinic_id());
create policy consults_update on consultations for update using (clinic_id = auth_clinic_id());

-- transcript_chunks
create policy chunks_select on transcript_chunks for select using (clinic_id = auth_clinic_id());
create policy chunks_insert on transcript_chunks for insert with check (clinic_id = auth_clinic_id());

-- reports
create policy reports_select on reports for select using (clinic_id = auth_clinic_id());
create policy reports_insert on reports for insert with check (clinic_id = auth_clinic_id());
create policy reports_update on reports for update using (clinic_id = auth_clinic_id());

-- patient_progress
create policy progress_select on patient_progress for select using (clinic_id = auth_clinic_id());
create policy progress_insert on patient_progress for insert with check (clinic_id = auth_clinic_id());
create policy progress_update on patient_progress for update using (clinic_id = auth_clinic_id());

-- audit_logs: SOLO insert (sin políticas de update/delete → denegado; + trigger inmutable)
create policy audit_select on audit_logs for select using (clinic_id = auth_clinic_id());
create policy audit_insert on audit_logs for insert with check (clinic_id = auth_clinic_id());

-- notifications
create policy notif_select on notifications for select using (clinic_id = auth_clinic_id());
create policy notif_insert on notifications for insert with check (clinic_id = auth_clinic_id());
create policy notif_update on notifications for update using (clinic_id = auth_clinic_id());

-- clinic_doctors
create policy clinicdoc_select on clinic_doctors for select using (clinic_id = auth_clinic_id());
create policy clinicdoc_insert on clinic_doctors for insert with check (clinic_id = auth_clinic_id() and auth_role() = 'admin');
create policy clinicdoc_delete on clinic_doctors for delete using (clinic_id = auth_clinic_id() and auth_role() = 'admin');

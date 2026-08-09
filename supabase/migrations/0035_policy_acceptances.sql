-- ============================================================================
-- Prueba de aceptación de la política de tratamiento de datos por parte del
-- profesional.
--
-- Ante un requerimiento de la Superintendencia de Industria y Comercio, la
-- carga de demostrar la autorización recae en el Responsable (Ley 1581 de 2012,
-- art. 9 y Decreto 1074 de 2015). Hasta ahora la plataforma no guardaba ninguna
-- prueba de que el profesional hubiera aceptado nada.
--
-- Mismo esquema probatorio que ya se usa con el consentimiento del paciente
-- (tabla `consents`): versión del documento + huella SHA-256 de su texto + IP +
-- user-agent + marca temporal. El hash es lo que permite demostrar QUÉ texto
-- se aceptó, no solo que se aceptó algo.
-- ============================================================================

create table policy_acceptances (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  document_version text not null,
  document_hash text not null,          -- SHA-256 del texto aceptado
  ip text,
  user_agent text,
  -- La autorización para comunicaciones comerciales va SEPARADA de la
  -- aceptación contractual: agruparlas en una sola casilla vicia el
  -- consentimiento comercial. Se guarda aquí para que quede fechada con la
  -- misma prueba, pero es revocable de forma independiente.
  marketing_opt_in boolean not null default false,
  accepted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index policy_acceptances_user_idx on policy_acceptances(user_id, document_version);
create index policy_acceptances_clinic_idx on policy_acceptances(clinic_id);

comment on table policy_acceptances is
  'Prueba de aceptación de la política de tratamiento. Inmutable: es evidencia, no estado editable.';

-- ── Inmutable ───────────────────────────────────────────────────────────────
-- Igual que audit_logs: una prueba que se puede editar no prueba nada. Si el
-- profesional revoca la autorización comercial, se registra una aceptación
-- nueva; no se reescribe la anterior.
create or replace function block_policy_acceptance_mutation()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'policy_acceptances es inmutable: UPDATE/DELETE no permitido';
end; $$;

create trigger trg_policy_acceptances_immutable
  before update or delete on policy_acceptances
  for each row execute function block_policy_acceptance_mutation();

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table policy_acceptances enable row level security;

-- Cada quien ve solo sus propias aceptaciones. Ni siquiera el admin de la
-- clínica necesita ver las de sus colegas: no es información operativa.
create policy policy_acceptances_select on policy_acceptances for select
  using (user_id = auth.uid());

-- Solo se puede registrar la propia, y en la propia clínica. La aceptación es
-- un acto personal: nadie acepta por otro.
create policy policy_acceptances_insert on policy_acceptances for insert
  with check (user_id = auth.uid() and clinic_id = auth_clinic_id());

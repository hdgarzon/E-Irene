-- ============================================================================
-- Peticiones, quejas y reclamos (PQR) con número de radicado.
--
-- Los Términos y Condiciones de Uso (cláusula duodécima, numeral 3) prometen un
-- formulario de PQR en el sitio en el que cada solicitud recibe un número de
-- radicado con la fecha y hora de su presentación (literal g del art. 50 de la
-- Ley 1480 de 2011, modificado por el art. 4 de la Ley 2439 de 2024), y una
-- respuesta dentro de los 15 días hábiles siguientes.
--
-- El radicado lo asigna la base, no la aplicación: es consecutivo, único y no
-- depende de lo que mande quien presenta la PQR. Formato PQR-AAAA-NNNNNN, con el
-- año de Bogotá.
--
-- Quien presenta una PQR no tiene cuenta: la inserta el servidor con
-- service-role después de validar el formulario y limitar por IP. Por eso no
-- hay política de insert. Solo el admin de plataforma lee y actualiza.
-- ============================================================================

create sequence pqr_radicado_seq;

create table pqr_requests (
  id uuid primary key default gen_random_uuid(),
  radicado text not null unique,
  kind text not null check (kind in ('peticion', 'queja', 'reclamo')),
  full_name text not null,
  email text not null,
  phone text,
  message text not null,
  status text not null default 'radicada'
    check (status in ('radicada', 'en_tramite', 'respondida')),
  responded_at timestamptz,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index pqr_requests_created_idx on pqr_requests (created_at desc);

comment on table pqr_requests is
  'PQR del sitio (Ley 1480, art. 50 lit. g). radicado y created_at son la constancia de presentación.';

create or replace function assign_pqr_radicado()
returns trigger language plpgsql set search_path = public as $$
begin
  new.radicado := 'PQR-'
    || to_char(now() at time zone 'America/Bogota', 'YYYY')
    || '-'
    || lpad(nextval('pqr_radicado_seq')::text, 6, '0');
  new.created_at := now();
  return new;
end; $$;

-- Siempre se sobrescribe: ni el radicado ni la fecha de presentación se aceptan
-- de quien inserta.
create trigger trg_pqr_requests_radicado
  before insert on pqr_requests
  for each row execute function assign_pqr_radicado();

-- La constancia de presentación no se edita: el admin solo cambia el estado.
create or replace function block_pqr_evidence_mutation()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.radicado is distinct from old.radicado
     or new.created_at is distinct from old.created_at
     or new.kind is distinct from old.kind
     or new.message is distinct from old.message
     or new.full_name is distinct from old.full_name
     or new.email is distinct from old.email then
    raise exception 'pqr_requests: la constancia de presentación no se modifica';
  end if;
  return new;
end; $$;

create trigger trg_pqr_requests_evidence
  before update on pqr_requests
  for each row execute function block_pqr_evidence_mutation();

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table pqr_requests enable row level security;

create policy pqr_requests_admin_select on pqr_requests for select
  using (is_platform_admin());

create policy pqr_requests_admin_update on pqr_requests for update
  using (is_platform_admin())
  with check (is_platform_admin());

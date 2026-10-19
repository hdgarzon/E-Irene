-- ============================================================================
-- Avisos de cambios en los documentos legales.
--
-- La Política de Tratamiento (sección 10) y los Términos de Vinculación del
-- Profesional (cláusula décima) obligan a informar los cambios sustanciales con
-- quince (15) días hábiles de antelación, mediante aviso en la plataforma y por
-- correo electrónico. Esta tabla guarda cada aviso y la constancia de su envío
-- por correo: es la prueba de que se avisó, a cuántos y cuándo.
--
-- El plazo mínimo (15 días hábiles con festivos de Colombia) lo valida la
-- aplicación al crear el aviso (lib/dates.ts); aquí se exige al menos que la
-- vigencia sea futura.
-- ============================================================================

create table legal_notices (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  effective_at timestamptz not null,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  emailed_at timestamptz,
  emailed_count integer,
  constraint legal_notices_future check (effective_at > created_at)
);

create index legal_notices_effective_idx on legal_notices (effective_at desc);

comment on table legal_notices is
  'Avisos de cambios legales (Política 10, Vinculación cl. 10). emailed_at y emailed_count son la constancia del envío.';

alter table legal_notices enable row level security;

-- Todo usuario con sesión ve los avisos (se muestran en la app).
create policy legal_notices_select on legal_notices for select
  to authenticated using (true);

-- Solo el admin de plataforma los crea. La constancia de envío la escribe el
-- servidor con service-role, después de enviar.
create policy legal_notices_insert on legal_notices for insert
  to authenticated with check (is_platform_admin());

-- La constancia de envío no se reescribe una vez fijada.
create or replace function block_legal_notice_rewrite()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.emailed_at is not null then
    raise exception 'legal_notices: un aviso ya enviado no se modifica';
  end if;
  if new.title is distinct from old.title or new.body is distinct from old.body
     or new.effective_at is distinct from old.effective_at or new.created_at is distinct from old.created_at then
    raise exception 'legal_notices: el contenido del aviso no se modifica';
  end if;
  return new;
end; $$;

create trigger trg_legal_notices_rewrite
  before update on legal_notices
  for each row execute function block_legal_notice_rewrite();

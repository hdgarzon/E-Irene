-- ============================================================================
-- Verificación de habilitación profesional.
--
-- Problema que resuelve: hasta ahora el registro solo pedía nombre de clínica,
-- nombre y correo. Cualquiera creaba una clínica y quedaba con acceso a
-- historias clínicas. Ver docs/superpowers/specs/2026-08-06-retencion-y-
-- onboarding-verificado-design.md (D3).
--
-- El control vive en RLS, no solo en la UI: un guard de servidor se puede
-- evadir llamando la API directamente, una política de fila no.
-- ============================================================================

create type verification_status as enum (
  'pending_documents',  -- cuenta creada, faltan documentos
  'pending_review',     -- documentos cargados, esperando revisión manual
  'verified',           -- aprobado; puede ejercer en la plataforma
  'rejected',           -- rechazado; puede volver a intentar
  'suspended'           -- revocado (p. ej. inhabilitación reportada)
);

alter table users
  add column verification_status verification_status not null default 'pending_documents',
  -- Número de tarjeta profesional. Sin cifrar: es un dato de consulta pública
  -- en ReTHUS, y el revisor necesita cotejarlo a simple vista.
  add column license_number text,
  -- Profesión declarada (psicología, medicina, psiquiatría…). Texto libre
  -- porque el listado del talento humano en salud cambia con la normativa.
  add column profession text,
  -- Cédula cifrada con la misma convención *_enc que el resto de documentos de
  -- identidad de la plataforma (lib/crypto.ts).
  add column document_enc text,
  add column id_document_path text,       -- ruta en storage: cédula
  add column license_document_path text,  -- ruta en storage: tarjeta profesional
  add column verification_submitted_at timestamptz,
  add column verification_decided_at timestamptz,
  add column verified_by uuid references users(id),
  add column verification_notes text;     -- motivo de rechazo o nota del revisor

comment on column users.verification_status is
  'Estado de verificación de habilitación profesional. Solo "verified" habilita el acceso clínico (ver auth_can_access_clinical).';

-- ── Backfill ────────────────────────────────────────────────────────────────
-- Los usuarios que ya existen quedan como 'verified'. No es una decisión
-- cómoda: significa que nadie revisó sus credenciales. La alternativa —dejarlos
-- en 'pending_documents'— cortaría el acceso clínico a todas las cuentas
-- existentes en el momento del despliegue, incluidas las que están atendiendo
-- pacientes. Se prefiere no romper producción y revisar las cuentas heredadas
-- desde la cola del admin, que las muestra marcadas aparte.
update users
set verification_status = 'verified',
    verification_decided_at = created_at,
    verification_notes = 'Cuenta anterior a la verificación obligatoria; pendiente de revisión retroactiva.'
where role <> 'paciente';

-- Los pacientes no ejercen: no aplican a este flujo.
update users set verification_status = 'verified' where role = 'paciente';

-- ── Helper de autorización ──────────────────────────────────────────────────
-- SECURITY DEFINER como el resto de helpers de RLS (evita recursión al leer
-- users desde una política sobre users).
--
-- Regla:
--   · admin y doctor  → deben estar verificados ellos mismos.
--   · secretaria      → su clínica debe tener al menos un profesional
--                       verificado. No ejerce, pero registra pacientes por
--                       cuenta de quien sí ejerce.
--   · resto           → sin acceso clínico de escritura.
create or replace function auth_can_access_clinical()
returns boolean language sql stable security definer set search_path = public as $$
  select case auth_role()
    when 'admin' then exists (
      select 1 from public.users
      where id = auth.uid() and verification_status = 'verified'
    )
    when 'doctor' then exists (
      select 1 from public.users
      where id = auth.uid() and verification_status = 'verified'
    )
    when 'secretaria' then exists (
      select 1 from public.users
      where clinic_id = auth_clinic_id()
        and role in ('admin', 'doctor')
        and verification_status = 'verified'
    )
    else false
  end;
$$;

comment on function auth_can_access_clinical() is
  'true si el usuario puede crear registros clínicos. Exige verificación profesional vigente.';

-- Soporta el exists() del helper para el caso 'secretaria'.
create index users_clinic_verified_idx
  on users (clinic_id, role)
  where verification_status = 'verified';

-- ── RLS: crear registros clínicos exige verificación ────────────────────────
-- Solo se endurece INSERT. La lectura y la actualización se dejan intactas a
-- propósito: si a un profesional se le revoca la verificación, debe poder
-- seguir consultando y cerrando lo que ya abrió, no perder el acceso a
-- historias clínicas de las que es responsable legal.
drop policy patients_insert on patients;
create policy patients_insert on patients for insert
  with check (clinic_id = auth_clinic_id() and auth_can_access_clinical());

drop policy consults_insert on consultations;
create policy consults_insert on consultations for insert
  with check (clinic_id = auth_clinic_id() and auth_can_access_clinical());

-- ── Blindaje del estado: nadie se auto-verifica ─────────────────────────────
-- La política users_update permite `id = auth.uid()` (editar el propio perfil)
-- y también que un admin edite a los miembros de su clínica. Sin este trigger,
-- cualquiera podría hacer un PATCH a su propia fila poniéndose 'verified', o un
-- admin de clínica podría aprobar a sus colegas. Todo el control se caería sin
-- tocar la interfaz.
--
-- Regla: con sesión de usuario, el único cambio de estado permitido es el
-- propio envío a revisión. La aprobación la hace el admin de plataforma con
-- service-role (auth.uid() nulo), autorizado en la app por requirePlatformAdmin().
create or replace function enforce_verification_transition()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- service-role / jobs: la autorización ya se hizo en la capa de aplicación.
  if auth.uid() is null then
    return new;
  end if;

  if new.verified_by is distinct from old.verified_by then
    raise exception 'Solo el revisor puede asignar quién verificó';
  end if;

  if new.verification_status is distinct from old.verification_status then
    if auth.uid() <> new.id then
      raise exception 'No puedes cambiar el estado de verificación de otro usuario';
    end if;
    if new.verification_status <> 'pending_review' then
      raise exception 'Solo puedes enviar tu verificación a revisión';
    end if;
    if old.verification_status not in ('pending_documents', 'rejected', 'suspended') then
      raise exception 'Tu verificación no está en un estado que admita reenvío';
    end if;
    -- Un envío válido limpia la decisión anterior, no la conserva ni la inventa.
    if new.verification_decided_at is not null then
      raise exception 'No puedes fijar la fecha de decisión';
    end if;
  elsif new.verification_decided_at is distinct from old.verification_decided_at then
    raise exception 'Solo el revisor puede fijar la decisión de verificación';
  end if;

  return new;
end $$;

create trigger trg_users_verification_guard
  before update on users
  for each row execute function enforce_verification_transition();

-- ── Storage: documentos de verificación ─────────────────────────────────────
-- Bucket privado. Convención de ruta: {clinic_id}/{user_id}/{archivo}.
--
-- Estos documentos son datos personales de los que E-Irene es RESPONSABLE
-- (no encargado, a diferencia de los datos de pacientes): tienen su propio
-- plazo de conservación en la política de tratamiento.
insert into storage.buckets (id, name, public)
values ('professional-docs', 'professional-docs', false)
on conflict (id) do nothing;

-- El profesional sube y ve únicamente los suyos: se exige que coincidan la
-- carpeta de clínica y la de usuario.
create policy "professional_docs_insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'professional-docs'
    and (storage.foldername(name))[1] = public.auth_clinic_id()::text
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy "professional_docs_select_own" on storage.objects for select to authenticated
  using (
    bucket_id = 'professional-docs'
    and (storage.foldername(name))[1] = public.auth_clinic_id()::text
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- Reemplazar un documento rechazado sin tener que borrarlo primero.
create policy "professional_docs_update_own" on storage.objects for update to authenticated
  using (
    bucket_id = 'professional-docs'
    and (storage.foldername(name))[1] = public.auth_clinic_id()::text
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- El admin de plataforma es quien revisa: necesita leer los documentos de
-- cualquier clínica. is_platform_admin() viene de la migración 0012.
create policy "professional_docs_select_platform_admin" on storage.objects for select to authenticated
  using (bucket_id = 'professional-docs' and public.is_platform_admin());

-- ============================================================================
-- Revocación del consentimiento informado del paciente.
--
-- Consentimiento Informado del Paciente, cláusula novena: el paciente puede
-- revocar la autorización en cualquier momento, dirigiéndose a su Profesional;
-- revocarla no borra la historia clínica ya generada. Ley 1581 de 2012, art. 8,
-- literal e).
--
-- La revocación la registra el personal de la clínica (el paciente no tiene
-- cuenta). Marca como revocadas todas las firmas vigentes del paciente: desde
-- ese momento no hay consentimiento activo y la plataforma no deja iniciar
-- consultas ni transcribir hasta que firme de nuevo. Las firmas no se borran:
-- son prueba de lo que se autorizó y hasta cuándo.
-- ============================================================================

alter table consents
  add column revoked_at timestamptz,
  add column revoked_by uuid references users(id) on delete set null,
  add column revocation_note text;

comment on column consents.revoked_at is
  'Cuándo se registró la revocación del paciente (0064). Null = vigente.';

/**
 * Registra la revocación del paciente. Devuelve cuántas firmas quedaron
 * revocadas (0 si no había ninguna vigente). Solo personal de la clínica del
 * paciente.
 */
create or replace function revoke_patient_consent(p_patient uuid, p_note text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clinic uuid;
  v_count integer;
begin
  if auth_role() is null or auth_role() not in ('admin', 'doctor', 'secretaria') then
    raise exception 'No autorizado';
  end if;

  select clinic_id into v_clinic from patients where id = p_patient;
  if v_clinic is null or v_clinic is distinct from auth_clinic_id() then
    raise exception 'No autorizado';
  end if;

  update consents
  set revoked_at = now(),
      revoked_by = auth.uid(),
      revocation_note = nullif(btrim(p_note), '')
  where patient_id = p_patient and revoked_at is null;
  get diagnostics v_count = row_count;

  if v_count > 0 then
    insert into audit_logs (clinic_id, actor_id, action, entity_type, entity_id, metadata)
    values (v_clinic, auth.uid(), 'consent.revoked', 'patient', p_patient,
            jsonb_build_object('consents', v_count));
  end if;

  return v_count;
end;
$$;

revoke all on function revoke_patient_consent(uuid, text) from public, anon;
grant execute on function revoke_patient_consent(uuid, text) to authenticated;

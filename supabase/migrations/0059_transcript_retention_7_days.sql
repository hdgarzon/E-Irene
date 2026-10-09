-- ============================================================================
-- Retención de transcripción v3: 7 días desde la sesión — reemplaza a 0033.
--
-- La Política de Tratamiento publicada (sección 5), el Consentimiento Informado
-- del Paciente (cláusula cuarta) y los Términos de Vinculación del Profesional
-- (cláusula sexta) fijan un único plazo: la transcripción se suprime 7 días
-- después de la sesión, se haya validado o no el reporte. 0033 la conservaba
-- hasta 30 días tras validar y 90 como techo: más de lo que se promete.
--
-- "La sesión" es su cierre (ended_at). Una consulta abandonada, que nunca se
-- cerró, cuenta desde su inicio: así nada queda retenido de forma indefinida
-- (la fuga (b) que corrigió 0033 sigue cerrada).
--
-- Se conservan las demás garantías de 0033: los chunks se borran por pertenecer
-- a una consulta vencida, sin depender del estado de transcript_enc; cada borrado
-- deja transcript_purged_at y una fila por clínica en audit_logs.
--
-- Efecto al desplegar: la primera corrida purga de una vez todas las
-- transcripciones de sesiones de hace más de 7 días, también las de reportes aún
-- sin validar. El reporte, las notas SOAP y el resto de la historia clínica no se
-- tocan.
-- ============================================================================

create or replace function purge_expired_transcripts() returns void
language plpgsql security definer
set search_path = public
as $$
begin
  with expired as (
    select c.id, c.clinic_id
    from consultations c
    where c.transcript_purged_at is null
      and (
        (c.ended_at is not null and c.ended_at < now() - interval '7 days')
        or (c.ended_at is null and c.started_at < now() - interval '7 days')
      )
  ),
  deleted_chunks as (
    delete from transcript_chunks
    where consultation_id in (select id from expired)
    returning 1
  ),
  purged as (
    update consultations
    set transcript_enc = null,
        transcript_purged_at = now()
    where id in (select id from expired)
    returning clinic_id
  )
  insert into audit_logs (clinic_id, action, entity_type, metadata)
  select clinic_id, 'transcript.purge', 'consultations',
         jsonb_build_object('purged_count', count(*))
  from purged
  group by clinic_id;
end;
$$;

-- create or replace conserva los privilegios existentes (incluido el grant a
-- service_role de 0038); se repite el revoke por claridad.
revoke execute on function purge_expired_transcripts() from public, anon, authenticated;

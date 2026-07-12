-- ============================================================================
-- Retención de transcripción: 30 días después de terminada la consulta,
-- se elimina el texto de la transcripción (transcript_chunks + transcript_enc).
-- El resto de la historia clínica (reportes, notas SOAP) no se toca.
-- ============================================================================

create extension if not exists pg_cron;

create or replace function purge_expired_transcripts() returns void
language plpgsql security definer as $$
begin
  delete from transcript_chunks
  where consultation_id in (
    select id from consultations
    where ended_at is not null
      and ended_at < now() - interval '30 days'
      and transcript_enc is not null
  );

  update consultations
  set transcript_enc = null
  where ended_at is not null
    and ended_at < now() - interval '30 days'
    and transcript_enc is not null;
end;
$$;

select cron.schedule(
  'purge-expired-transcripts',
  '0 3 * * *',
  'select purge_expired_transcripts()'
);

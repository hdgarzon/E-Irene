-- ============================================================================
-- Retención de transcripción: 30 días después de terminada la consulta,
-- se elimina el texto de la transcripción (transcript_chunks + transcript_enc).
-- El resto de la historia clínica (reportes, notas SOAP) no se toca.
-- ============================================================================

create extension if not exists pg_cron;

create or replace function purge_expired_transcripts() returns void
language plpgsql security definer
set search_path = public
as $$
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

-- service_role/postgres conservan acceso vía privilegios por defecto de Supabase;
-- no agregarlos aquí o se rompe el cron.
revoke execute on function purge_expired_transcripts() from public, anon, authenticated;

select cron.schedule(
  'purge-expired-transcripts',
  '0 3 * * *',
  'select purge_expired_transcripts()'
);

-- Índice parcial para el predicado exacto de esta consulta de purga: evita un
-- full table scan sobre consultations (tabla consultada constantemente por la
-- app para lecturas por clínica) a medida que crece.
create index consultations_transcript_purge_idx
  on consultations (ended_at)
  where transcript_enc is not null;

-- ============================================================================
-- Retención de transcripción v2 — reemplaza la lógica de 0021.
--
-- Qué cambia y por qué:
--
-- 1. La transcripción es un documento de trabajo, NO la historia clínica. La HC
--    (reports, soap_notes) se conserva 15 años (Res. 839/2017: 5 en archivo de
--    gestión + 10 en central) y esta purga no la toca. La transcripción cumple
--    su propósito cuando el profesional valida el reporte; a partir de ahí solo
--    es superficie de riesgo.
--
-- 2. 0021 tenía dos fugas que dejaban datos sensibles retenidos para siempre:
--
--    a) El borrado de transcript_chunks exigía `transcript_enc is not null`.
--       Si la consolidación falló, o si una corrida previa ya anuló la columna,
--       los chunks quedaban huérfanos y nunca se purgaban.
--
--    b) Toda la purga exigía `ended_at is not null`. Una consulta abandonada
--       (el doctor cierra el navegador, nunca se cierra la sesión) conservaba
--       la transcripción indefinidamente.
--
-- 3. transcript_purged_at deja evidencia auditable del borrado. Sin ella la
--    política de tratamiento promete una supresión que no se puede demostrar
--    ante la SIC ni ante el titular que ejerce su derecho de supresión.
-- ============================================================================

alter table consultations
  add column if not exists transcript_purged_at timestamptz;

comment on column consultations.transcript_purged_at is
  'Cuándo se purgó la transcripción (evidencia de cumplimiento de la política de retención). Null = aún no purgada.';

-- Plazos de retención. Cambiarlos aquí obliga a cambiar la política de
-- tratamiento publicada: los dos textos deben decir lo mismo.
--   · 30 días tras validar el reporte  → la transcripción ya cumplió su función
--   · 90 días como techo duro          → nada queda indefinido, se valide o no
create or replace function purge_expired_transcripts() returns void
language plpgsql security definer
set search_path = public
as $$
begin
  with expired as (
    -- Consultas cuya transcripción ya venció, por cualquiera de las tres vías.
    select c.id, c.clinic_id
    from consultations c
    where c.transcript_purged_at is null
      and (
        -- (1) Reporte validado por el profesional hace más de 30 días.
        exists (
          select 1 from reports r
          where r.consultation_id = c.id
            and r.validated_at is not null
            and r.validated_at < now() - interval '30 days'
        )
        -- (2) Techo duro: 90 días desde el cierre, aunque nunca se validara.
        or (c.ended_at is not null and c.ended_at < now() - interval '90 days')
        -- (3) Consulta abandonada: nunca se cerró y ya pasaron 90 días.
        or (c.ended_at is null and c.started_at < now() - interval '90 days')
      )
  ),
  -- Sin el guard de `transcript_enc is not null`: los chunks se borran por
  -- pertenecer a una consulta vencida, no por el estado de otra columna.
  -- Postgres ejecuta este CTE aunque la consulta principal no lo referencie.
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
  -- La purga es una operación sobre datos sensibles: queda en el audit trail
  -- inmutable, una fila por clínica para que cada una vea la suya vía RLS.
  insert into audit_logs (clinic_id, action, entity_type, metadata)
  select clinic_id, 'transcript.purge', 'consultations',
         jsonb_build_object('purged_count', count(*))
  from purged
  group by clinic_id;
end;
$$;

revoke execute on function purge_expired_transcripts() from public, anon, authenticated;

-- El índice de 0021 apuntaba al predicado viejo (`transcript_enc is not null`).
-- El nuevo barrido filtra por transcript_purged_at, así que se reemplaza.
drop index if exists consultations_transcript_purge_idx;

create index consultations_transcript_purge_idx
  on consultations (ended_at, started_at)
  where transcript_purged_at is null;

-- ── Backfill ────────────────────────────────────────────────────────────────
-- Las consultas que 0021 ya purgó tienen transcript_enc null y no deben volver
-- a evaluarse en cada corrida.
--
-- El filtro `ended_at < now() - interval '30 days'` NO es decorativo: marcar por
-- `transcript_enc is null` a secas atraparía consultas recién terminadas cuya
-- consolidación falló —que tienen chunks vivos— y al darlas por purgadas sus
-- chunks no se borrarían nunca. Es decir, reintroduciría la fuga que esta
-- migración corrige. Solo se marcan las que ya pasaron por la regla vieja.
with ya_purgadas as (
  select id from consultations
  where transcript_purged_at is null
    and transcript_enc is null
    and ended_at is not null
    and ended_at < now() - interval '30 days'
),
-- 0021 dejaba chunks huérfanos en estas mismas filas (su delete exigía
-- `transcript_enc is not null`, que aquí ya era falso). Se limpian ahora.
huerfanos as (
  delete from transcript_chunks
  where consultation_id in (select id from ya_purgadas)
  returning 1
)
update consultations c
set transcript_purged_at = c.ended_at
from ya_purgadas y
where c.id = y.id;

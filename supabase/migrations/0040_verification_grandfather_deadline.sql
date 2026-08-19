-- ============================================================================
-- Plazo para las cuentas verificadas por el backfill de la 0032.
--
-- La 0032 marcó como 'verified' a todas las cuentas profesionales que ya
-- existían, con la nota «Cuenta anterior a la verificación obligatoria;
-- pendiente de revisión retroactiva». Se hizo para no cortarle el acceso a
-- quien estaba atendiendo pacientes ese día, con el compromiso de revisarlas
-- después desde la cola del admin.
--
-- Doce días más tarde (19-ago-2026) esa revisión no había empezado, y la
-- consulta a producción mostró algo peor de lo previsto: las 11 cuentas
-- profesionales que existen son heredadas, ninguna ha aportado un documento,
-- y 4 de ellas ya abrieron consultas. Es decir, TODO acceso a historia clínica
-- proviene hoy de credenciales que nadie comprobó.
--
-- El problema de fondo es que nada obliga a que la revisión ocurra: el estado
-- 'verified' del backfill dura para siempre. Esta migración le pone fecha.
--
-- CÓMO FUNCIONA
--   Cumplido el plazo, las cuentas heredadas que sigan sin aportar documentos
--   vuelven a 'pending_documents'. El barrido corre a diario en pg_cron, igual
--   que la purga de transcripciones (0021).
--
-- QUÉ IMPLICA PARA EL PROFESIONAL
--   Deja de poder crear pacientes y consultas nuevas (auth_can_access_clinical
--   gatea los INSERT), pero NO pierde el acceso a lo que ya tiene: las
--   políticas de lectura —patients_select, consults_select, reports_select—
--   solo filtran por clínica, sin exigir verificación. Sigue siendo el
--   responsable legal de esas historias y puede consultarlas. Recupera el
--   acceso completo subiendo sus documentos y siendo aprobado.
--
-- POR QUÉ ESTA FECHA
--   Da un mes desde que se instala el mecanismo para pedir los documentos,
--   recibirlos y revisarlos. Es una fecha fija y no un intervalo relativo a
--   cada cuenta a propósito: el plazo es del proyecto, no del profesional, y
--   así queda auditable cuándo se decidió que vencía.
--
--   Si al acercarse la fecha la revisión no alcanzó, se corre el plazo con una
--   migración nueva y queda constancia de la prórroga. Lo que no debe hacerse
--   es borrar el mecanismo: el objetivo es que este pendiente no pueda volver
--   a quedar abierto indefinidamente.
-- ============================================================================

comment on column users.verification_notes is
  'Nota de la decisión de verificación. La marca del backfill de 0032 («Cuenta anterior a la verificación obligatoria…») identifica a las cuentas heredadas; expire_grandfathered_verifications() la usa como predicado.';

/**
 * Devuelve las cuentas heredadas al estado 'pending_documents' una vez
 * cumplido el plazo, siempre que no hayan aportado documentos.
 *
 * Idempotente: al degradar se reescribe la nota, así que la cuenta deja de
 * cumplir el predicado y no se vuelve a tocar.
 *
 * No degrada a quien ya subió algo (id_document_path / license_document_path /
 * id_document_hash): esa cuenta está en el circuito de revisión, y cortarle el
 * acceso castigaría justo lo que se le pidió hacer.
 */
create or replace function expire_grandfathered_verifications(
  -- Plazo: 18 de septiembre de 2026, 23:59 en hora de Bogotá (ver lib/dates.ts;
  -- toda la app razona en esa zona). Es parámetro con valor por defecto, no una
  -- constante, para que las pruebas puedan ejercer el barrido sin esperar a esa
  -- fecha. El cron lo invoca sin argumentos y toma el default.
  p_deadline timestamptz default '2026-09-18 23:59:00-05'
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_deadline constant timestamptz := p_deadline;
begin
  if now() < v_deadline then
    return;
  end if;

  with degradadas as (
    update users u
    set verification_status = 'pending_documents',
        verification_notes  = 'Verificación heredada vencida el ' ||
                              to_char(v_deadline at time zone 'America/Bogota', 'DD/MM/YYYY') ||
                              ' sin documentos aportados. Requiere verificación para volver a crear registros clínicos.',
        verification_decided_at = now()
    where u.verification_status = 'verified'
      and u.verification_notes like 'Cuenta anterior a la verificaci%'
      and u.id_document_path is null
      and u.license_document_path is null
      and u.id_document_hash is null
    returning u.clinic_id
  )
  insert into audit_logs (clinic_id, action, entity_type, metadata)
  select clinic_id, 'verification.grandfather_expired', 'users',
         jsonb_build_object('expired_count', count(*))
  from degradadas
  group by clinic_id;
end;
$$;

-- service_role/postgres conservan acceso vía privilegios por defecto de Supabase;
-- no agregarlos aquí o se rompe el cron (mismo criterio que 0021).
revoke execute on function expire_grandfathered_verifications(timestamptz) from public, anon, authenticated;

-- 3:30 AM: después de la purga de transcripciones (3:00) para no solaparse.
select cron.schedule(
  'expire-grandfathered-verifications',
  '30 3 * * *',
  'select expire_grandfathered_verifications()'
);

-- Índice parcial para el predicado exacto del barrido: son pocas filas hoy,
-- pero users se consulta en cada request y el barrido corre a diario.
create index users_grandfathered_pending_idx
  on users (verification_status)
  where verification_status = 'verified' and id_document_path is null;

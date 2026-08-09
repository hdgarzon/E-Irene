-- ============================================================================
-- Reparación del historial de migraciones del proyecto remoto.
--
-- NO ES UNA MIGRACIÓN. No moverlo a supabase/migrations/ — si entra ahí pasa a
-- formar parte de la cadena y se aplicaría a sí mismo en cada `db reset`.
-- Se ejecuta una sola vez, a mano, desde el editor SQL del proyecto.
--
-- ── El problema ─────────────────────────────────────────────────────────────
--
-- Las migraciones se han venido aplicando desde el dashboard / MCP, que asigna
-- a cada una una versión de timestamp y guarda como `name` el nombre completo
-- del archivo:
--
--     version = 20260807052247   name = 0031_billing_checkouts
--
-- Pero la CLI deriva la versión del nombre del archivo: para
-- `0031_billing_checkouts.sql` espera
--
--     version = 0031             name = billing_checkouts
--
-- (Comprobado empíricamente: es exactamente lo que escribe `supabase db reset`
-- en el historial local.)
--
-- Resultado: la CLI no reconoce ninguna de las migraciones 0015–0034 como
-- aplicadas. Un `supabase db push` intentaría re-ejecutar VEINTE migraciones
-- sobre una base que ya las tiene. No es solo un problema de las tres últimas.
--
-- Además, 0028, 0029, 0032, 0033 y 0034 no figuran en el remoto bajo ninguna
-- versión, aunque sí están aplicadas (verificado objeto por objeto: la tabla
-- billing_scheduled_charges existe, las columnas de verificación existen,
-- transcript_purged_at existe). 0029 es un archivo solo de comentarios — el
-- cron de facturación corre en Vercel, no en Postgres — así que no crea nada.
--
-- ── Qué hace este script ────────────────────────────────────────────────────
--
-- 1. Elimina las filas con versión de timestamp (las del dashboard).
-- 2. Registra 0015–0034 con la versión que la CLI espera.
--
-- No ejecuta ninguna migración: solo corrige el registro de lo que ya está
-- aplicado. 0001–0014 ya están bien y no se tocan.
-- ============================================================================

begin;

-- Antes de nada, deja constancia de lo que había (por si hay que revertir).
create table if not exists supabase_migrations.schema_migrations_backup_20260809 as
  select * from supabase_migrations.schema_migrations;

-- 1. Fuera los registros con versión de timestamp de 14 dígitos.
--    Las de 0001–0014 tienen 4 dígitos y no coinciden con el patrón.
delete from supabase_migrations.schema_migrations
where version ~ '^\d{14}$';

-- 2. Registrar 0015–0034 tal como las nombra la CLI.
insert into supabase_migrations.schema_migrations (version, name) values
  ('0015', 'revoke_platform_admin_patient_access'),
  ('0016', 'rate_limiting'),
  ('0017', 'consultation_analysis_status'),
  ('0018', 'patient_search_trigrams'),
  ('0019', 'appointment_telehealth'),
  ('0020', 'patient_links'),
  ('0021', 'transcript_retention_cron'),
  ('0022', 'report_ai_provenance'),
  ('0023', 'risk_alerts'),
  ('0024', 'patient_clinical_state'),
  ('0025', 'treatment_plan_approach'),
  ('0026', 'unify_risk_alerts'),
  ('0027', 'billing'),
  ('0028', 'billing_recurring'),
  ('0029', 'billing_cron'),
  ('0030', 'billing_charge_safety'),
  ('0031', 'billing_checkouts'),
  ('0032', 'professional_verification'),
  ('0033', 'transcript_retention_v2'),
  ('0034', 'verification_function_grants')
on conflict (version) do nothing;

commit;

-- ── Verificación ────────────────────────────────────────────────────────────
-- Debe devolver 34 filas, de '0001' a '0034', sin ninguna versión de timestamp.
select count(*) as total,
       min(version) as primera,
       max(version) as ultima,
       count(*) filter (where version ~ '^\d{14}$') as timestamps_restantes
from supabase_migrations.schema_migrations;

-- Y esto debe salir vacío: cualquier archivo local sin su fila correspondiente.
--   comparar contra `ls supabase/migrations/`
select version, name from supabase_migrations.schema_migrations order by version;

-- Cuando `supabase db push --dry-run` no reporte nada pendiente, borrar el
-- respaldo:
--   drop table supabase_migrations.schema_migrations_backup_20260809;

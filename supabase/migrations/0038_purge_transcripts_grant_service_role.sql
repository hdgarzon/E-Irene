-- ============================================================================
-- GRANT EXECUTE explícito para purge_expired_transcripts() → service_role.
--
-- Mismo origen que 0004/0005: 0021 y 0033 asumieron que `service_role`
-- conserva EXECUTE "por privilegios por defecto de Supabase" sin otorgarlo
-- nunca de forma explícita. Esa suposición dependía de un default privilege
-- implícito (ALTER DEFAULT PRIVILEGES ... ON FUNCTIONS) que la plantilla de
-- Supabase Cloud aplica, pero que un stack local recién provisionado (CI, o
-- un `supabase start` fresco con una versión más nueva del CLI) no siempre
-- replica igual. El resultado: el cron de purga corre "sin error" pero no
-- hace nada, porque `service_role` no tiene EXECUTE — exactamente el mismo
-- síntoma silencioso que 0005 corrigió para los GRANT de tabla.
--
-- El fix es el mismo: dejar de depender de un privilegio implícito y
-- otorgarlo explícitamente.
-- ============================================================================

grant execute on function purge_expired_transcripts() to service_role;

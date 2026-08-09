-- ============================================================================
-- Endurecimiento de permisos de las funciones que introdujo la 0032.
--
-- El linter de Supabase las marcó como SECURITY DEFINER invocables por `anon`
-- vía /rest/v1/rpc/…: por defecto Postgres concede EXECUTE a PUBLIC, y
-- PostgREST expone todo lo que esté en el esquema `public`.
-- ============================================================================

-- Función de trigger. No tiene ningún uso legítimo como RPC — invocarla
-- directamente ni siquiera funcionaría (Postgres rechaza llamar una función de
-- trigger fuera de un trigger), pero exponerla es ruido innecesario en la
-- superficie de la API. El trigger sigue funcionando: la invocación por trigger
-- no comprueba el privilegio EXECUTE.
revoke execute on function enforce_verification_transition() from public, anon, authenticated;

-- Helper de RLS. `authenticated` SÍ necesita ejecutarlo: las expresiones de las
-- políticas se evalúan con los privilegios de quien consulta, así que quitarle
-- el permiso rompería patients_insert y consults_insert. A `anon` no le sirve
-- de nada (devuelve false sin sesión), así que se le retira.
-- Mismo patrón que is_platform_admin() en la migración 0012.
revoke execute on function auth_can_access_clinical() from public, anon;
grant execute on function auth_can_access_clinical() to authenticated;

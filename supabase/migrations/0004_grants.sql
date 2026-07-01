-- ============================================================================
-- Privilegios de tabla para el rol `authenticated`.
--
-- RLS controla QUÉ FILAS puede ver/tocar cada usuario (ya definido en
-- 0001_init.sql); pero Postgres exige además el GRANT de comando SQL a
-- nivel de TABLA (SELECT/INSERT/UPDATE/DELETE) para el rol, independiente
-- de las políticas RLS. La plantilla estándar de Supabase Cloud lo trae
-- por defecto, por eso producción funcionaba sin este archivo — pero un
-- stack local (`supabase start`) recién provisionado (p. ej. en CI) no lo
-- trae, y toda escritura falla con "permission denied for table X".
--
-- audit_logs sigue protegida en la práctica: el trigger
-- `block_audit_mutation` (0001_init.sql) bloquea UPDATE/DELETE sin
-- importar el rol, así que ampliar el GRANT aquí no debilita esa garantía.
-- ============================================================================

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- Aplica también a tablas creadas por migraciones futuras.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;

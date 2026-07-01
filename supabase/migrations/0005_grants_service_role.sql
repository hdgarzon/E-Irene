-- ============================================================================
-- Privilegios de tabla para el rol `service_role`.
--
-- Encontrado por CI: "permission denied for table users" al usar el admin
-- client (service-role) en addMember() (lib/db/team.ts). Supuesto incorrecto
-- de 0004_grants.sql: que `service_role` ya tiene todos los permisos por
-- BYPASSRLS. BYPASSRLS solo salta la capa de RLS (fila); el GRANT de tabla
-- (SELECT/INSERT/UPDATE/DELETE) es una capa de Postgres independiente y
-- sigue siendo obligatoria incluso con BYPASSRLS activo.
--
-- Mismo origen que 0004: la plantilla de Supabase Cloud lo trae por
-- defecto (por eso producción "funcionaba" antes de este archivo); un
-- stack local recién provisionado (CI) no.
-- ============================================================================

grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;

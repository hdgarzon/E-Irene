-- ============================================================================
-- La sesión deja de insertar en risk_alerts: segundo paso de la 0047.
--
-- PRECONDICIÓN DE MERGE: el código de la 0047 —createRiskAlert con
-- service-role en las dos fuentes— tiene que estar ya promovido en
-- producción. CI aplica esta migración antes de promover el código de su
-- propio merge: si en ese momento producción todavía inserta con la sesión,
-- las alertas del análisis de sesión fallan hasta la promoción. Por lo mismo,
-- volver producción a un despliegue anterior a la 0047 exige revertir antes
-- esta migración.
--
-- La 0047 acotó el insert de la sesión, pero no podía comprobar el contenido:
-- un miembro de la clínica todavía podía insertar una alerta abierta e
-- inventada para una consulta propia antes que el análisis. El análisis real
-- chocaba con el índice único, devolvía isNew: false y no avisaba al doctor.
-- Ningún camino legítimo inserta ya con la sesión, así que se retira el
-- permiso, como hizo la 0044 con users.
--
-- Sin política de INSERT, un GRANT que vuelva (la 0004 concedió insert sobre
-- todas las tablas a authenticated; repetir algo así lo devolvería) sigue sin
-- dejar insertar por RLS. El trigger de la 0047 se queda como tercera barrera,
-- para una función SECURITY DEFINER que alguna vez inserte con una sesión.
-- ============================================================================

drop policy if exists risk_alerts_insert on risk_alerts;
revoke insert on table risk_alerts from anon, authenticated;

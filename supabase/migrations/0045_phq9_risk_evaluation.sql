-- Marca de evaluación de riesgo para los PHQ-9 autorreportados vía link.
--
-- El dashboard no leía las alertas PHQ-9 de `risk_alerts`: volvía a escanear
-- `psychometric_assessments` en cada carga (listPhq9RiskAlerts, reintroducido
-- después de la unificación de 0026), así que una autolesión reportada por el
-- paciente no se podía acusar nunca. Antes de retirar ese escaneo, cada PHQ-9
-- de riesgo tiene que tener su fila en `risk_alerts`, y hay dos huecos:
--
--   · Los PHQ-9 anteriores a 0026 nunca generaron fila.
--   · alertOnRiskyAssessment no registraba la alerta si no encontraba a quién
--     avisar o si fallaba alguna consulta previa al correo.
--
-- El backfill NO puede hacerse en SQL: las respuestas (payload_enc) y las
-- categorías de la alerta (categories_enc) se cifran en la capa de aplicación
-- con ENCRYPTION_KEY, que la base no conoce. Esta migración solo agrega la
-- marca; la evaluación la hace la app (reconcilePendingPhq9RiskAlerts en
-- lib/db/risk-alerts.ts), de forma idempotente.
--
-- NULL = pendiente de evaluar. Todo lo existente queda pendiente, y así el
-- backfill cubre la historia completa sin listas armadas a mano. La marca se
-- pone solo después de que la alerta, si correspondía, quedó registrada: una
-- caída entre los dos pasos deja el PHQ-9 pendiente, y el siguiente intento no
-- duplica nada (índice único risk_alerts_assessment_unique de 0026).
--
-- Solo la escribe el cliente service-role: `authenticated` sigue sin UPDATE
-- sobre esta tabla, y no hace falta dárselo.

alter table psychometric_assessments add column if not exists risk_evaluated_at timestamptz;

-- La conciliación corre en cada carga del dashboard clínico: tiene que ser
-- barata cuando no hay nada pendiente, que es el caso normal.
create index if not exists psychometric_assessments_risk_pending_idx
  on psychometric_assessments (clinic_id)
  where type = 'phq9' and link_id is not null and risk_evaluated_at is null;

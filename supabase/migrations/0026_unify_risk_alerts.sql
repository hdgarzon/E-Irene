-- Unifica las dos fuentes de alerta de riesgo bajo una sola tabla.
--
-- Antes de esta migración había dos mecanismos independientes, construidos
-- en paralelo en ramas distintas: la detección de riesgo del análisis de
-- sesión con IA (Fase 0b del copiloto) vivía en `risk_alerts`, con acuse de
-- recibo persistido; la detección de autolesión vía PHQ-9 autorreportado
-- (link público, sin sesión) no persistía ninguna alerta — se recalculaba
-- en cada carga del dashboard, sin forma de acusar recibo ni de saber si un
-- doctor ya la vio. Reconciliación: una tabla, dos fuentes, un solo
-- mecanismo de acuse de recibo para ambas.

alter table risk_alerts add column source text not null default 'session_analysis'
  check (source in ('session_analysis', 'phq9_self_report'));

-- consultation_id ya no aplica al autorreporte PHQ-9; doctor_id tampoco es
-- siempre conocido ahí (si no hay una cita próxima, se notifica a todo el
-- personal admin/doctor de la clínica — no hay un único destinatario que
-- registrar).
alter table risk_alerts alter column consultation_id drop not null;
alter table risk_alerts alter column doctor_id drop not null;

alter table risk_alerts add column assessment_id uuid references psychometric_assessments(id) on delete cascade;

-- Exactamente una referencia según la fuente — nunca ambas, nunca ninguna.
alter table risk_alerts add constraint risk_alerts_source_ref_check check (
  (source = 'session_analysis' and consultation_id is not null and assessment_id is null) or
  (source = 'phq9_self_report' and assessment_id is not null and consultation_id is null)
);

-- unique(consultation_id) ya no puede ser una restricción simple de columna
-- NOT NULL — se reemplaza por índices únicos parciales, uno por fuente, que
-- siguen dando la misma idempotencia de antes (ver lib/db/risk-alerts.ts).
alter table risk_alerts drop constraint risk_alerts_consultation_id_key;
create unique index risk_alerts_consultation_unique on risk_alerts(consultation_id) where consultation_id is not null;
create unique index risk_alerts_assessment_unique on risk_alerts(assessment_id) where assessment_id is not null;

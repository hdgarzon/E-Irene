-- ============================================================================
-- Lo que la sesión puede insertar en risk_alerts.
--
-- La política risk_alerts_insert (0023) solo exige que la fila sea de la
-- clínica de quien inserta: no mira el rol ni las columnas. Con su JWT y un
-- POST directo a /rest/v1/risk_alerts, cualquier miembro de la clínica,
-- también una secretaria, podía (comprobado en local):
--
-- 1. Silenciar la alerta de una consulta: insertarla antes que el análisis y
--    ya acusada. El análisis real choca con el índice único
--    risk_alerts_consultation_unique (0026), createRiskAlert devuelve
--    isNew: false, no sale el correo al doctor y la cola abierta queda vacía.
-- 2. Bloquear la alerta de otra clínica: el índice único es global y la
--    consulta solo tenía que existir. Con la consulta ajena y la clínica
--    propia, el análisis de la otra clínica ya no puede registrar la suya.
-- 3. Registrar alertas de la fuente PHQ-9, que solo inserta el servidor.
-- 4. Poner un paciente o un doctor de otra clínica, o de otra consulta: las FK
--    solo exigen que existan.
-- 5. Antedatar la alerta para que quede al fondo de la cola.
--
-- Con sesión, una alerta nueva tiene que ser la del análisis de una consulta
-- de la propia clínica, con el paciente y el doctor de esa consulta, sin
-- acuse, y con la fecha que pone la base.
--
-- Lo que esto no cierra: el contenido (categories_enc) no se puede comprobar
-- aquí, así que una alerta abierta e inventada para la consulta propia todavía
-- le gana el correo al análisis real. Eso se cierra retirando el INSERT de la
-- sesión, y a propósito no se hace en esta migración: el código anterior
-- inserta con la sesión de quien termina o reintenta el análisis —cualquier
-- rol, también la secretaria— y la migración se aplica antes de promover el
-- código nuevo. Retirar el permiso ahora dejaría sin registrar alertas reales
-- durante el despliegue. Desde este cambio createRiskAlert inserta con
-- service-role en las dos fuentes; el REVOKE va en una migración posterior,
-- cuando ese código ya esté en producción.
--
-- Por la misma razón no se exige rol ni verificación: con el código anterior
-- la secretaria dispara el análisis, y la 0032 deja a un profesional
-- suspendido cerrar lo que ya abrió.
--
-- service-role y los jobs (auth.uid() nulo) no pasan por este control, igual
-- que en la 0044: ahí un rechazo sería una alerta real perdida. anon no llega:
-- sin sesión no hay clínica y la política rechaza la fila.
--
-- SECURITY DEFINER para comparar contra consultations sin depender de su
-- política de lectura.
-- ============================================================================

create or replace function enforce_risk_alert_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_patient_id uuid;
  v_doctor_id uuid;
begin
  -- service-role / jobs: la autorización ya se hizo en la capa de aplicación.
  if auth.uid() is null then
    return new;
  end if;

  if new.acknowledged_at is not null or new.acknowledged_by is not null then
    raise exception 'Una alerta nueva no puede nacer con acuse de recibo';
  end if;

  if new.source is distinct from 'session_analysis' or new.assessment_id is not null then
    raise exception 'Con tu sesión solo se registran alertas del análisis de una consulta';
  end if;

  select c.patient_id, c.doctor_id into v_patient_id, v_doctor_id
  from consultations c
  where c.id = new.consultation_id
    and c.clinic_id = new.clinic_id
    and c.clinic_id = auth_clinic_id();
  if not found then
    raise exception 'La alerta tiene que ser de una consulta de tu clínica';
  end if;

  if new.patient_id is distinct from v_patient_id or new.doctor_id is distinct from v_doctor_id then
    raise exception 'El paciente y el doctor de la alerta tienen que ser los de la consulta';
  end if;

  new.created_at := now();
  return new;
end $$;

drop trigger if exists trg_risk_alerts_insert_guard on risk_alerts;
create trigger trg_risk_alerts_insert_guard
  before insert on risk_alerts
  for each row execute function enforce_risk_alert_insert();

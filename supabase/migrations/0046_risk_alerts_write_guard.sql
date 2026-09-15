-- ============================================================================
-- Lo que la sesión puede escribir en risk_alerts: el acuse de recibo, y nada
-- más.
--
-- La política risk_alerts_update (0023) decide QUÉ filas toca un admin/doctor
-- —las de su clínica—, pero no QUÉ columnas: authenticated tiene UPDATE sobre
-- todas y la tabla no tenía triggers. acknowledgeRiskAlert solo escribe el
-- acuse, pero con un PATCH directo a /rest/v1/risk_alerts y su JWT, un
-- admin/doctor podía (comprobado en local):
--
-- 1. Reabrir una alerta acusada (acknowledged_at = null): vuelve a la cola
--    como si nadie la hubiera atendido.
-- 2. Reescribir un acuse previo, o acusar a nombre de otro usuario: quién
--    respondió a una alerta de riesgo, y cuándo, dejaba de ser un dato fiable.
-- 3. Cambiar el contenido o el origen de la alerta: categories_enc, paciente,
--    doctor, fuente, consulta o escala.
--
-- Con sesión, el único cambio válido es el acuse: acknowledged_at de null a no
-- null, a nombre de quien acusa, sin tocar ninguna otra columna. Un acuse no
-- se cambia ni se deshace. La fecha la pone la base y la de la sesión se
-- descarta, igual que la 0044 reinicia huellas y marca de purga.
--
-- El resto de la fila se compara entera, no columna por columna: una columna
-- que se agregue después queda protegida sin tener que acordarse de sumarla
-- aquí. Si alguna vez la sesión tiene que escribirla, se habilita en esta
-- función, a propósito.
--
-- Escritores actuales, sin cambios: createRiskAlert (sesión o service-role) y
-- la conciliación de PHQ-9 solo insertan —ante el índice único releen la
-- fila, no la actualizan—, y acknowledgeRiskAlert hace exactamente esta
-- transición. service-role y los jobs (auth.uid() nulo) no pasan por este
-- control, igual que en la 0044; anon no llega a ninguna fila por la política.
-- ============================================================================

create or replace function enforce_risk_alert_acknowledgement()
returns trigger language plpgsql set search_path = public as $$
begin
  -- service-role / jobs: la autorización ya se hizo en la capa de aplicación.
  if auth.uid() is null then
    return new;
  end if;

  if old.acknowledged_at is not null then
    raise exception 'La alerta ya tiene acuse de recibo: no se puede cambiar ni reabrir';
  end if;

  if new.acknowledged_at is null then
    raise exception 'Con tu sesión solo puedes acusar recibo de la alerta';
  end if;

  if new.acknowledged_by is distinct from auth.uid() then
    raise exception 'El acuse de recibo tiene que quedar a tu nombre';
  end if;

  if (to_jsonb(new) - array['acknowledged_at', 'acknowledged_by'])
     is distinct from (to_jsonb(old) - array['acknowledged_at', 'acknowledged_by']) then
    raise exception 'Con tu sesión solo puedes acusar recibo de la alerta, sin cambiar nada más';
  end if;

  new.acknowledged_at := now();
  return new;
end $$;

drop trigger if exists trg_risk_alerts_acknowledgement_guard on risk_alerts;
create trigger trg_risk_alerts_acknowledgement_guard
  before update on risk_alerts
  for each row execute function enforce_risk_alert_acknowledgement();

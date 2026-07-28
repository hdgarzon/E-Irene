-- Canal de alerta de riesgo, separado del pipeline de reportes.
--
-- Hasta ahora, un riskFlag en nivel "alto" no llegaba a nadie: el análisis y
-- el reporte comparten la misma llamada de background, y su único efecto
-- visible era un correo "tu reporte está listo" AL PACIENTE. Esta tabla es un
-- canal propio hacia el doctor tratante, con acuse de recibo persistido, que
-- se escribe ANTES de crear el reporte — un fallo posterior en la generación
-- del reporte no debe dejar una alerta de riesgo sin registrar.

create table risk_alerts (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  consultation_id uuid not null references consultations(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  -- Doctor tratante de la consulta (consultations.doctor_id) — NUNCA el
  -- paciente ni el correo genérico de la clínica.
  doctor_id uuid not null references users(id),
  -- JSON cifrado (AES-256-GCM app-layer): [{ key, level, evidence }, ...].
  -- Mismo nivel de protección que reports.payload_enc — es contenido clínico
  -- sensible (cita textual del paciente), no un dato administrativo.
  categories_enc text not null,
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid references users(id),
  -- Una alerta por consulta: si el análisis se reintenta tras un fallo
  -- posterior (p. ej. createReport falló), no debe duplicarse ni reenviar
  -- el correo al doctor.
  unique (consultation_id)
);

create index risk_alerts_clinic_idx on risk_alerts(clinic_id);
-- Cola de alertas abiertas — es la consulta que hace el dashboard en cada carga.
create index risk_alerts_open_idx on risk_alerts(clinic_id, created_at desc)
  where acknowledged_at is null;

alter table risk_alerts enable row level security;

create policy risk_alerts_select on risk_alerts for select using (clinic_id = auth_clinic_id());
create policy risk_alerts_insert on risk_alerts for insert with check (clinic_id = auth_clinic_id());
-- Solo admin/doctor de la clínica pueden acusar recibo — requiere criterio
-- clínico, igual que el borrado de pacientes.
create policy risk_alerts_update on risk_alerts for update
  using (clinic_id = auth_clinic_id() and auth_role() in ('admin', 'doctor'));

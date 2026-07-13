-- supabase/migrations/0019_appointment_telehealth.sql
-- ============================================================================
-- Telehealth: modalidad de la cita + acceso del paciente a la videollamada.
--
-- video_join_token es un token de acceso propio, DISTINTO del id de la fila
-- (práctica estándar: no mezclar identificador de recurso con capacidad de
-- acceso). Se genera de forma perezosa la primera vez que hace falta (enviar
-- recordatorio o iniciar la videollamada) — ver lib/db/appointments.ts.
-- ============================================================================

alter table appointments add column modality text not null default 'in_person'
  check (modality in ('in_person', 'video'));
alter table appointments add column video_room_name text;
-- URL real de la sala devuelta por el proveedor (Daily.co: `room.url`; mock:
-- una URL simulada) — se guarda para no tener que reconstruirla a mano en
-- cada request (ver ensureVideoRoom en un task posterior del plan).
alter table appointments add column video_room_url text;
alter table appointments add column video_join_token text;

create unique index appointments_video_join_token_idx on appointments(video_join_token)
  where video_join_token is not null;

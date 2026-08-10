-- ============================================================================
-- Retención de los documentos de identidad del profesional.
--
-- La cédula y la tarjeta profesional que el doctor sube para verificarse se
-- quedaban en el bucket para siempre, incluidas las de quienes fueron
-- rechazados y nunca llegaron a usar la plataforma.
--
-- E-Irene es RESPONSABLE de estos datos (no encargado, a diferencia de los del
-- paciente), y la política de tratamiento no declaraba ningún plazo. Es el
-- mismo hueco que se corrigió con las transcripciones en la 0033.
--
-- Regla: los archivos se borran 30 días después de la decisión de
-- verificación. Ese plazo le deja al profesional margen para impugnar un
-- rechazo, y a nosotros para revisar de nuevo una aprobación.
--
-- Lo que NO se borra es la prueba de qué se revisó: al decidir se calcula el
-- SHA-256 de cada documento y se guarda aquí. Así la decisión sigue siendo
-- auditable —"se aprobó sobre estos documentos"— sin conservar imágenes de
-- documentos de identidad más tiempo del necesario. Mismo principio que el
-- hash del consentimiento del paciente.
-- ============================================================================

alter table users
  add column id_document_hash text,
  add column license_document_hash text,
  add column documents_purged_at timestamptz;

comment on column users.id_document_hash is
  'SHA-256 del documento de identidad revisado. Sobrevive al borrado del archivo: es la prueba de qué se verificó.';
comment on column users.documents_purged_at is
  'Cuándo se borraron los archivos de verificación del bucket. Null = aún no purgados.';

-- Soporta el barrido diario del cron sin escanear toda la tabla.
create index users_documents_purge_idx
  on users (verification_decided_at)
  where documents_purged_at is null and verification_decided_at is not null;

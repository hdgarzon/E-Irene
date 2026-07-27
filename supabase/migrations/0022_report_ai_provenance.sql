-- Trazabilidad de los outputs clínicos generados por IA.
--
-- Sin estas columnas no se puede reproducir ni auditar una conclusión clínica
-- pasada: el payload queda guardado, pero no qué modelo ni qué versión de
-- prompt lo produjo. Es requisito de explicabilidad y versionado, no una
-- mejora opcional.
--
-- Nullable a propósito: los reportes anteriores a esta migración no tienen
-- procedencia conocida y no debemos inventarla. NULL significa exactamente
-- "generado antes de que existiera trazabilidad".

alter table reports add column model text;
alter table reports add column prompt_version text;
alter table reports add column generated_at timestamptz;

comment on column reports.model is
  'Modelo exacto que generó el payload (p. ej. "gpt-4o"). NULL = anterior a la trazabilidad.';
comment on column reports.prompt_version is
  'Versión del prompt del proveedor. Se incrementa en cada cambio del prompt clínico.';
comment on column reports.generated_at is
  'Momento en que el proveedor devolvió el análisis (distinto de created_at, que es la escritura en BD).';

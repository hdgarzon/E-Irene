-- ============================================================================
-- Blind index de trigramas para búsqueda escalable de pacientes.
--
-- Hoy `listPatients()` descifra TODA la tabla en cada carga de /patients — no
-- escala. Un blind index HMAC clásico (hash del valor completo) solo permite
-- coincidencia EXACTA, perdiendo la búsqueda "contiene" que la UI ya ofrece.
--
-- Se indexa el patrón de trigramas: `search_trigrams` guarda el HMAC-SHA256
-- (derivado de ENCRYPTION_KEY, ver lib/search-index.ts) de cada trigrama de
-- caracteres del texto buscable del paciente (nombre + documento + teléfono,
-- normalizado). Ningún valor en claro ni el hash del valor completo se
-- almacena — solo hashes de fragmentos de 3 caracteres, que por sí solos no
-- reconstruyen el dato original.
--
-- La búsqueda usa `&&` (overlap) sobre este arreglo para acotar un conjunto de
-- candidatos en BD; el match exacto por substring se verifica después, en la
-- app, sobre los pocos candidatos ya descifrados — nunca sobre toda la tabla.
-- ============================================================================

alter table patients add column search_trigrams text[] not null default '{}';

create index patients_search_trigrams_idx on patients using gin (search_trigrams);

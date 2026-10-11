-- ============================================================================
-- Rotación de ENCRYPTION_KEY: recifrado de las columnas *_enc en la base.
--
-- La aplicación cifra con AES-256-GCM (lib/crypto.ts). Hasta ahora había una
-- sola clave y cambiarla dejaba ilegible todo lo cifrado. Con el llavero de
-- lib/crypto.ts, cada valor nuevo lleva el id de su clave ("k2:…"; sin prefijo
-- = clave 1) y la aplicación recifra lo existente con la clave activa por lotes
-- (lib/key-rotation.ts). Lo que la base aporta:
--
--  · reencrypt_values: reemplaza valores cifrados de una columna, solo si siguen
--    iguales al que se leyó (no pisa una escritura concurrente de la app).
--  · reindex_patient_search: recalcula el índice ciego de búsqueda, que también
--    deriva de la clave (lib/search-index.ts).
--  · encryption_key_status: cuántos valores faltan por recifrar, por columna.
--
-- Recifrar no es modificar el dato: dentro de estas funciones (marca local
-- e_irene.key_rotation) las tablas inmutables lo permiten y updated_at no cambia.
-- Solo service-role.
-- ============================================================================

-- Con qué clave se calculó el índice ciego de búsqueda de cada paciente: así la
-- rotación sabe a quién reindexar. Los existentes se calcularon con la 1.
alter table patients add column search_index_key text not null default '1';

-- updated_at refleja cambios del dato, no de su cifrado.
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  if current_setting('e_irene.key_rotation', true) = 'on' then
    return new;
  end if;
  new.updated_at = now();
  return new;
end; $$;

-- patient_clinical_state es inmutable (0024); la supresión de cuentas (0062)
-- puede borrarlo y la rotación puede recifrar state_enc, nada más.
create or replace function block_clinical_state_mutation()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and current_setting('e_irene.account_deletion', true) = 'on' then
    return old;
  end if;
  if tg_op = 'UPDATE' and current_setting('e_irene.key_rotation', true) = 'on'
     and (to_jsonb(new) - 'state_enc') = (to_jsonb(old) - 'state_enc') then
    return new;
  end if;
  raise exception 'patient_clinical_state es inmutable: UPDATE/DELETE no permitido';
end; $$;

-- billing_events es inmutable (0028): la rotación solo recifra raw_payload_enc.
create or replace function block_billing_events_mutation()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and current_setting('e_irene.key_rotation', true) = 'on'
     and (to_jsonb(new) - 'raw_payload_enc') = (to_jsonb(old) - 'raw_payload_enc') then
    return new;
  end if;
  raise exception 'billing_events es inmutable: UPDATE/DELETE no permitido';
end; $$;

/** true si public.<tabla>.<columna> existe, es de texto y termina en _enc. */
create or replace function is_encrypted_column(p_table text, p_column text)
returns boolean language sql stable set search_path = public as $$
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = p_table and column_name = p_column
      and column_name like '%\_enc' and data_type = 'text'
  );
$$;

/**
 * Reemplaza valores cifrados. p_items: [{ "id": uuid, "old": text, "new": text }].
 * Cada fila se actualiza solo si la columna sigue valiendo "old". Devuelve
 * cuántas se actualizaron (las que no, cambiaron entre la lectura y ahora y se
 * recifran en la siguiente pasada).
 */
create or replace function reencrypt_values(p_table text, p_column text, p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_count integer := 0;
  v_rows integer;
begin
  if not is_encrypted_column(p_table, p_column) then
    raise exception 'Columna no cifrada o inexistente: %.%', p_table, p_column;
  end if;

  perform set_config('e_irene.key_rotation', 'on', true);
  for v_item in select * from jsonb_array_elements(p_items) loop
    execute format('update %I set %I = $1 where id = $2 and %I = $3', p_table, p_column, p_column)
      using v_item->>'new', (v_item->>'id')::uuid, v_item->>'old';
    get diagnostics v_rows = row_count;
    v_count := v_count + v_rows;
  end loop;
  perform set_config('e_irene.key_rotation', 'off', true);
  return v_count;
end;
$$;

/**
 * Recalcula el índice ciego de búsqueda con la clave activa. p_items:
 * [{ "id", "full_name_enc", "document_enc", "phone_enc", "trigrams": [...] }],
 * p_key: id de la clave con que se calcularon. Solo si los tres campos de los
 * que deriva siguen iguales.
 */
create or replace function reindex_patient_search(p_items jsonb, p_key text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_count integer := 0;
  v_rows integer;
begin
  perform set_config('e_irene.key_rotation', 'on', true);
  for v_item in select * from jsonb_array_elements(p_items) loop
    update patients
    set search_trigrams = array(select jsonb_array_elements_text(v_item->'trigrams')),
        search_index_key = p_key
    where id = (v_item->>'id')::uuid
      and full_name_enc = v_item->>'full_name_enc'
      and document_enc is not distinct from v_item->>'document_enc'
      and phone_enc is not distinct from v_item->>'phone_enc';
    get diagnostics v_rows = row_count;
    v_count := v_count + v_rows;
  end loop;
  perform set_config('e_irene.key_rotation', 'off', true);
  return v_count;
end;
$$;

/**
 * Valores que todavía no están cifrados con la clave activa, por columna.
 * p_active_id: id de la clave activa. Con la 1, son los que llevan prefijo de
 * otra clave; con otra, los que no llevan "k<id>:".
 */
create or replace function encryption_key_status(p_active_id text)
returns table (table_name text, column_name text, pending bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_col record;
  v_pending bigint;
begin
  for v_col in
    select c.table_name::text as t, c.column_name::text as c
    from information_schema.columns c
    where c.table_schema = 'public' and c.column_name like '%\_enc' and c.data_type = 'text'
    order by 1, 2
  loop
    if p_active_id = '1' then
      execute format('select count(*) from %I where %I is not null and %I ~ ''^k[0-9]+:''', v_col.t, v_col.c, v_col.c)
        into v_pending;
    else
      execute format('select count(*) from %I where %I is not null and %I not like $1', v_col.t, v_col.c, v_col.c)
        into v_pending using 'k' || p_active_id || ':%';
    end if;
    table_name := v_col.t;
    column_name := v_col.c;
    pending := v_pending;
    return next;
  end loop;
end;
$$;

revoke all on function is_encrypted_column(text, text) from public, anon, authenticated;
revoke all on function reencrypt_values(text, text, jsonb) from public, anon, authenticated;
revoke all on function reindex_patient_search(jsonb, text) from public, anon, authenticated;
revoke all on function encryption_key_status(text) from public, anon, authenticated;
grant execute on function is_encrypted_column(text, text) to service_role;
grant execute on function reencrypt_values(text, text, jsonb) to service_role;
grant execute on function reindex_patient_search(jsonb, text) to service_role;
grant execute on function encryption_key_status(text) to service_role;

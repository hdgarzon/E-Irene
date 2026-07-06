-- ============================================================================
-- Rate limiting respaldado por Postgres (sin infra nueva; funciona distribuido
-- entre varias instancias serverless, a diferencia de un contador en memoria).
--
-- Se usa para frenar fuerza bruta en login y abuso de envío de magic links en
-- signup (cada signup dispara un correo → costo + spam). Ventana fija:
-- `check_rate_limit(key, max, window_seconds)` cuenta atómicamente los intentos
-- por `key` (p. ej. "signin:ip:1.2.3.4") y devuelve true si aún está permitido.
-- ============================================================================

create table rate_limits (
  key text primary key,
  count int not null default 0,
  window_start timestamptz not null default now()
);

-- Solo la función SECURITY DEFINER de abajo toca esta tabla; nadie la lee/escribe
-- vía la API (RLS habilitado sin políticas → denegado para anon/authenticated).
alter table rate_limits enable row level security;

/**
 * Registra un intento para `p_key` y devuelve true si está DENTRO del límite,
 * false si lo excede. Ventana fija de `p_window_seconds`: al expirar, el
 * contador se reinicia. Atómico (un solo INSERT ... ON CONFLICT), a prueba de
 * carreras entre requests concurrentes.
 */
create or replace function check_rate_limit(
  p_key text,
  p_max int,
  p_window_seconds int
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  new_count int;
begin
  insert into rate_limits (key, count, window_start)
  values (p_key, 1, now())
  on conflict (key) do update
    set count = case
          when rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
          then 1
          else rate_limits.count + 1
        end,
      window_start = case
          when rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
          then now()
          else rate_limits.window_start
        end
  returning count into new_count;

  return new_count <= p_max;
end;
$$;

-- Invocable sin sesión (login/signup ocurren como `anon`).
revoke all on function check_rate_limit(text, int, int) from public;
grant execute on function check_rate_limit(text, int, int) to anon, authenticated;

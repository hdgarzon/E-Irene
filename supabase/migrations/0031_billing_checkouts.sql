-- Vincula un payment link de Wompi con la clínica y el plan que se está
-- comprando.
--
-- POR QUÉ EXISTE (bug real, 2026-08-07): el diseño anterior embebía clinicId
-- y plan en el campo `reference` que se le envía a Wompi, asumiendo que ese
-- valor volvería intacto en el webhook. NO vuelve. Cuando el pago ocurre a
-- través de un Payment Link, Wompi descarta nuestra referencia y genera la
-- suya, con el formato `<payment_link_id>_<timestamp>_<random>`:
--
--   enviada:  planupgrade-40e9fa8c-...-pro-1786079611861
--   recibida: test_DycgWj_1786079615_Tc7H27rmL
--
-- Resultado: el webhook no podía saber de qué clínica era el pago y lo
-- descartaba ("unknown_reference"), con la clínica ya cobrada.
--
-- El único hilo que sobrevive es el id del payment link, que sí conocemos al
-- crearlo. Esta tabla lo persiste para poder resolver el pago después.

create table billing_checkouts (
  id uuid primary key default gen_random_uuid(),
  -- Id del payment link en Wompi (p. ej. "test_DycgWj"). Único: un link
  -- pertenece a un solo intento de compra.
  wompi_payment_link_id text not null unique,
  clinic_id uuid not null references clinics(id) on delete cascade,
  plan text not null,
  amount_in_cents bigint not null,
  -- La referencia que NOSOTROS enviamos. Se guarda para trazabilidad y
  -- porque en los cobros recurrentes (transacciones directas, sin payment
  -- link) Wompi sí la conserva.
  reference text not null,
  created_at timestamptz not null default now()
);

create index billing_checkouts_clinic_idx on billing_checkouts(clinic_id, created_at desc);

alter table billing_checkouts enable row level security;

-- Solo lectura para admins de la clínica; las escrituras las hace el flujo de
-- checkout con el cliente service-role.
create policy billing_checkouts_select on billing_checkouts
  for select using (clinic_id = auth_clinic_id() and auth_role() = 'admin');

-- ============================================================================
-- Plan Esencial.
--
-- La escala de precios pasa de cuatro a cinco niveles, todos en pesos
-- colombianos: Free, Esencial, Profesional, Clínica y Enterprise. Los códigos
-- existentes conservan su plan (pro = Profesional, clinica = Clínica,
-- enterprise = Enterprise); Esencial necesita uno propio.
--
-- Va sola en su archivo a propósito: Postgres no deja usar un valor de enum en
-- la misma transacción que lo agrega, y cada migración corre en la suya. La
-- 0048 es la que lo usa.
-- ============================================================================

alter type clinic_plan add value if not exists 'esencial' before 'pro';

-- ============================================================================
-- Estado del análisis de IA como campo propio de `consultations`, para poder
-- moverlo a background (después de endConsultationAction) con estados y
-- reintentos — hoy el análisis corre síncrono dentro de la Server Action:
-- una llamada lenta o fallida a OpenAI bloquea el cierre de la sesión sin
-- ningún reintento.
--
-- null           → consulta aún no finalizada / sin análisis solicitado.
-- 'pending'      → encolado, a la espera de que corra el análisis.
-- 'processing'   → análisis en curso.
-- 'done'         → reporte generado con éxito.
-- 'failed'       → falló; `analysis_error` trae el motivo. Reintentable.
-- ============================================================================

alter table consultations
  add column analysis_status text
    check (analysis_status in ('pending', 'processing', 'done', 'failed')),
  add column analysis_error text;

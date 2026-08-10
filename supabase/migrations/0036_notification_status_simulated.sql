-- ============================================================================
-- Estado 'simulated' para notificaciones.
--
-- Sin RESEND_API_KEY (o TWILIO_*), los proveedores degradan a un modo de log
-- que escribe una línea en consola y devuelve un id falso. Hasta ahora todas
-- las rutas registraban igual `status = 'sent'` con su `sent_at`, de modo que
-- la tabla afirmaba envíos que nunca ocurrieron.
--
-- No es solo higiene: `notifications` es el registro con el que una clínica
-- acreditaría haber contactado al paciente — por ejemplo, haberle enviado el
-- enlace para firmar su consentimiento informado. Un registro que dice "sent"
-- sobre un correo que no salió es peor que no tener registro.
--
-- 'failed' no sirve para esto: no falló nada, simplemente no había canal
-- configurado. Son situaciones distintas y conviene poder distinguirlas al
-- diagnosticar.
-- ============================================================================

alter type notification_status add value if not exists 'simulated';

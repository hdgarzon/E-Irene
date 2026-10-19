# ESTADO.md

> Actualizar al cerrar cada sesión. Es lo primero que lee la siguiente.

## Tarea actual
- Cumplimiento de los documentos legales entregados por asesoría (política de tratamiento, aviso de privacidad, consentimiento del paciente, términos de vinculación del profesional, términos de uso y piezas 2 y 3) y lo que se derivó de su revisión.

## Hecho
Todo fusionado en `main` y desplegado en producción (migraciones 0059 a 0066 aplicadas).
- #84 Documentos legales publicados en página y PDF (`lib/legal-documents/`), pie con enlace a la SIC, casillas de aceptación al crear la cuenta, aviso antes de transcribir con Iniciar/Detener, consentimiento del paciente con firma propia desde los 14 años y asentimiento del menor, transcripción suprimida a los 7 días, sección `#planes`.
- #85 PQR con radicado (`/pqr`, `/admin/pqr`) y días hábiles con festivos de Colombia (`lib/dates.ts`).
- #86 Exportar datos de la clínica en JSON y eliminar la cuenta con 30 días para exportar o desistir. Corrigió `calculateAge`, que adelantaba un día los cumpleaños en Bogotá.
- #87 "IVA incluido" junto a los precios.
- #88 Supresión de la identificación 2 años después de eliminar la cuenta.
- #89 La landing deja de prometer lo que la arquitectura no cumple (audio que "no toca un servidor", cifrado de extremo a extremo, llaves del profesional, retención configurable, anonimizar).
- #90 Confirmación de cada pago y renovación por correo.
- #91 Mi cuenta (`/cuenta`): retirar la autorización comercial e historial de aceptaciones.
- #92 Revocar el consentimiento del paciente desde la ficha.
- #93 Avisos de cambios legales con 15 días hábiles (`/admin/avisos`).
- #98 Rotación de `ENCRYPTION_KEY` sin perder datos (`/admin/rotacion-clave`, `docs/rotacion-clave-cifrado.md`).
- #108 No transcribir sin consentimiento vigente (revocado con la consulta abierta) y quitar la pantalla de Planes de la consola, que editaba precios que nada usaba.

## Pendiente
- **PR abiertos (revisados el 2026-10-18):**
  - #95 (e2e de suspensión de clínicas): fusiona limpio con `main`. Solo toca una prueba. Listo para fusionar.
  - #94 (no perder acciones hechas antes de hidratar): sigue haciendo falta, porque `main` no tiene esa protección en ningún componente. Explica la falla intermitente de la búsqueda de citas en `admin-console.spec.ts`. Tiene conflictos en `live-consultation.tsx`, `reminder-button.tsx` y `start-video-button.tsx` por los cambios de estilo de #103 a #106: hay que resolverlos conservando las clases nuevas y agregar `useHydrated`.
  - #83 (18 dependencias, incluidas Next 16.4 y React 19.3): fusiona limpio, pero su CI corrió contra el `main` del 30-sep. Pedir `@dependabot rebase` y correr la suite completa antes de fusionar.
  - #81 (vitest 5, versión mayor): fusiona limpio, pero su CI es del 16-sep. Igual que #83: rebase y suite completa en local.
- `docs/protocolo-incidentes-seguridad.md`: redactado, sin commit; espera la revisión de la abogada (puntos `[Validar]`, nombres y contactos).
- Abogada: confirmar si las casillas del registro van encima o debajo del botón (hoy están encima, en `/auth/set-password`) y validar las correcciones de forma de los textos.

## Bloqueado
- **Correo en producción:** faltan `RESEND_API_KEY` y `EMAIL_FROM` en Vercel, y `e-irene.co` no tiene MX. No sale ningún correo (pagos, PQR, avisos, eliminación de cuenta, recordatorios, alertas) y `protecciondedatos@` no recibe. Lo hace Henry: clave en Resend, variables en Vercel, MX (por ejemplo ImprovMX) y un despliegue nuevo.
- **OpenAI sin créditos:** sin análisis con IA ni alertas de riesgo en consultas reales. Henry los recarga al terminar la configuración.
- **Daily:** `DAILY_API_KEY` no aparece en las variables de producción; falta confirmar si las videollamadas reales están configuradas, además del webhook.

## Siguiente paso
1. Henry configura el correo (Resend y MX).
2. Fusionar #95; resolver los conflictos de #94 y fusionarlo.
3. Rebase de #83 y #81, suite completa en local y fusión.

## Notas de sesión
<!-- AAAA-MM-DD: una o dos líneas -->
- 2026-10-18: Cerrado el cumplimiento de los documentos legales (#84 a #108). Revisados los 4 PR abiertos. Procesos sin código pendientes: acuerdos de tratamiento de datos con proveedores, factura electrónica DIAN, actualizar los documentos cuando se constituya la SAS, guardar la clave de cifrado en el gestor de contraseñas y probar una restauración de los respaldos de Supabase.

# Retención de transcripciones y onboarding verificado del profesional

**Fecha:** 2026-08-06
**Estado:** implementado y aplicado en producción (migraciones 0032 y 0033, verificadas el 2026-08-07)

## Problema

Una auditoría de cumplimiento previa a la constitución de la sociedad encontró tres brechas entre
lo que la plataforma **declara** y lo que **hace**. Las tres tienen consecuencia legal directa,
porque el consentimiento que firma el paciente y la política de tratamiento que se va a publicar
afirman cosas concretas sobre el manejo de datos sensibles de salud.

### B1 — El audio sí se retenía en el proveedor de transcripción

`lib/providers/deepgram.ts` construía la URL del WebSocket sin `mip_opt_out=true`. En el plan
hosted, Deepgram incluye las peticiones por defecto en su Model Improvement Partnership Program,
que persiste audio para entrenar modelos.

El punto 2 de `CONSENT_TEXT` (`lib/consent.ts`) declara al paciente que "el audio y el video NO se
almacenan ni se graban en ningún momento". Esa afirmación era falsa, sobre datos sensibles
(Ley 1581/2012, art. 5) transferidos a un tercero en EE. UU.

### B2 — Dos fugas en la purga de transcripciones

`supabase/migrations/0021_transcript_retention_cron.sql`:

- El `delete from transcript_chunks` exigía `transcript_enc is not null` en la consulta padre.
  Si la consolidación falló, o si una corrida previa ya anuló la columna, los chunks quedaban
  huérfanos y **nunca** se purgaban.
- Toda la purga exigía `ended_at is not null`. Una consulta abandonada —el profesional cierra el
  navegador y la sesión nunca se cierra formalmente— conservaba su transcripción **indefinidamente**.

### B3 — Nadie verifica que quien se registra sea profesional

`components/auth/signup-form.tsx` pide nombre de clínica, nombre y correo. Con eso se crea una
clínica y se obtiene acceso a historias clínicas.

## Decisiones

### D1 — Opt-out del programa de mejora de modelos

`mip_opt_out=true` se agrega a `DEEPGRAM_LISTEN_BASE`, de modo que cubre las dos URLs derivadas
(in-person y video) sin posibilidad de divergencia.

**Costo aceptado:** el opt-out renuncia al descuento del 50 % de Deepgram. Es el precio de poder
sostener lo que dice el consentimiento; no es negociable mientras esa frase esté en el documento.

**Protección contra regresión:** `tests/providers.test.ts` afirma que ambas URLs contienen el
parámetro. Es una garantía legal, no una preferencia de configuración — si alguien reescribe la
URL, el test debe romperse.

### D2 — Nueva regla de retención

El principio: **la transcripción no es la historia clínica.** El reporte validado sí lo es, y va
15 años (Resolución 839/2017: 5 en archivo de gestión + 10 en central). La transcripción es un
documento de trabajo intermedio que deja de tener propósito cuando el reporte se valida.

La transcripción se suprime cuando ocurre **lo primero** de:

| # | Condición | Razón |
|---|---|---|
| 1 | Existe reporte con `validated_at` y pasaron 30 días | Ya cumplió su función; el colchón cubre correcciones |
| 2 | `ended_at < now() - 90 días` | Techo duro: nada queda indefinido aunque nunca se valide |
| 3 | `ended_at is null` y `started_at < now() - 90 días` | Consultas abandonadas (cierra B2) |

Implementado en `supabase/migrations/0033_transcript_retention_v2.sql`, que reemplaza la función
`purge_expired_transcripts()` de 0021. El cron de las 3:00 a. m. definido en 0021 se conserva.

**Cambios de diseño respecto de 0021:**

- Se elimina el guard `transcript_enc is not null` del borrado de chunks: se borran por pertenecer
  a una consulta vencida, no por el estado de otra columna (cierra B2).
- Nueva columna `consultations.transcript_purged_at`. Sin ella la política promete una supresión
  que **no se puede demostrar** ante la SIC ni ante un titular que ejerza su derecho de supresión.
  También sirve de predicado de la purga, reemplazando al de 0021.
- Cada purga inserta una fila en `audit_logs` **por clínica** (`clinic_id` es `not null`, y así
  cada clínica ve la suya vía RLS).
- Se usa un único statement con CTEs modificatorios en vez de statements sueltos: todos operan
  sobre el mismo snapshot de `expired`, sin riesgo de divergencia entre el borrado y el update.
- Backfill: las consultas ya purgadas bajo la regla de 0021 reciben `transcript_purged_at` para no
  reevaluarse en cada corrida, y se limpian los chunks huérfanos que 0021 dejó atrás.
  El backfill se limita a consultas con `ended_at` de más de 30 días: marcar solo por
  `transcript_enc is null` atraparía consultas recién terminadas cuya consolidación falló —que
  tienen chunks vivos— y al darlas por purgadas sus chunks no se borrarían nunca, reintroduciendo
  la fuga que la migración corrige.

**Acoplamiento a vigilar:** los plazos de 30/90 días están en la migración y en la política de
tratamiento publicada (`docs/legal/politica-tratamiento-datos-borrador.md`, sección 5). Cambiar
uno obliga a cambiar el otro.

### D3 — Onboarding verificado (diseñado, no implementado)

**Nivel elegido:** carga de documento + revisión manual. La consulta pública de ReTHUS en SISPRO
no expone una API documentada, así que automatizarla sería scraping frágil sobre un servicio
estatal — mal cimiento para un control de cumplimiento. La revisión manual es defendible desde el
día uno y deja rastro auditable.

**Máquina de estados de la cuenta:**

```
pending_documents ──(sube cédula + tarjeta profesional)──> pending_review
pending_review ──(admin aprueba)──> verified
pending_review ──(admin rechaza)──> rejected ──(vuelve a subir)──> pending_review
verified ──(revocación: inhabilitación reportada)──> suspended
```

**Restricción de acceso mientras no esté `verified`:** sin crear pacientes, sin abrir consultas y
sin transcripción. Se permite explorar la aplicación y configurar la clínica, para que el
profesional pueda avanzar mientras espera.

**Componentes:**

| Componente | Responsabilidad |
|---|---|
| Columnas de verificación en `users` | Estado, fecha, quién aprobó, motivo de rechazo |
| Bucket privado de documentos | Cédula y tarjeta profesional, con RLS por clínica |
| Guard de rol | Bloquea las rutas clínicas si el estado no es `verified` |
| Pantalla de estado | Qué falta, qué se subió, en qué va la revisión |
| Cola en `/admin/doctores` | Ver documentos, aprobar o rechazar con motivo |
| Registro en `audit_logs` | Quién aprobó, cuándo, sobre qué documentos |

**Punto sensible:** los documentos de identidad son datos personales de los que **E-Irene es
Responsable** (no Encargado, a diferencia de los datos de pacientes). Necesitan su propio plazo de
conservación en la política, y conviene decidir si se conservan tras el rechazo — probablemente
no, más allá de un período corto de impugnación.

**Hueco encontrado al implementar:** la política `users_update` permite `id = auth.uid()`, es
decir editar la propia fila, y también que un admin de clínica edite a los miembros de su clínica.
Sin protección adicional, un doctor podía ponerse `verification_status = 'verified'` con un PATCH
directo a la API, y un admin podía aprobar a sus colegas — todo el control se caía sin tocar la
interfaz. Lo cierra el trigger `enforce_verification_transition`: con sesión de usuario el único
cambio de estado admitido es el propio envío a revisión, y `verified_by` /
`verification_decided_at` solo los puede fijar service-role. La aprobación pasa por
`requirePlatformAdmin()` en la aplicación y service-role en la base de datos.

**Decisión incómoda del backfill:** las cuentas existentes quedan en `verified`. Nadie revisó sus
credenciales, pero la alternativa —dejarlas en `pending_documents`— cortaría el acceso clínico a
todas las cuentas en producción en el momento del despliegue, incluidas las que están atendiendo
pacientes. Quedan marcadas con una nota en `verification_notes` y aparecen en la cola del admin
para revisión retroactiva.

## Alcance de esta sesión

**Implementado:** D1, D2 y D3.
**Documentado sin implementar:** las piezas de UI del aviso de privacidad
(`docs/legal/aviso-privacidad-borrador.md`, anexo).

## Verificación

- `tests/providers.test.ts` — 12 pruebas en verde, incluidas las dos del opt-out.
- `tests/verification.test.ts` — 19 pruebas de la máquina de estados y de quién puede ejercer.
- Suite completa: 226 en verde. `tests/rls.test.ts` falla por falta de Supabase local (Docker
  apagado), no por estos cambios.
- `tsc --noEmit` y `eslint` limpios.
- Migraciones **0032 y 0033 aplicadas en producción** y verificadas contra el proyecto el
  2026-08-07: columnas, `auth_can_access_clinical()`, trigger `trg_users_verification_guard`,
  políticas `patients_insert` / `consults_insert` con la comprobación de verificación, bucket con
  4 políticas, columna `transcript_purged_at`, purga v2 con techo de 90 días, índice y cron activo.
  Datos consistentes: 0 chunks huérfanos, 0 consultas abandonadas vencidas.

- **0034 aplicada.** Permisos comprobados: `enforce_verification_transition` sin EXECUTE para
  `anon` ni `authenticated`; `auth_can_access_clinical` sin `anon` y **con `authenticated`**, que
  es imprescindible porque las expresiones de las políticas RLS se evalúan con los privilegios de
  quien consulta. El linter dejó de reportar las dos alertas de `anon` y la de la función de
  trigger. Queda la de `authenticated` sobre `auth_can_access_clinical`, inherente al diseño y
  compartida con `auth_clinic_id`, `auth_role` e `is_platform_admin`.

**Se aplicaron a mano desde el editor SQL, así que no quedaron en `supabase_migrations`.** Un
`supabase db push` futuro intentará re-ejecutarlas y fallará (`create type` duplicado). Hay que
registrarlas en el historial antes del próximo push.

### Estado de la purga (2026-08-07)

Ninguna consulta vence todavía, pero dos tienen reporte validado el 2026-07-09, así que cumplen
los 30 días **el 2026-08-08**. La corrida del cron de las 03:00 UTC de esa fecha debería ser la
primera purga real.

Es la comprobación pendiente que más vale: hasta que ocurra, **la rama que escribe en `audit_logs`
nunca se ha ejecutado** (`select count(*) from audit_logs where action='transcript.purge'` = 0), y
es justamente la que produce la evidencia de borrado que promete la política de tratamiento. Hay
que confirmar el 8 o el 9 que aparecieron las filas de auditoría y que `transcript_purged_at`
quedó fijado.

## Pendientes derivados

1. **Confirmar la primera purga real** el 2026-08-08/09: filas en `audit_logs` con
   `action='transcript.purge'` y `transcript_purged_at` fijado.
2. Registrar 0032, 0033 y 0034 en el historial de migraciones para que `db push` no las repita.
3. Cobertura en `tests/rls.test.ts` para lo que solo se puede probar contra Postgres: que un
   doctor sin verificar no pueda insertar pacientes, y que no pueda auto-verificarse.
4. Revisar retroactivamente las 11 cuentas heredadas desde `/admin/verificaciones`.
5. Notificar por correo al profesional cuando su verificación se aprueba o rechaza (hoy solo lo
   ve al entrar a la aplicación).
6. Suscribir DPA/BAA con Deepgram y OpenAI. Sin ellos la política no puede afirmar que las
   transferencias internacionales cuentan con garantías contractuales.
7. Implementar las piezas de UI del aviso de privacidad y el registro de la aceptación del
   profesional (hoy no hay prueba de que aceptó nada).
8. Definir el plazo de conservación de los documentos de identidad en la política de tratamiento.
9. Mover `ENCRYPTION_KEY` a un KMS (pendiente heredado de `docs/COMPLIANCE.md`).

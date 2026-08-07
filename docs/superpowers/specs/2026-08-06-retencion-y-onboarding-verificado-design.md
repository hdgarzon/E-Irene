# Retención de transcripciones y onboarding verificado del profesional

**Fecha:** 2026-08-06
**Estado:** retención implementada · onboarding diseñado, pendiente de implementar

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

Implementado en `supabase/migrations/0031_transcript_retention_v2.sql`, que reemplaza la función
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

**Riesgo abierto mientras no se implemente:** hoy cualquiera puede registrarse y crear historias
clínicas. Por eso la cláusula tercera del documento de vinculación describe el control como
*procedimiento previsto* y no como control vigente: preferimos quedarnos cortos a certificar algo
que no está en producción.

## Alcance de esta sesión

**Implementado:** D1 y D2.
**Documentado sin implementar:** D3, y las piezas de UI del aviso de privacidad
(`docs/legal/aviso-privacidad-borrador.md`, anexo).

## Verificación

- `tests/providers.test.ts` — 12 pruebas en verde, incluidas las dos del opt-out.
- La migración 0031 **no se ha ejecutado**: Docker no estaba disponible en la sesión. Debe
  aplicarse con `npx supabase db reset` y verificarse antes de desplegar.

## Pendientes derivados

1. Aplicar y verificar la migración 0031.
2. Suscribir DPA/BAA con Deepgram y OpenAI. Sin ellos la política no puede afirmar que las
   transferencias internacionales cuentan con garantías contractuales.
3. Implementar D3.
4. Implementar las piezas de UI del aviso de privacidad y el registro de la aceptación del
   profesional (hoy no hay prueba de que aceptó nada).
5. Mover `ENCRYPTION_KEY` a un KMS (pendiente heredado de `docs/COMPLIANCE.md`).

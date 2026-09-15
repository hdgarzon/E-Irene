# Cambios de plan y adicionales — diseño

Fecha: 15-sep-2026. Cubre los puntos 4 a 9 de la lista para los Términos y Condiciones:

4. Upgrade inmediato con prorrateo.
5. Mantener la fecha de renovación después del upgrade.
6. Downgrade programado para la siguiente renovación.
7. Bolsa adicional de 5 h por $25.000, que vence al terminar el ciclo.
8. Gate de videollamadas y saldo de adicionales.
9. Packs de 1, 5 y 10 videollamadas sin vencimiento.

Los puntos 1-3 y 10-12 ya están en producción (migraciones 0041 y 0042).

## Decisiones tomadas

| Tema | Decisión |
|---|---|
| Cobro del upgrade | La diferencia prorrateada del ciclo actual se paga con un **link de pago de Wompi**. El plan sube cuando el pago se aprueba. No se cobra con el token guardado sin que el cliente lo autorice en ese momento. |
| Fecha de renovación | El upgrade **no mueve** `billing_cycle_anchor` ni `current_period_end`. Lo consumido en el ciclo se conserva y los límites del plan nuevo rigen desde ya. |
| Downgrade | Se programa y se aplica en la renovación, cobrando el precio del plan menor. No se borra nada ni se quita acceso: solo no se puede agregar lo que exceda los límites nuevos. Bajar a Free sigue siendo cancelar. |
| Bolsa de transcripción | 5 h por $25.000. Suma al límite del plan hasta el fin del ciclo en que se compra. Se pueden comprar varias. |
| Videollamadas por plan | Free no tiene video. Esencial, Profesional y Clínica lo compran como adicional. Enterprise lo incluye. |
| Packs de video | 1, 5 y 10 videollamadas por $9.000, $45.000 y $90.000. No vencen. |
| Consumo de video | Para iniciar hace falta saldo de al menos 1. Se descuenta una sola vez por consulta y **solo si el paciente se conectó**. |
| Quién compra adicionales | Solo planes pagos con período vigente (Esencial, Profesional, Clínica). Enterprise tiene video y horas por contrato. |

Fuente de precios de adicionales: `docs/costos-vs-planes-2026-09.md` y `docs/modelo-precios-e-irene.xlsx`.

## Lo que hay hoy y condiciona el diseño

- **Compra de plan.** `initiatePlanUpgradeAction` crea un payment link por el precio completo (`billing_checkouts`). El webhook o la reconciliación al volver (`?id=`) llaman a `activate_subscription`, que **re-ancla el ciclo a now()**: reinicia la cuota y cobra precio completo aunque se cambie a mitad de ciclo.
- **Wompi reescribe la referencia de los payment links.** Lo único que identifica un pago de link es la fila de `billing_checkouts`. Hoy toda fila se trata como compra de plan y su monto se valida contra `PLANS[plan]`.
- **La compra no es reintentable.** Se registra `billing_events` antes de activar; si `activate_subscription` falla, el reintento del webhook ve `isNew:false` y nunca activa. Hay que corregirlo antes de sumar tipos de compra.
- **Renovación.** `processRecurringCharges` cobra `PLANS[clinics.plan]`; `renew_subscription_period` nunca cambia el plan; `isStillDueForCharge` y `settleRenewalPayment` exigen el mismo plan que se cobró.
- **Cuota de transcripción.** La decide un solo lugar: `begin_transcription_session` (0039), que recibe el límite del plan desde TypeScript como `p_limit_seconds`. La interfaz lee `PLANS[plan].transcriptionHours` en cuatro sitios.
- **Video.** No hay flag de video por plan. El servidor **no sabe cuándo se conecta el paciente**: después de renderizar `/join/[token]` todo pasa en el navegador. No hay webhook de Daily.
- **Producción.** Video está simulado (faltan `DAILY_API_KEY` y `NEXT_PUBLIC_SITE_URL`). El token de tarjeta de Wompi y el checksum del webhook siguen sin confirmarse con pagos reales.

## 1. Base común: compras por link con cumplimiento idempotente

Upgrade, bolsa y packs son pagos únicos por payment link. Comparten el mismo camino.

**Datos (migración aditiva).**

- `billing_checkouts` suma `kind text not null default 'plan' check (kind in ('plan','upgrade','transcription_pack','video_pack'))`, `quantity int`, `details jsonb not null default '{}'` y `expires_at timestamptz`. Las filas existentes quedan como `plan`.
- Tabla nueva `billing_fulfillments`: `wompi_transaction_id text primary key`, `clinic_id`, `checkout_id`, `kind`, `outcome text check (outcome in ('applied','rejected'))`, `reason`, `amount_in_cents`, `created_at`. Inmutable. Sin políticas para roles de la app; lectura para el admin de la clínica por RPC.

**Cumplimiento.** Una función SQL por tipo (`apply_plan_upgrade`, `grant_transcription_pack`, `grant_video_pack`), `SECURITY DEFINER`, solo `service_role`. Cada una, en la **misma transacción**:

1. Bloquea la fila de la clínica.
2. Inserta en `billing_fulfillments` con `on conflict do nothing`. Si ya existía, devuelve el desenlace anterior (idempotente).
3. Valida y aplica, o registra `rejected` con motivo.

Si algo falla, no queda nada escrito y el reintento del webhook vuelve a intentarlo. El registro en `billing_events` se mantiene como constancia, pero deja de decidir si se aplica.

**Enrutamiento.** Webhook y reconciliación resuelven el checkout como hoy y despachan por `kind`. El monto se valida contra `amount_in_cents` del checkout (lo que se cotizó) y contra las reglas del tipo. Un `kind` desconocido se registra y se deja para revisión; nunca se trata como plan.

**Compras de plan (Free → pago).** Pasan por el mismo cumplimiento idempotente (`kind = 'plan'`) y siguen llamando a `activate_subscription`. Así se corrige el hueco de reintento también para ellas.

**Expiración.** Los links nuevos llevan `expires_at` (Wompi lo acepta en ISO 8601 UTC): 30 minutos para el upgrade, porque es una cotización; 24 horas para bolsas y packs. Un pago que llega con la cotización vencida o el estado cambiado se registra como `rejected` y la clínica queda marcada para revisión y reembolso manual, con aviso visible. No se aplica en silencio ni se descarta en silencio.

## 2. Upgrade con prorrateo (puntos 4 y 5)

**Cuándo aplica.** Plan actual pago (Esencial, Profesional o Clínica) con período vigente y `billing_status = 'activo'`, hacia un plan pago mayor en `PLAN_ORDER`. Enterprise sigue siendo "Contáctanos". Desde Free no hay nada que prorratear: es la compra de plan de siempre, que abre un ciclo nuevo.

**Monto.**

```
ciclo      = [inicio_ciclo, current_period_end)      -- billing_cycle_bounds del ancla
restante   = current_period_end - now()
diferencia = (precio_destino - precio_actual) × restante / duración_del_ciclo
```

Se redondea hacia arriba a pesos enteros. Si queda por debajo del mínimo que acepte Wompi (no está documentado; se confirma en sandbox), se cobra ese mínimo.

**Cotización.** `initiatePlanChangeAction(plan)` calcula el monto en el servidor y crea el checkout `kind = 'upgrade'` con `details = { from_plan, to_plan, period_end, cycle_start, quoted_at }`. La pantalla muestra, antes de ir a Wompi: "Pagas $X hoy por lo que queda del ciclo. Desde el dd/mm pagarás $Y al mes."

**Aplicación — `apply_plan_upgrade(clinic, tx, amount, details)`.** Rechaza si el plan actual no es `from_plan`, si `current_period_end` cambió, si la suscripción terminó, o si el monto no coincide. Si pasa:

- `plan = to_plan`; ancla y fin de período **no se tocan**.
- Si había una cancelación pedida, se revierte: pagar un plan mayor es la decisión contraria. Queda en `audit_logs`.
- Si había un downgrade programado, se anula.
- Si el pago trae `payment_source_id`, reemplaza el token guardado; si no, se conserva.
- `audit_logs`: `subscription.upgraded` con planes, monto y fin de período.

La cuota sigue contando desde el mismo inicio de ciclo, así que lo consumido se conserva y los límites nuevos rigen de inmediato. La siguiente renovación ya cobra el plan nuevo, porque el cron lee `clinics.plan`.

## 3. Downgrade programado (punto 6)

**Datos.** `clinics.scheduled_plan clinic_plan` y `clinics.scheduled_plan_requested_at timestamptz`.

**Programar y anular.** `schedule_plan_downgrade(p_plan)` y `cancel_scheduled_plan_change()`, `SECURITY DEFINER`, para `authenticated` con rol admin de la clínica (igual que la cancelación). Solo hacia un plan pago menor, con suscripción pagada vigente y sin cancelación pedida. Bajar a Free sigue siendo cancelar.

**Aplicación en la renovación.**

- `getClinicsDueForCharge` lee también `scheduled_plan`. El plan a cobrar es `coalesce(scheduled_plan, plan)`: con él se calculan el monto, la referencia y la fila de `billing_scheduled_charges`.
- `isStillDueForCharge` compara los dos campos.
- Nueva sobrecarga `renew_subscription_period(clinic, charged_period_end, charged_plan)`: además de avanzar el período, pone `plan = charged_plan` y limpia `scheduled_plan`. Rechaza (devuelve null y deja constancia) si `charged_plan` ya no es el plan esperado. La versión de dos argumentos se conserva para la ventana de despliegue; hasta que exista código nuevo nadie puede programar un downgrade.
- `end_subscription` limpia `scheduled_plan`. Si la renovación falla, el camino de gracia y fin de suscripción no cambia.
- `platform_set_clinic_plan` también la limpia.

**Límites.** Desde la renovación rigen los del plan menor. Profesionales, pacientes y datos existentes se conservan; `canAddDoctor`, `canAddPatient` y `canStartConsultation` ya impiden agregar por encima del límite.

## 4. Bolsa de transcripción (punto 7)

**Datos.** Tabla `transcription_packs`: `id`, `clinic_id`, `seconds` (18.000), `valid_from`, `valid_until`, `wompi_transaction_id unique`, `amount_in_cents`, `source ('purchase','grant')`, `created_at`. Bloqueada como `transcription_usage`: revoke a `public`, `anon` y `authenticated`; escritura solo por función.

**Compra.** `kind = 'transcription_pack'`, $25.000. Permitida en Esencial, Profesional y Clínica con período vigente. Se bloquea si faltan menos de 24 horas para el fin del ciclo, para no vender horas que vencen de inmediato. La pantalla muestra "vence el dd/mm". `grant_transcription_pack` fija `valid_until` con el `cycle_end` vigente al aprobarse el pago.

**Aplicación.** `begin_transcription_session` se redefine (misma firma):

```
límite_efectivo = p_limit_seconds + suma(seconds) de packs con valid_from <= now() < valid_until
```

`null` sigue significando ilimitado. Las horas de la bolsa **se resuelven dentro de SQL**, no se aceptan por parámetro, así que llamar la RPC directo no permite inflarlas. Un upgrade no mueve el ancla, así que la bolsa sigue vigente. Si una renovación tardía re-ancla el ciclo, la bolsa vence en la fecha original, que ya pasó.

**Interfaz.** `get_transcription_usage()` suma `extra_seconds` y `extra_valid_until`. Un único resolvedor en TypeScript reemplaza las cuatro lecturas directas de `PLANS[plan].transcriptionHours`: las dos barras de uso, `transcriptionUsageLabel` y `quotaExhausted`.

La bolsa suma horas, no consultas: el tope de consultas del plan no cambia.

## 5. Videollamadas: saldo, gate y consumo (puntos 8 y 9)

**Plan.** `PlanLimits` suma `video: "none" | "addon" | "included"`: Free `none`; Esencial, Profesional y Clínica `addon`; Enterprise `included`.

**Datos.**

- `video_credit_ledger`: `id`, `clinic_id`, `delta int`, `reason ('purchase','consumption','adjustment')`, `wompi_transaction_id unique`, `consultation_id unique`, `actor_id`, `note`, `created_at`. Inmutable. El saldo es la suma de `delta`.
- `video_call_reservations`: `consultation_id primary key`, `clinic_id`, `appointment_id`, `status ('held','consumed','released')`, `created_at`, `resolved_at`.
- Saldo disponible = suma del ledger − reservas `held`. Todas las escrituras van por funciones `SECURITY DEFINER`; lectura del saldo por RPC para la propia clínica.

**Compra.** `kind = 'video_pack'` con `quantity` 1, 5 o 10 (monto 9.000 × cantidad). `grant_video_pack` inserta el ledger con `delta = quantity`. No vence.

**Gate al iniciar.** En `startVideoConsultationAction`, antes de `ensureVideoRoom`:

- `none`: no inicia ("Tu plan no incluye videollamadas").
- `included`: inicia sin reservar.
- `addon`: `reserve_video_call(consultation)` bloquea la clínica y crea la reserva solo si el saldo disponible es ≥ 1. Así dos inicios simultáneos con saldo 1 no pasan los dos.

Defensa adicional: el token de Daily del profesional en la página en vivo solo se emite si existe la reserva, o si el plan lo incluye. El selector de modalidad avisa el saldo al agendar una cita por video, pero agendar no consume nada. Los recordatorios siguen creando la sala sin gate.

**El paciente espera al profesional.** `/join/[token]` solo emite el token de Daily del paciente si hay una consulta `in_progress` para la cita; si no, muestra "Tu profesional todavía no inicia la consulta". Sin esto, un paciente que entra antes nunca dispararía la señal de conexión.

**Señal de conexión.** Webhook de Daily `participant.joined`, servidor a servidor:

- El token del paciente se emite con `user_id = "patient:<appointmentId>"` y el del profesional con `doctor:<userId>`. Así se identifica al paciente por su token, no contando participantes.
- Ruta `app/api/webhooks/daily/route.ts`, con el mismo patrón que la de Wompi:
  - Si falta `DAILY_WEBHOOK_HMAC`, responde 503.
  - Verifica `X-Webhook-Signature`: HMAC-SHA256 de `X-Webhook-Timestamp + "." + cuerpo`, con el secreto en base64 decodificado.
  - Responde 200 al ping de verificación `{"test":"test"}`.
  - Responde 200 rápido: tras 3 fallos Daily deja el webhook en `FAILED`.
- Con `user_id` de paciente, busca la cita por id, confirma que `video_room_name` coincide con `payload.room` y toma la consulta `in_progress`. Luego llama a `consume_video_call(consultation, event_id)`: pasa la reserva a `consumed` e inserta el ledger `delta = -1` con `consultation_id` único. Reconexiones, reintentos del webhook o una segunda pestaña no vuelven a descontar.
- Al finalizar la consulta, `release_video_call(consultation)` libera la reserva si nunca se consumió.

**Respaldo por webhook perdido.** Al finalizar, si la reserva sigue `held`, se consulta `GET /v1/meetings?room=<sala>` de Daily. Si algún participante tiene `user_id` del paciente con `join_time` dentro de la consulta, se consume. Daily solo registra a quien estuvo al menos 10 segundos. Si no se puede confirmar, se libera: ante la duda, no cobrar.

**Ajustes.** `platform_adjust_video_credits(clinic, delta, note)` para reembolsos o cortesías desde la consola de plataforma, con `actor_id` y nota obligatoria.

## 6. Interfaz

- **`/settings/plan`:**
  - Planes mayores: "Subir a X: pagas $N hoy".
  - Planes menores: "Cambiar a X en la renovación (dd/mm)".
  - Panel de suscripción: "Cambiará a X el dd/mm · Mantener mi plan".
  - Sección **Adicionales**:
    - Bolsa de 5 h, con horas extra vigentes y vencimiento.
    - Videollamadas, con saldo y packs de 1, 5 y 10.
    - Historial de compras desde `billing_fulfillments`.
- **Barras de consumo:** horas del plan + bolsa.
- **Consultas y citas:** mensajes del gate y aviso de saldo al agendar por video.
- **Consola de plataforma:** saldo de video, bolsas vigentes y ajuste de créditos.
- **Resultado de pago:** mensajes para `applied` y `rejected`. Con `rejected`: "Recibimos tu pago pero no pudimos aplicarlo; te contactamos para reembolsarlo."

## 7. Seguridad, dinero e idempotencia

- **Cumplimiento idempotente.** Cada pago se aplica una sola vez, por `wompi_transaction_id`, en la misma transacción que el cambio.
- **Montos.** Se validan contra lo cotizado y guardado en el checkout, nunca contra lo que diga el cliente.
- **Escrituras.** Toda escritura de planes, bolsas, ledger y reservas va por funciones `SECURITY DEFINER` con grants explícitos. Las tablas nuevas siguen el patrón de 0041/0042: revoke a `public`, `anon` y `authenticated`, y grant a `service_role`.
- **Ante la duda, no cobrar.** Un pago que no se puede aplicar queda `rejected` y marcado para revisión, nunca aplicado a medias. Un video sin confirmación de conexión no se descuenta.
- **Constancia.** Cada paso queda en `audit_logs`.
- **Fallar a la vista.** Si faltan `DAILY_WEBHOOK_HMAC` o la configuración de Daily en producción, el consumo de video no puede funcionar: la ruta responde 503 y `/admin/canales` lo muestra.

## 8. Pruebas

- **Unitarias:**
  - Prorrateo: bordes de ciclo, 28/29/30/31 días, monto mínimo y redondeo.
  - Resolvedor de límites y flag de video.
  - Parser y enrutamiento de checkouts por `kind`.
  - Firma del webhook de Daily, con un vector calculado a mano.
- **Base de datos (Supabase local, con `lockAcrossRuns` donde barran global):**
  - `apply_plan_upgrade`: aplica y conserva ancla y consumo; es idempotente; rechaza estado cambiado; la sesión no puede llamarla.
  - Downgrade: se programa y anula; la renovación aplica el plan y el monto menor; el fin de suscripción lo limpia.
  - `begin_transcription_session` suma la bolsa vigente, ignora la vencida y no acepta horas por parámetro.
  - Reservas: la carrera con saldo 1 deja pasar solo un inicio; el consumo es único por consulta; liberar devuelve el saldo.
  - RLS: una clínica no ve ni toca el saldo, bolsas o compras de otra.
- **Webhooks:**
  - Wompi: una compra de cada `kind` y un reintento tras fallo simulado de la aplicación.
  - Daily: firma válida o inválida, ping, paciente conectado y doctor conectado (no descuenta).
- **E2E:**
  - Upgrade con monto prorrateado visible, simulando la aprobación por la función de servicio.
  - Downgrade programado y anulado.
  - Gate de video con saldo 0 y con saldo 1.
  - Consumo por webhook firmado contra la ruta real, con un secreto de prueba en la configuración de Playwright.

## 9. Entregas

Tres PRs, en orden. Cada uno se despliega solo y es aditivo. Las migraciones se numeran al fusionar, después de la última de `main` (hoy 0055).

1. **Compras idempotentes + upgrade prorrateado + downgrade programado** (puntos 4-6). Incluye la corrección del reintento de compras.
2. **Bolsa de transcripción** (punto 7).
3. **Videollamadas: flag de plan, saldo, packs, gate, espera del paciente y webhook de Daily** (puntos 8-9).

## 10. Prerrequisitos y confirmaciones

- **Wompi:** monto mínimo por transacción en COP; si un pago por link devuelve `payment_source_id` reutilizable; validar el checksum del webhook con un evento real. Se prueba en sandbox antes de producción.
- **Daily en producción:** `DAILY_API_KEY`, `NEXT_PUBLIC_SITE_URL` y el webhook creado con `POST /v1/webhooks` (`url` = `/api/webhooks/daily`, `eventTypes` = `["participant.joined"]`, `hmac`). El PR 3 trae un script que lo crea con la clave del entorno, pero lo corre quien tenga la clave. Sin esto el video sigue simulado y el gate no se puede usar en producción.
- **Términos y Condiciones.** La redacción debe decir:
  - el prorrateo;
  - que la fecha de renovación no cambia;
  - que el downgrade rige desde la renovación;
  - que la bolsa vence al terminar el ciclo;
  - que los packs de video no vencen;
  - que se descuenta solo si el paciente se conecta;
  - que Free no incluye video.

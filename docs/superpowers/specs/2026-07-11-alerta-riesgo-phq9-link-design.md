# Diseño: alerta de riesgo (ítem de autolesión del PHQ-9) en el flujo de link público

**Fecha**: 2026-07-11
**Rama**: `claude/inspiring-mayer-8d97ba` (implementación depende de que `feat/telehealth` — donde vive `createAssessmentViaLink` — esté mergeada primero)
**Estado**: Aprobado, pendiente de plan de implementación

## Resumen

El flujo de link público (paciente completa PHQ-9/GAD-7 sin cuenta, sin personal presente —
ver `docs/superpowers/specs/2026-07-10-portal-paciente-y-ajustes-design.md`, sección 2 y 6) no
tiene, hoy, ningún mecanismo que avise a la clínica si el ítem de ideación
suicida/autolesión del PHQ-9 (`PHQ9_SELF_HARM_ITEM_INDEX = 8` en `lib/psychometrics.ts`) viene
en un valor de riesgo. Cuando el personal administra la escala en persona, está presente y
puede notar/actuar sobre la respuesta directamente; cuando el paciente la completa solo por
link, el resultado queda guardado y solo se ve si alguien entra a revisar el expediente
después.

Contexto de exploración previa: se confirmó que `PHQ9_SELF_HARM_ITEM_INDEX` no se usa hoy en
ningún lugar salvo un test que verifica el texto de la pregunta — ningún código inspecciona el
valor de esa respuesta. También se confirmó que el flujo de link público está incompleto: existen
`patient_links`, el envío del correo con el link (`buildPatientLinkEmail`) y las funciones
`createConsentViaLink`/`createAssessmentViaLink` (rama `feat/telehealth`), pero la página
pública donde el paciente llena el formulario (`app/enlace/[token]/page.tsx`) todavía no existe.
Este diseño se implementa junto con esa página, no después.

Este diseño agrega: (1) detección del umbral de riesgo al guardar, (2) un correo de alerta al
personal relevante, (3) un banner persistente en el dashboard como fuente de verdad
independiente del correo, y (4) recursos de crisis mostrados directamente al paciente si su
respuesta activó el umbral.

## Alcance

Aplica **solo** a escalas PHQ-9 completadas vía link público (`psychometric_assessments.link_id
is not null`). Las administradas por personal en consulta quedan fuera del correo/banner de
alerta — el personal ya está presente en ese caso y puede actuar directamente sobre la
respuesta. (El campo `risk_flag`, sección "Modelo de datos", sí se calcula para cualquier
PHQ-9 riesgoso, por ser un reflejo fiel del dato, pero el correo y el banner filtran por
`link_id is not null`.)

Fuera de alcance: SMS/WhatsApp (no hay proveedor implementado hoy — solo `getEmailProvider()`);
un concepto de "profesional asignado" persistente en `patients` (no existe en el modelo de
datos hoy; se resuelve vía próxima cita, ver más abajo).

## Umbral de riesgo

Cualquier valor de respuesta > 0 en el ítem 9 del PHQ-9 (escala 0-3: Nunca / Varios días / Más
de la mitad de los días / Casi todos los días) dispara la alerta. Es el criterio clínico
habitual para este ítem — incluso "varios días" amerita seguimiento, no solo el valor máximo.

```ts
// lib/psychometrics.ts, junto a PHQ9_SELF_HARM_ITEM_INDEX
export function isPhq9SelfHarmRisk(type: AssessmentType, answers: number[]): boolean {
  return type === "phq9" && answers[PHQ9_SELF_HARM_ITEM_INDEX] > 0;
}
```

## Modelo de datos

Nueva migración agregando dos columnas a `psychometric_assessments`:

```sql
alter table psychometric_assessments
  add column risk_flag boolean not null default false,
  add column risk_acknowledged_at timestamptz;
```

- `risk_flag`: calculado en el momento de guardar (`createAssessment` y
  `createAssessmentViaLink`) vía `isPhq9SelfHarmRisk`. Se guarda en texto plano (no cifrado,
  a diferencia de `payload_enc`) para que el banner del dashboard pueda filtrar por índice sin
  descifrar cada fila.
- `risk_acknowledged_at`: nullable, se llena cuando el personal marca la alerta como atendida
  desde el banner. Sin esto la alerta quedaría visible indefinidamente.

Ambas funciones de guardado (`createAssessment` en `lib/db/assessments.ts` y
`createAssessmentViaLink`) pasan a setear `risk_flag: isPhq9SelfHarmRisk(input.type,
input.result.answers)` en el insert.

## Resolución del destinatario del correo

Nuevo módulo `lib/db/risk-alerts.ts`.

```ts
async function getNextAppointmentDoctor(patientId: string): Promise<{ id: string; fullName: string; email: string } | null>
```

Usa el cliente admin (la resolución corre desde un contexto sin sesión). Busca la cita futura
más próxima del paciente (`starts_at > now()`, no cancelada), ordenada ascendente, y devuelve el
doctor asociado (`appointments.doctor_id` → `users`).

Si no hay cita futura: fallback a **todos** los usuarios `admin`/`doctor` de la clínica. Se
agrega una variante admin-client de `listDoctors()` (la actual, en `lib/db/clinic.ts`, usa
`createClient()` con sesión y no sirve en este contexto sin sesión):

```ts
async function listDoctorsPublic(clinicId: string): Promise<DoctorOption[]>
```

Si ni siquiera hay doctores/admins en la clínica (caso borde), no se envía correo — se registra
igual el `audit_log` y el `risk_flag`/banner siguen siendo la red de seguridad.

## Envío y trazabilidad

```ts
async function alertOnRiskyAssessment(params: {
  clinicId: string;
  patientId: string;
  assessmentId: string;
  linkId: string;
  type: AssessmentType;
  answers: number[];
  clinicName: string;
}): Promise<void>
```

En `lib/db/risk-alerts.ts`. Se invoca desde la Server Action pública que se construirá para
`app/enlace/[token]` (POST del formulario de escala), inmediatamente después de
`createAssessmentViaLink`.

Flujo:
1. Si `!isPhq9SelfHarmRisk(type, answers)`, retorna sin hacer nada.
2. Resuelve destinatario(s) (sección anterior).
3. Envía un correo **mínimo**: nombre del paciente + link directo a su expediente en la app.
   Sin puntaje, sin severidad, sin la respuesta del ítem — ningún dato clínico viaja por correo,
   igual que el patrón ya usado en `buildReportReadyEmail` ("Aviso 'reporte listo' al paciente
   (sin contenido clínico)"). Nueva plantilla `buildRiskAlertEmail` en `lib/email/templates.ts`.
4. Registra el intento en `notifications` vía nueva `recordNotificationPublic` (mismo patrón
   admin-client que `logAuditPublic` respecto a `logAudit`) con `type: 'risk_alert'`.
5. Registra en `audit_logs` vía `logAuditPublic` (`action: 'assessment.risk_alert_sent'`,
   `entityType: 'psychometric_assessment'`, `entityId: assessmentId`).

Los pasos 3-4 van envueltos en `try/catch`, siguiendo el patrón ya usado en
`runConsultationAnalysis` para el correo de "reporte listo": un fallo de envío se loguea
(`logger.warn("risk_alert.send_failed", ...)`) y se registra `status: 'failed'` en
`notifications`, pero **nunca** bloquea ni revierte el guardado de la escala, que ya ocurrió
antes de intentar alertar.

## Banner en el dashboard

`app/(app)/dashboard/page.tsx` agrega una consulta (sesión de personal, RLS normal) por escalas
con `risk_flag = true AND risk_acknowledged_at IS NULL AND link_id IS NOT NULL`, scoped a la
clínica del usuario automáticamente por RLS.

Cada fila del banner muestra el paciente y un botón "Marcar como atendido" → nueva Server Action
que setea `risk_acknowledged_at = now()` y registra `logAudit` (`action:
'assessment.risk_acknowledged'`, `entityId: assessmentId`).

Este banner es la **fuente de verdad independiente** del correo: como consulta la tabla
directamente (no el log de `notifications`), sigue mostrando la alerta aunque el envío de correo
haya fallado silenciosamente.

## Respuesta inmediata al paciente

En la pantalla de confirmación de `app/enlace/[token]` (tras enviar el formulario de PHQ-9), si
`isPhq9SelfHarmRisk` es verdadero, se muestra un bloque adicional con líneas de ayuda/crisis
(candidato: Línea 106 — línea nacional de salud mental en Colombia), independiente de que el
personal reaccione a tiempo al correo/banner.

**El texto exacto de este bloque (qué línea, qué mensaje) se redacta y se comparte para revisión
antes de publicarlo** — mismo criterio ya aplicado a la página pública de seguridad en el diseño
de link único: no se inventa contenido clínico sin validación explícita.

## Manejo de errores

- Guardado de la escala (`createAssessmentViaLink`) nunca se bloquea por la lógica de alerta —
  la respuesta del paciente se persiste primero, siempre.
- Fallo al resolver destinatario (sin cita, sin doctores en la clínica) → no lanza excepción,
  simplemente no hay a quién enviar correo; el banner sigue siendo la red de seguridad.
- Fallo al enviar el correo (proveedor caído, etc.) → capturado, logueado, registrado como
  `notifications.status = 'failed'`; no afecta el resto del flujo.
- Fallo al registrar `audit_logs`/`notifications` → no debería ocurrir en condiciones normales
  (mismo cliente admin ya usado para el insert principal), pero si ocurre no debe reventar la
  respuesta HTTP al paciente — el paciente ya completó su escala exitosamente.

## Pruebas

- Unit tests de `isPhq9SelfHarmRisk`: valores 0/1/2/3 en el ítem 9, y que GAD-7 nunca dispare
  (no tiene ese ítem).
- Unit/integration tests de `getNextAppointmentDoctor`: con cita futura, sin cita futura (solo
  pasada o ninguna), múltiples citas futuras (debe tomar la más próxima).
- Unit/integration tests de `listDoctorsPublic`: clínica con doctores, clínica sin ningún
  admin/doctor.
- Tests de `alertOnRiskyAssessment`: caso feliz (con destinatario, correo enviado), caso
  fallback (sin cita, cae a todos los doctores), caso sin destinatario alguno (no revienta),
  caso de fallo de envío (no propaga excepción hacia el caller).
- Test de que `risk_flag` se setea correctamente en `createAssessment` y
  `createAssessmentViaLink` para respuestas riesgosas y no riesgosas.
- Test del banner del dashboard: solo muestra filas con `link_id is not null AND risk_flag =
  true AND risk_acknowledged_at is null`; desaparece tras "Marcar como atendido".

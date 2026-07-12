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
personal relevante, (3) que las respuestas de riesgo aparezcan en la sección "Alertas de
riesgo" que **ya existe** en el dashboard (`listRiskAlerts()`, alimentada hoy solo por el
análisis de IA de consultas — ver "Banner en el dashboard"), y (4) recursos de crisis
mostrados directamente al paciente si su respuesta activó el umbral.

**Nota de revisión (post-aprobación inicial):** al explorar el dashboard para escribir el plan
de implementación se encontró que ya existe un mecanismo de "Alertas de riesgo" (`lib/db/
reports.ts`, `listRiskAlerts()`) que calcula la alerta **al leer** — descifra `payload_enc` de
reportes recientes y filtra por categorías de riesgo con nivel `moderado`/`alto` — sin columnas
de estado persistidas ni "marcar como atendido". Las secciones "Modelo de datos" y "Banner en
el dashboard" de este documento se revisaron para seguir ese mismo patrón en vez de introducir
uno nuevo y paralelo.

## Alcance

Aplica **solo** a escalas PHQ-9 completadas vía link público (`psychometric_assessments.link_id
is not null`). Las administradas por personal en consulta quedan fuera del correo/banner de
alerta — el personal ya está presente en ese caso y puede actuar directamente sobre la
respuesta.

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

Sin cambios de esquema. Igual que `listRiskAlerts()` (que no persiste ningún flag de riesgo de
consulta — lo recalcula al leer, descifrando `payload_enc`), la señal de riesgo del PHQ-9 se
recalcula al leer con `isPhq9SelfHarmRisk`, sin columna nueva en `psychometric_assessments`.

## Resolución del destinatario del correo

Nuevo módulo `lib/db/risk-alerts.ts`.

```ts
async function getNextAppointmentDoctor(patientId: string): Promise<{ id: string; fullName: string; email: string } | null>
```

Usa el cliente admin (la resolución corre desde un contexto sin sesión). Busca la cita futura
más próxima del paciente (`scheduled_at > now()`, `status <> 'cancelled'`), ordenada ascendente
por `scheduled_at`, y devuelve el doctor asociado (`appointments.doctor_id` → `users`, incluyendo
`email`).

Si no hay cita futura: fallback a **todos** los usuarios `admin`/`doctor` de la clínica. Se
agrega una variante admin-client de `listDoctors()` (la actual, en `lib/db/clinic.ts`, usa
`createClient()` con sesión y no sirve en este contexto sin sesión):

```ts
async function listDoctorsPublic(clinicId: string): Promise<DoctorOption[]>
```

Si ni siquiera hay doctores/admins en la clínica (caso borde), no se envía correo — se registra
igual el `audit_log`, y la escala sigue apareciendo en el banner del dashboard (sección
siguiente) como red de seguridad.

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

`app/(app)/dashboard/page.tsx` ya tiene una sección "Alertas de riesgo" (solo visible para
`isClinician`) alimentada por `listRiskAlerts()` (`lib/db/reports.ts`), que lista reportes de
consulta recientes con categorías de riesgo IA en nivel `moderado`/`alto`. En vez de crear una
sección paralela, la extendemos para que también muestre escalas PHQ-9 riesgosas vía link.

Nueva función en `lib/db/assessments.ts`, mismo patrón de `listRiskAlerts()` (query + decrypt +
filtro al leer, sin columna de estado):

```ts
export interface Phq9RiskAlert {
  assessmentId: string;
  patientId: string;
  patientName: string;
  date: string;
}

export async function listPhq9RiskAlerts(limit = 50): Promise<Phq9RiskAlert[]>
```

Consulta `psychometric_assessments` (sesión de personal, RLS normal — scoped a la clínica
automáticamente) filtrando `type = 'phq9' AND link_id IS NOT NULL`, ordenada por
`administered_at` descendente, limitada a `limit`. Para cada fila descifra `payload_enc` y
conserva solo las que cumplen `isPhq9SelfHarmRisk`, igual que `listRiskAlerts` descarta reportes
sin `riskFlags` o con nivel bajo. Un fallo de descifrado en una fila se loguea
(`logger.warn("phq9_risk_alert.payload_decrypt_failed", ...)`) y se omite esa fila sin romper
la lista completa (mismo manejo que `listRiskAlerts`).

En `DashboardPage`, se llama `listPhq9RiskAlerts()` junto a `listRiskAlerts()` (ambas solo si
`isClinician`) y se renderiza una segunda lista dentro de la misma sección `<section>` de
"Alertas de riesgo" (mismo estilo de tarjeta/Badge), con cada fila enlazando a
`/patients/${patientId}` (no `/consultations/${id}`, porque no hay consulta asociada) y una
etiqueta fija "Autolesión · PHQ-9" en vez de las categorías/niveles de IA — para distinguir
visualmente el origen del dato (autorreporte directo del paciente vs. inferencia de IA sobre la
consulta) sin implicar el mismo tipo de "nivel".

Como no hay estado de "atendido" —tampoco lo tienen hoy las alertas de consulta—, la alerta deja
de aparecer naturalmente al salir de la ventana de `limit` conforme se acumulan más registros
recientes. Esto es consistente con el comportamiento actual del dashboard, no una limitación
nueva introducida por este diseño.

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
  simplemente no hay a quién enviar correo; el banner del dashboard (que no depende de este
  paso) sigue siendo la red de seguridad.
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
- Tests de `listPhq9RiskAlerts`: incluye escalas PHQ-9 riesgosas con `link_id` no nulo; excluye
  GAD-7, escalas sin `link_id`, y PHQ-9 con el ítem de autolesión en 0; una fila con
  `payload_enc` corrupto se omite sin romper el resto de la lista.

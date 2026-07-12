# Alerta de riesgo PHQ-9 (link público) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cuando una escala PHQ-9 completada vía link público (`link_id` no nulo) trae el ítem
de autolesión (índice 8) en un valor > 0, avisar por correo al personal relevante y hacer que
la escala aparezca en la sección "Alertas de riesgo" del dashboard — que hoy solo muestra
riesgo detectado por IA en consultas.

**Architecture:** Detección pura (`isPhq9SelfHarmRisk`) reutilizada en dos caminos: (1) un
módulo nuevo `lib/db/risk-alerts.ts` que resuelve destinatario (doctor de la próxima cita, o
fallback a todo el personal admin/doctor de la clínica) y envía un correo mínimo sin contenido
clínico, invocado **desde dentro de `createAssessmentViaLink`** (ver nota de desviación abajo);
y (2) una función de lectura `listPhq9RiskAlerts` en `lib/db/assessments.ts` que sigue
exactamente el patrón ya usado por `listRiskAlerts()` en `lib/db/reports.ts` (calcula el riesgo
al leer, descifrando `payload_enc`, sin columnas de estado nuevas) y se fusiona visualmente con
esa misma sección del dashboard.

**Desviación deliberada del spec:** el spec
(`docs/superpowers/specs/2026-07-11-alerta-riesgo-phq9-link-design.md`) dice que la alerta "se
invoca desde la Server Action pública que se construirá para `app/enlace/[token]`,
inmediatamente después de `createAssessmentViaLink`". Esa Server Action y esa página **no
existen todavía en ninguna rama** — es una pieza grande y separada, ya bosquejada en
`docs/superpowers/specs/2026-07-10-portal-paciente-y-ajustes-design.md`, fuera del alcance de
este plan. Para no dejar la alerta dependiendo de que un código futuro recuerde invocarla, este
plan la llama **desde el final de `createAssessmentViaLink` misma** — mismo momento ("justo
después del insert"), pero sin depender de un caller que aún no existe, y sin que un futuro
caller pueda olvidarla. El resto del spec (umbral, contenido del correo, resolución de
destinatario, banner) se implementa tal cual está escrito.

**Fuera de alcance de este plan** (ver spec, sección "Respuesta inmediata al paciente"): el
bloque de recursos de crisis en la pantalla de confirmación del link público. Esa pantalla no
existe todavía y su copy debe redactarse y validarse por separado antes de publicarse — queda
para cuando se construya `app/enlace/[token]`, usando `isPhq9SelfHarmRisk` (ya implementado
aquí) para decidir si mostrarlo.

**Tech Stack:** Next.js 16 / TypeScript, Supabase (Postgres + `@supabase/supabase-js`), Vitest,
Resend (vía `getEmailProvider()`).

**Rama base:** Este plan asume que `feat/telehealth` (donde viven `createAssessmentViaLink`,
`patient_links`, `listRiskAlerts`, etc.) ya está mergeada en la rama de trabajo. Todas las rutas
de archivo referidas abajo son las de esa rama.

**Convención de pruebas de este repo (verificado explorando `tests/`):** las funciones de
`lib/db/*.ts` que hacen queries/writes a Supabase (`listRiskAlerts`, `listAppointments`,
`createAppointment`, etc.) **no tienen test unitario/integración** en este proyecto — solo
`tests/rls.test.ts` toca una instancia real de Supabase, y solo para políticas RLS. Las
funciones puras (parsing, scoring, plantillas de email, tokens) sí se testean con Vitest. Este
plan sigue esa misma convención: TDD para toda la lógica pura, sin test file para las funciones
que son wrappers finos de queries a Supabase (se verifican con `npm run typecheck` y, cuando la
página pública exista, con verificación manual end-to-end).

---

### Task 1: `isPhq9SelfHarmRisk` — detección pura del umbral de riesgo

**Files:**
- Modify: `lib/psychometrics.ts`
- Test: `tests/psychometrics.test.ts`

- [ ] **Step 1: Write the failing test**

Añade al final de `tests/psychometrics.test.ts` (después del último `describe`, mismo archivo,
mismos imports — añade `isPhq9SelfHarmRisk` a la lista de imports de `@/lib/psychometrics`):

```ts
describe("isPhq9SelfHarmRisk", () => {
  it("es true si el ítem de autolesión (índice 8) es > 0", () => {
    const answers = [0, 0, 0, 0, 0, 0, 0, 0, 1];
    expect(isPhq9SelfHarmRisk("phq9", answers)).toBe(true);
  });

  it("es true para cualquier valor > 0 en ese ítem (1, 2 o 3)", () => {
    expect(isPhq9SelfHarmRisk("phq9", [0, 0, 0, 0, 0, 0, 0, 0, 1])).toBe(true);
    expect(isPhq9SelfHarmRisk("phq9", [0, 0, 0, 0, 0, 0, 0, 0, 2])).toBe(true);
    expect(isPhq9SelfHarmRisk("phq9", [0, 0, 0, 0, 0, 0, 0, 0, 3])).toBe(true);
  });

  it("es false si el ítem de autolesión es 0", () => {
    const answers = [3, 3, 3, 3, 3, 3, 3, 3, 0];
    expect(isPhq9SelfHarmRisk("phq9", answers)).toBe(false);
  });

  it("es false para GAD-7 sin importar las respuestas (no tiene ese ítem)", () => {
    const answers = [3, 3, 3, 3, 3, 3, 3];
    expect(isPhq9SelfHarmRisk("gad7", answers)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/psychometrics.test.ts`
Expected: FAIL — `isPhq9SelfHarmRisk is not exported from "@/lib/psychometrics"` (o error de
tipo equivalente de TypeScript/Vitest).

- [ ] **Step 3: Write minimal implementation**

En `lib/psychometrics.ts`, justo debajo de `PHQ9_SELF_HARM_ITEM_INDEX` (línea 53):

```ts
/**
 * true si la respuesta al ítem de ideación suicida/autolesión del PHQ-9 es
 * mayor a 0 (cualquier frecuencia reportada, no solo la máxima) — criterio
 * clínico habitual para este ítem específico.
 */
export function isPhq9SelfHarmRisk(type: AssessmentType, answers: number[]): boolean {
  return type === "phq9" && answers[PHQ9_SELF_HARM_ITEM_INDEX] > 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/psychometrics.test.ts`
Expected: PASS (todos los tests del archivo, incluyendo los 4 nuevos).

- [ ] **Step 5: Commit**

```bash
git add lib/psychometrics.ts tests/psychometrics.test.ts
git commit -m "feat(psychometrics): agregar isPhq9SelfHarmRisk"
```

---

### Task 2: `buildRiskAlertEmail` — plantilla de correo mínima al personal

**Files:**
- Modify: `lib/email/templates.ts`
- Test: `tests/email.test.ts`

- [ ] **Step 1: Write the failing test**

Añade a `tests/email.test.ts`, dentro del `describe("email", ...)` existente, y añade
`buildRiskAlertEmail` a los imports de `@/lib/email/templates`:

```ts
it("plantilla de alerta de riesgo no expone datos clínicos", () => {
  const msg = buildRiskAlertEmail({
    to: "doctor@correo.co",
    doctorName: "Dra. Pérez",
    patientName: "Ana",
    clinicName: "Centro Irene",
    patientUrl: "https://e-irene.co/patients/abc-123",
  });
  expect(msg.to).toBe("doctor@correo.co");
  expect(msg.subject).toContain("Alerta");
  expect(msg.html).toContain("Ana");
  expect(msg.html).toContain("https://e-irene.co/patients/abc-123");
  expect(msg.html).not.toMatch(/PHQ|puntaje|sever/i);
  expect(msg.text).toContain("Ana");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/email.test.ts`
Expected: FAIL — `buildRiskAlertEmail is not exported from "@/lib/email/templates"`.

- [ ] **Step 3: Write minimal implementation**

En `lib/email/templates.ts`, al final del archivo (después de `buildPatientLinkEmail`):

```ts
export function buildRiskAlertEmail(input: {
  to: string;
  doctorName: string;
  patientName: string;
  clinicName: string;
  patientUrl: string;
}): EmailMessage {
  const text = `Hola ${input.doctorName}, ${input.patientName} completó un cuestionario en ${input.clinicName} con una respuesta que requiere tu atención. Revísalo aquí: ${input.patientUrl}`;
  return {
    to: input.to,
    subject: "Alerta: respuesta que requiere tu atención",
    text,
    html: wrap(
      "Alerta de seguimiento",
      `<p>Hola <strong>${input.doctorName}</strong>,</p>
       <p><strong>${input.patientName}</strong> completó un cuestionario de seguimiento en
       <strong>${input.clinicName}</strong> con una respuesta que requiere tu atención
       cercana.</p>
       <p style="margin:20px 0">
         <a href="${input.patientUrl}" style="background:#635bff;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">
           Ver expediente del paciente
         </a>
       </p>
       <p style="font-size:13px;color:#5b6b7c">Por privacidad del paciente, el detalle clínico no se envía por correo.</p>`,
    ),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/email.test.ts`
Expected: PASS (todos los tests del archivo, incluyendo el nuevo).

- [ ] **Step 5: Commit**

```bash
git add lib/email/templates.ts tests/email.test.ts
git commit -m "feat(email): agregar plantilla buildRiskAlertEmail"
```

---

### Task 3: `recordNotificationPublic` — registrar el intento de alerta sin sesión

**Files:**
- Modify: `lib/db/notifications.ts`

- [ ] **Step 1: Write the implementation**

`lib/db/notifications.ts` completo pasa a:

```ts
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type NotificationStatus = "pending" | "sent" | "failed";
type NotificationChannel = "email" | "whatsapp";

/** Registra el envío (o intento) de una notificación. */
export async function recordNotification(
  clinicId: string,
  input: {
    patientId?: string | null;
    appointmentId?: string | null;
    channel?: NotificationChannel;
    type: string;
    status: NotificationStatus;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("notifications").insert({
    clinic_id: clinicId,
    patient_id: input.patientId ?? null,
    appointment_id: input.appointmentId ?? null,
    channel: input.channel ?? "email",
    type: input.type,
    status: input.status,
    payload: (input.payload ?? {}) as never,
    sent_at: input.status === "sent" ? new Date().toISOString() : null,
  });
  if (error) throw error;
}

/**
 * Igual que `recordNotification`, pero para el flujo de link público sin
 * sesión: usa el cliente service-role (mismo patrón que `logAuditPublic` en
 * `lib/db/audit.ts`).
 */
export async function recordNotificationPublic(
  clinicId: string,
  input: {
    patientId?: string | null;
    channel?: NotificationChannel;
    type: string;
    status: NotificationStatus;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("notifications").insert({
    clinic_id: clinicId,
    patient_id: input.patientId ?? null,
    appointment_id: null,
    channel: input.channel ?? "email",
    type: input.type,
    status: input.status,
    payload: (input.payload ?? {}) as never,
    sent_at: input.status === "sent" ? new Date().toISOString() : null,
  });
  if (error) throw error;
}
```

No hay test file para `lib/db/notifications.ts` hoy (`recordNotification` tampoco tiene uno) —
sigue la convención de este repo descrita en el header del plan.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: sin errores nuevos.

- [ ] **Step 3: Commit**

```bash
git add lib/db/notifications.ts
git commit -m "feat(notifications): agregar recordNotificationPublic para flujo sin sesión"
```

---

### Task 4: `listDoctorsPublic` — destinatarios de fallback sin sesión

**Files:**
- Modify: `lib/db/clinic.ts`

- [ ] **Step 1: Write the implementation**

Añade a `lib/db/clinic.ts` (después de `listDoctors`, que usa `createClient()` con sesión y no
sirve en un contexto sin sesión):

```ts
import { createAdminClient } from "@/lib/supabase/admin";

export interface DoctorContact {
  id: string;
  fullName: string;
  email: string;
}

/**
 * Como `listDoctors`, pero para el flujo de link público sin sesión: usa el
 * cliente service-role y recibe `clinicId` explícito (no hay `auth_clinic_id()`
 * disponible sin JWT de usuario). Incluye `email` porque se usa para enviar
 * alertas, a diferencia de `listDoctors` (solo para selectores en la UI).
 */
export async function listDoctorsPublic(clinicId: string): Promise<DoctorContact[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("users")
    .select("id, full_name, email")
    .eq("clinic_id", clinicId)
    .in("role", ["admin", "doctor"])
    .order("full_name", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((u) => ({ id: u.id, fullName: u.full_name, email: u.email }));
}
```

Añade el import de `createAdminClient` al inicio del archivo junto al de `createClient`
existente.

Sin test file — mismo motivo que Task 3.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: sin errores nuevos.

- [ ] **Step 3: Commit**

```bash
git add lib/db/clinic.ts
git commit -m "feat(clinic): agregar listDoctorsPublic para flujo sin sesión"
```

---

### Task 5: `getNextAppointmentDoctor` — resolver destinatario principal

**Files:**
- Create: `lib/db/risk-alerts.ts`

- [ ] **Step 1: Write the implementation**

```ts
// lib/db/risk-alerts.ts
import { createAdminClient } from "@/lib/supabase/admin";
import type { DoctorContact } from "@/lib/db/clinic";

/**
 * Doctor de la cita futura más próxima del paciente (no cancelada). Usa el
 * cliente service-role porque esta resolución corre desde el flujo de link
 * público, sin sesión de personal.
 */
export async function getNextAppointmentDoctor(patientId: string): Promise<DoctorContact | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("appointments")
    .select("doctor:users!appointments_doctor_id_fkey(id, full_name, email)")
    .eq("patient_id", patientId)
    .neq("status", "cancelled")
    .gt("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const doctor = (data as unknown as { doctor: { id: string; full_name: string; email: string } | null } | null)
    ?.doctor;
  if (!doctor) return null;
  return { id: doctor.id, fullName: doctor.full_name, email: doctor.email };
}
```

Sin test file — mismo motivo que Task 3 (wrapper fino de una query a Supabase).

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: sin errores nuevos.

- [ ] **Step 3: Commit**

```bash
git add lib/db/risk-alerts.ts
git commit -m "feat(risk-alerts): agregar getNextAppointmentDoctor"
```

---

### Task 6: `alertOnRiskyAssessment` — enviar y registrar la alerta

**Files:**
- Modify: `lib/db/risk-alerts.ts`

- [ ] **Step 1: Write the implementation**

Añade a `lib/db/risk-alerts.ts` (mismo archivo de Task 5):

```ts
import { isPhq9SelfHarmRisk, type AssessmentType } from "@/lib/psychometrics";
import { listDoctorsPublic } from "@/lib/db/clinic";
import { getPatientForLink } from "@/lib/db/patients";
import { getEmailProvider } from "@/lib/email/providers";
import { buildRiskAlertEmail } from "@/lib/email/templates";
import { recordNotificationPublic } from "@/lib/db/notifications";
import { logAuditPublic } from "@/lib/db/audit";
import { logger } from "@/lib/logger";

/**
 * Si la escala indica riesgo (autolesión en el PHQ-9), avisa por correo al
 * doctor de la próxima cita del paciente (o, si no hay ninguna, a todo el
 * personal admin/doctor de la clínica). Nunca lanza excepción — un fallo de
 * envío se loguea y se registra como notificación fallida, pero no debe
 * afectar al caller (la escala ya quedó guardada).
 */
export async function alertOnRiskyAssessment(params: {
  clinicId: string;
  clinicName: string;
  patientId: string;
  assessmentId: string;
  type: AssessmentType;
  answers: number[];
}): Promise<void> {
  if (!isPhq9SelfHarmRisk(params.type, params.answers)) return;

  try {
    const [nextDoctor, patient] = await Promise.all([
      getNextAppointmentDoctor(params.patientId),
      getPatientForLink(params.patientId),
    ]);
    const recipients = nextDoctor
      ? [nextDoctor]
      : await listDoctorsPublic(params.clinicId);

    if (recipients.length === 0) {
      await logAuditPublic({
        clinicId: params.clinicId,
        action: "assessment.risk_alert_no_recipient",
        entityType: "psychometric_assessment",
        entityId: params.assessmentId,
      });
      return;
    }

    const patientName = patient?.fullName ?? "(nombre no disponible)";
    const patientUrl = `${process.env.NEXT_PUBLIC_APP_URL}/patients/${params.patientId}`;

    for (const doctor of recipients) {
      try {
        await getEmailProvider().send(
          buildRiskAlertEmail({
            to: doctor.email,
            doctorName: doctor.fullName,
            patientName,
            clinicName: params.clinicName,
            patientUrl,
          }),
        );
        await recordNotificationPublic(params.clinicId, {
          patientId: params.patientId,
          type: "risk_alert",
          status: "sent",
        });
      } catch (error) {
        logger.warn("risk_alert.send_failed", { clinicId: params.clinicId, patientId: params.patientId, error });
        await recordNotificationPublic(params.clinicId, {
          patientId: params.patientId,
          type: "risk_alert",
          status: "failed",
        });
      }
    }

    await logAuditPublic({
      clinicId: params.clinicId,
      action: "assessment.risk_alert_sent",
      entityType: "psychometric_assessment",
      entityId: params.assessmentId,
      metadata: { recipientCount: recipients.length },
    });
  } catch (error) {
    // Resolución de destinatario (query a appointments/patients) falló —
    // no debe bloquear el guardado de la escala, que ya ocurrió.
    logger.error("risk_alert.resolution_failed", { clinicId: params.clinicId, patientId: params.patientId, error });
  }
}
```

Sin test file — mismo motivo que Task 3 (orquesta varias llamadas a Supabase/proveedor de
correo; no hay precedente de test para funciones equivalentes como `runConsultationAnalysis`).

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: sin errores nuevos.

- [ ] **Step 3: Commit**

```bash
git add lib/db/risk-alerts.ts
git commit -m "feat(risk-alerts): agregar alertOnRiskyAssessment"
```

---

### Task 7: invocar la alerta desde `createAssessmentViaLink`

**Files:**
- Modify: `lib/db/assessments.ts:54-71` (función `createAssessmentViaLink`)

- [ ] **Step 1: Write the implementation**

En `lib/db/assessments.ts`, la función `createAssessmentViaLink` pasa de:

```ts
export async function createAssessmentViaLink(
  clinicId: string,
  input: { patientId: string; type: AssessmentType; result: AssessmentResult; linkId: string },
): Promise<Assessment> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("psychometric_assessments")
    .insert({
      clinic_id: clinicId,
      patient_id: input.patientId,
      link_id: input.linkId,
      type: input.type,
      payload_enc: encrypt(JSON.stringify(input.result)),
    })
    .select(COLS)
    .single();
  if (error) throw error;
  return mapRow(data as unknown as AssessmentRow);
}
```

a:

```ts
export async function createAssessmentViaLink(
  clinicId: string,
  clinicName: string,
  input: { patientId: string; type: AssessmentType; result: AssessmentResult; linkId: string },
): Promise<Assessment> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("psychometric_assessments")
    .insert({
      clinic_id: clinicId,
      patient_id: input.patientId,
      link_id: input.linkId,
      type: input.type,
      payload_enc: encrypt(JSON.stringify(input.result)),
    })
    .select(COLS)
    .single();
  if (error) throw error;
  const assessment = mapRow(data as unknown as AssessmentRow);

  // Se espera (await): en un entorno serverless (Vercel) una llamada async
  // sin await puede quedar truncada si la función termina apenas se envía la
  // respuesta. alertOnRiskyAssessment nunca lanza (captura sus propios
  // errores, ver lib/db/risk-alerts.ts), así que este await no puede hacer
  // fallar el guardado — solo le agrega la latencia real del envío del
  // correo, que es aceptable para una alerta que debe salir cuanto antes.
  await alertOnRiskyAssessment({
    clinicId,
    clinicName,
    patientId: input.patientId,
    assessmentId: assessment.id,
    type: input.type,
    answers: input.result.answers,
  });

  return assessment;
}
```

Añade el import al inicio del archivo: `import { alertOnRiskyAssessment } from "@/lib/db/risk-alerts";`

`clinicName` se agrega como parámetro explícito porque `createAssessmentViaLink` corre sin
sesión (cliente admin) y no hay forma de derivar el nombre de la clínica desde RLS/JWT aquí — el
caller (la futura Server Action de `app/enlace/[token]`) ya tiene que resolver `clinicId` a
partir del `patient_links` validado, y puede traer `clinicName` en la misma consulta.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: sin errores nuevos. (No hay callers existentes de `createAssessmentViaLink` en el
código hoy — la Server Action pública aún no se ha construido — así que el cambio de firma no
rompe nada.)

- [ ] **Step 3: Commit**

```bash
git add lib/db/assessments.ts
git commit -m "feat(assessments): invocar alertOnRiskyAssessment desde createAssessmentViaLink"
```

---

### Task 8: `selectPhq9RiskAlerts` (pura) + `listPhq9RiskAlerts` — lectura para el dashboard

**Files:**
- Modify: `lib/db/assessments.ts`
- Test: `tests/assessments.test.ts` (nuevo)

- [ ] **Step 1: Write the failing test**

Crea `tests/assessments.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { selectPhq9RiskAlerts, type Phq9RiskCandidate } from "@/lib/db/assessments";

function candidate(overrides: Partial<Phq9RiskCandidate> = {}): Phq9RiskCandidate {
  return {
    assessmentId: "a1",
    patientId: "p1",
    patientName: "Ana",
    date: "2026-07-01T10:00:00.000Z",
    type: "phq9",
    answers: [0, 0, 0, 0, 0, 0, 0, 0, 1],
    ...overrides,
  };
}

describe("selectPhq9RiskAlerts", () => {
  it("incluye un PHQ-9 con el ítem de autolesión > 0", () => {
    const result = selectPhq9RiskAlerts([candidate()]);
    expect(result).toEqual([
      { assessmentId: "a1", patientId: "p1", patientName: "Ana", date: "2026-07-01T10:00:00.000Z" },
    ]);
  });

  it("excluye un PHQ-9 con el ítem de autolesión en 0", () => {
    const result = selectPhq9RiskAlerts([
      candidate({ answers: [3, 3, 3, 3, 3, 3, 3, 3, 0] }),
    ]);
    expect(result).toEqual([]);
  });

  it("excluye GAD-7 aunque el índice 8 no exista", () => {
    const result = selectPhq9RiskAlerts([
      candidate({ type: "gad7", answers: [3, 3, 3, 3, 3, 3, 3] }),
    ]);
    expect(result).toEqual([]);
  });

  it("conserva el orden de entrada y filtra varias filas mixtas", () => {
    const risky = candidate({ assessmentId: "a1" });
    const safe = candidate({ assessmentId: "a2", answers: [0, 0, 0, 0, 0, 0, 0, 0, 0] });
    const alsoRisky = candidate({ assessmentId: "a3", answers: [0, 0, 0, 0, 0, 0, 0, 0, 2] });
    const result = selectPhq9RiskAlerts([risky, safe, alsoRisky]);
    expect(result.map((r) => r.assessmentId)).toEqual(["a1", "a3"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/assessments.test.ts`
Expected: FAIL — `selectPhq9RiskAlerts is not exported from "@/lib/db/assessments"`.

- [ ] **Step 3: Write minimal implementation**

En `lib/db/assessments.ts`, añade al final del archivo (después de
`listAssessmentsForPatient`). El archivo hoy importa tipos con
`import type { AssessmentType, AssessmentResult } from "@/lib/psychometrics";` — como
`isPhq9SelfHarmRisk` es una función (no un tipo), no puede agregarse a esa misma línea `import
type`. Reemplázala por:

```ts
import { isPhq9SelfHarmRisk, type AssessmentType, type AssessmentResult } from "@/lib/psychometrics";
```

Y añade el import nuevo `import { logger } from "@/lib/logger";` junto a los demás imports del
archivo.

```ts
export interface Phq9RiskCandidate {
  assessmentId: string;
  patientId: string;
  patientName: string;
  date: string;
  type: AssessmentType;
  answers: number[];
}

export interface Phq9RiskAlert {
  assessmentId: string;
  patientId: string;
  patientName: string;
  date: string;
}

/** Función pura: de un conjunto de escalas ya descifradas, cuáles son de riesgo. */
export function selectPhq9RiskAlerts(rows: Phq9RiskCandidate[]): Phq9RiskAlert[] {
  return rows
    .filter((r) => isPhq9SelfHarmRisk(r.type, r.answers))
    .map((r) => ({
      assessmentId: r.assessmentId,
      patientId: r.patientId,
      patientName: r.patientName,
      date: r.date,
    }));
}

interface RiskRow {
  id: string;
  patient_id: string;
  payload_enc: string;
  administered_at: string;
  patients: { full_name_enc: string } | null;
}

/**
 * Escalas PHQ-9 completadas vía link público cuya respuesta indica riesgo,
 * para la sección "Alertas de riesgo" del dashboard. Igual que
 * `listRiskAlerts` (lib/db/reports.ts): calcula el riesgo al leer, sin
 * columna de estado persistida.
 */
export async function listPhq9RiskAlerts(limit = 50): Promise<Phq9RiskAlert[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("psychometric_assessments")
    .select(
      "id, patient_id, payload_enc, administered_at, " +
        "patients!psychometric_assessments_patient_id_fkey(full_name_enc)",
    )
    .eq("type", "phq9")
    .not("link_id", "is", null)
    .order("administered_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  const candidates: Phq9RiskCandidate[] = [];
  for (const row of data as unknown as RiskRow[]) {
    try {
      const result = JSON.parse(decrypt(row.payload_enc)) as AssessmentResult;
      candidates.push({
        assessmentId: row.id,
        patientId: row.patient_id,
        patientName: row.patients ? decrypt(row.patients.full_name_enc) : "(nombre no disponible)",
        date: row.administered_at,
        type: "phq9",
        answers: result.answers,
      });
    } catch (error) {
      logger.warn("phq9_risk_alert.payload_decrypt_failed", { assessmentId: row.id, error });
    }
  }
  return selectPhq9RiskAlerts(candidates);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/assessments.test.ts`
Expected: PASS (los 4 tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: sin errores nuevos.

- [ ] **Step 6: Commit**

```bash
git add lib/db/assessments.ts tests/assessments.test.ts
git commit -m "feat(assessments): agregar selectPhq9RiskAlerts y listPhq9RiskAlerts"
```

---

### Task 9: fusionar en la sección "Alertas de riesgo" del dashboard

**Files:**
- Modify: `app/(app)/dashboard/page.tsx`

- [ ] **Step 1: Write the implementation**

En `app/(app)/dashboard/page.tsx`:

1. Añade el import junto a los de `lib/db/reports`:

```ts
import { listPhq9RiskAlerts, type Phq9RiskAlert } from "@/lib/db/assessments";
```

2. En el `Promise.all` que trae `riskAlerts`, añade `phq9RiskAlerts` en paralelo, mismo guard de
   `isClinician`:

```ts
const [patients, todayAppts, pendingReports, patientsNoConsent, riskAlerts, phq9RiskAlerts] =
  await Promise.all([
    patientCount(),
    listTodayAppointments(),
    isClinician ? countPendingReports() : Promise.resolve(0),
    countPatientsWithoutConsent(),
    isClinician ? listRiskAlerts() : Promise.resolve<RiskAlert[]>([]),
    isClinician ? listPhq9RiskAlerts() : Promise.resolve<Phq9RiskAlert[]>([]),
  ]);
```

3. Cambia la condición y el conteo de la sección de:

```tsx
{isClinician && riskAlerts.length > 0 && (
  <section className="rounded-2xl border border-coral/40 bg-coral/5 p-5">
    <div className="mb-3 flex items-center gap-2">
      <ShieldAlert className="size-5 text-destructive" />
      <h2 className="font-heading font-semibold text-navy">
        Alertas de riesgo ({riskAlerts.length})
      </h2>
    </div>
    <ul className="space-y-2">
      {riskAlerts.slice(0, 5).map((a) => (
```

a:

```tsx
{isClinician && (riskAlerts.length > 0 || phq9RiskAlerts.length > 0) && (
  <section className="rounded-2xl border border-coral/40 bg-coral/5 p-5">
    <div className="mb-3 flex items-center gap-2">
      <ShieldAlert className="size-5 text-destructive" />
      <h2 className="font-heading font-semibold text-navy">
        Alertas de riesgo ({riskAlerts.length + phq9RiskAlerts.length})
      </h2>
    </div>
    <ul className="space-y-2">
      {riskAlerts.slice(0, 5).map((a) => (
```

4. Justo después del `</ul>` que cierra la lista de `riskAlerts` (antes del `<p className="mt-3
   text-xs text-muted-foreground">Detección temprana por IA...`), añade una segunda lista:

```tsx
      <ul className="space-y-2">
        {phq9RiskAlerts.slice(0, 5).map((a) => (
          <li key={a.assessmentId}>
            <Link
              href={`/patients/${a.patientId}`}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-line bg-card p-3 transition-shadow hover:shadow-sm"
            >
              <span className="font-medium text-navy">{a.patientName}</span>
              <span className="flex flex-wrap gap-1.5">
                <Badge variant="secondary" className="text-[11px] bg-coral/15 text-destructive">
                  Autolesión · PHQ-9
                </Badge>
              </span>
            </Link>
          </li>
        ))}
      </ul>
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: sin errores nuevos.

- [ ] **Step 3: Manual check (no hay servidor Supabase en este entorno de plan)**

Run: `npm run build`
Expected: build exitoso, sin errores de tipos ni de imports.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/dashboard/page.tsx"
git commit -m "feat(dashboard): mostrar alertas de riesgo PHQ-9 de link público"
```

---

## Verificación final

- [ ] **Run full test suite**

Run: `npm run test`
Expected: PASS (incluye los tests nuevos de Tasks 1, 2 y 8, y todos los preexistentes).

- [ ] **Run typecheck**

Run: `npm run typecheck`
Expected: sin errores.

- [ ] **Run build**

Run: `npm run build`
Expected: build exitoso.

## Seguimiento pendiente (fuera de este plan)

- Construir `app/enlace/[token]/page.tsx` y su Server Action (spec
  `2026-07-10-portal-paciente-y-ajustes-design.md`) — al llamar `createAssessmentViaLink`, la
  alerta ya sale automáticamente (Task 7), no requiere wiring adicional.
- Redactar y validar el texto del bloque de recursos de crisis para la pantalla de confirmación
  del link público, y mostrarlo cuando `isPhq9SelfHarmRisk` sea `true` (usa la función de Task 1).

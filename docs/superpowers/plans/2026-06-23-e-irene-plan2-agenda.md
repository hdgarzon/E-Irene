# E-Irene Plan 2 — Agenda / Citas

> **For agentic workers:** Sigue el patrón del Plan 1 (Server Actions + Zod + RLS + audit + tests).
> Steps con checkbox `- [ ]`.

**Goal:** Módulo de agenda: agendar, ver, editar y cambiar el estado de las citas, vinculadas a
pacientes y profesionales de la clínica. Vista de agenda agrupada por día. Sin APIs externas.

**Architecture:** Igual que Plan 1. Tabla `appointments` ya existe (Plan 1) con RLS multi-tenant.
Capa de datos con join a `patients` (nombre descifrado) y `users` (doctor), Server Actions con
validación Zod y audit logging, UI con shadcn/ui.

**Tech Stack:** Next.js 16, supabase-js, Zod, Vitest, Playwright.

---

## File Structure

```
lib/db/appointments.ts          Capa de datos (CRUD + join paciente/doctor)
lib/db/clinic.ts                listDoctors() para selector
lib/dates.ts                    Helpers de fecha/agrupación (es-CO)
app/(app)/appointments/
  page.tsx                      Vista de agenda (agrupada por día)
  new/page.tsx                  Crear cita
  [id]/edit/page.tsx            Editar cita
  actions.ts                    Server Actions (crear/editar/estado)
components/appointment-form.tsx Formulario (cliente)
components/appointment-status.tsx  Badge + acciones de estado
tests/dates.test.ts             Unit de helpers
tests/e2e/appointments.spec.ts  E2E
```

---

## Task 1: Helpers de fecha (TDD)

**Files:** Create `lib/dates.ts`, `tests/dates.test.ts`

- [ ] Test: `groupByDay` agrupa citas por fecha local; `formatDayLabel` devuelve etiqueta es-CO
  ("Hoy", "Mañana", o "lunes 23 jun"); `formatTime` → "14:30".
- [ ] Implementar y pasar.

## Task 2: Capa de datos de citas

**Files:** Create `lib/db/appointments.ts`, `lib/db/clinic.ts`

- [ ] `lib/db/clinic.ts`: `listDoctors()` → usuarios con rol admin/doctor `{id, fullName}`.
- [ ] `lib/db/appointments.ts`:
  - tipos `AppointmentInput`, `Appointment` (incluye `patientName`, `doctorName`).
  - `listAppointments()`: select con `patients!appointments_patient_id_fkey(full_name_enc)` y
    `users!appointments_doctor_id_fkey(full_name)`, ordenado por `scheduled_at`; descifra nombre.
  - `getAppointment(id)`, `createAppointment(clinicId, input)`, `updateAppointment(id, input)`,
    `setAppointmentStatus(id, status)`.

## Task 3: Server Actions

**Files:** Create `app/(app)/appointments/actions.ts`

- [ ] Zod schema: `patientId` (uuid), `doctorId` (uuid), `scheduledAt` (datetime-local string),
  `durationMin` (coerce int, default 50), `notes` opcional.
- [ ] `createAppointmentAction`, `updateAppointmentAction(id, …)`, `setStatusAction(id, status)`
  con audit logging (`appointment.created/updated/status_changed`) y `revalidatePath`.

## Task 4: UI — formulario y agenda

**Files:** Create `components/appointment-form.tsx`, `components/appointment-status.tsx`,
`app/(app)/appointments/{page,new/page,[id]/edit/page}.tsx`

- [ ] `appointment-form.tsx`: selects de paciente y doctor (props desde server), input
  `datetime-local`, duración, notas. `useActionState`.
- [ ] `appointment-status.tsx`: badge con color por estado + menú para cambiar estado.
- [ ] `page.tsx`: agenda agrupada por día con paciente, hora, duración, doctor, estado.
  Empty state. Botón "Nueva cita".
- [ ] `new/page.tsx` y `[id]/edit/page.tsx`: cargan pacientes + doctores y renderizan el form.
- [ ] Habilitar el item "Agenda" en el sidebar (`enabled: true`).

## Task 5: Verificación

- [ ] `npm run typecheck`, `npm test`, `npm run build` en verde.
- [ ] E2E `tests/e2e/appointments.spec.ts`: login → crear paciente → crear cita → aparece en
  agenda → cambiar estado a "confirmada".
- [ ] Commit.

## Definition of Done
- Crear/editar citas vinculadas a paciente + doctor; vista de agenda por día; cambio de estado;
  audit logging; RLS scoped; tests verdes.

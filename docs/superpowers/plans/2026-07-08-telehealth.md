# Telehealth (videollamada integrada al pipeline de IA) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que una consulta se haga por videollamada (Daily.co) en vez de presencial, transcribiendo ambos lados en vivo (mic local del doctor + pista remota del paciente, sin diarización) y produciendo el mismo reporte de IA que hoy. El paciente entra sin cuenta, por un link de un solo uso.

**Architecture:** `lib/video/` añade un `VideoProvider` (mock + Daily.co) siguiendo el mismo patrón que `lib/providers/` (transcripción/análisis). Las citas ganan `modality` (`in_person`/`video`) + un token de acceso propio, separado del id de la fila. El doctor inicia la videollamada desde la agenda; el paciente entra por `/join/[token]`, ruta pública nueva. `live-consultation.tsx` gana un modo "video" que reemplaza la heurística de diarización por dos streams con speaker ya conocido.

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres + RLS), `@daily-co/daily-js` (cliente), REST API de Daily.co (servidor), Deepgram (ya existente), Vitest, Playwright.

---

## Referencia: spec aprobado

Este plan implementa `docs/superpowers/specs/2026-07-08-telehealth-design.md`. Ante cualquier duda de alcance, ese documento es la fuente de verdad.

## Convenciones ya usadas en el repo (seguir, no reinventar)

- Proveedores externos: interfaz + `Mock*Provider` (activo sin API key o con `*_PROVIDER=mock`) + provider real. Ver `lib/providers/index.ts`.
- Migraciones: `supabase/migrations/NNNN_descripcion.sql`, seguido de `npx supabase migration up --local` y `npx supabase gen types typescript --local > types/database.ts` (con stderr a `/dev/null`, nunca mezclado con stdout — ver nota en Task 1).
- Server Actions: `"use server"`, empiezan con `requireUser()`/`requireRole()`, terminan con `logAudit(...)` para mutaciones relevantes, catches usan `logger.error(...)` (ver `lib/logger.ts`).
- Tests: Vitest para lógica pura (`tests/*.test.ts`), Playwright para flujos completos (`tests/e2e/*.spec.ts`), mocks forzados vía env en `playwright.config.ts`.

---

### Task 1: Migración — `modality`, `video_room_name`, `video_join_token` en `appointments`

**Files:**
- Create: `supabase/migrations/0019_appointment_telehealth.sql`
- Modify: `types/database.ts` (regenerado, no a mano)

- [ ] **Step 1: Escribir la migración**

```sql
-- supabase/migrations/0019_appointment_telehealth.sql
-- ============================================================================
-- Telehealth: modalidad de la cita + acceso del paciente a la videollamada.
--
-- video_join_token es un token de acceso propio, DISTINTO del id de la fila
-- (práctica estándar: no mezclar identificador de recurso con capacidad de
-- acceso). Se genera de forma perezosa la primera vez que hace falta (enviar
-- recordatorio o iniciar la videollamada) — ver lib/db/appointments.ts.
-- ============================================================================

alter table appointments add column modality text not null default 'in_person'
  check (modality in ('in_person', 'video'));
alter table appointments add column video_room_name text;
-- URL real de la sala devuelta por el proveedor (Daily.co: `room.url`; mock:
-- una URL simulada) — se guarda para no tener que reconstruirla a mano en
-- cada request (ver ensureVideoRoom en Task 6).
alter table appointments add column video_room_url text;
alter table appointments add column video_join_token text unique;

create index appointments_video_join_token_idx on appointments(video_join_token)
  where video_join_token is not null;
```

- [ ] **Step 2: Aplicar la migración contra Supabase local**

Run: `npx supabase migration up --local`
Expected: `Applying migration 0019_appointment_telehealth.sql...` sin errores.

- [ ] **Step 3: Regenerar tipos (stdout y stderr por separado — mezclarlos corrompe el archivo)**

Run: `npx supabase gen types typescript --local > types/database.ts 2>/dev/null`
Verify: `grep -c "video_join_token" types/database.ts` → al menos `1`.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: sin errores (este cambio aún no lo usa código TS).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0019_appointment_telehealth.sql types/database.ts
git commit -m "feat(telehealth): migración modality/video_room_name/video_join_token en appointments"
```

---

### Task 2: `lib/video/join-token.ts` — validez del token (TDD)

Lógica pura (sin red ni BD): dado el estado de una cita, decide si un token de join es válido en este momento. Se testea aislado antes de conectarlo a nada.

**Files:**
- Create: `lib/video/join-token.ts`
- Test: `tests/video-join-token.test.ts`

- [ ] **Step 1: Escribir el test (falla: el módulo no existe)**

```ts
// tests/video-join-token.test.ts
import { describe, it, expect } from "vitest";
import { isJoinWindowOpen } from "@/lib/video/join-token";

const MIN = 60_000;

describe("isJoinWindowOpen", () => {
  const scheduledAt = "2026-07-08T15:00:00.000Z"; // 3:00pm UTC, duración 50min

  it("false más de 15 minutos antes de la hora agendada", () => {
    const now = new Date("2026-07-08T14:44:00.000Z"); // 16 min antes
    expect(isJoinWindowOpen({ scheduledAt, durationMin: 50, now })).toBe(false);
  });

  it("true exactamente 15 minutos antes", () => {
    const now = new Date("2026-07-08T14:45:00.000Z"); // 15 min antes
    expect(isJoinWindowOpen({ scheduledAt, durationMin: 50, now })).toBe(true);
  });

  it("true durante la duración de la cita", () => {
    const now = new Date("2026-07-08T15:20:00.000Z"); // 20 min dentro de 50
    expect(isJoinWindowOpen({ scheduledAt, durationMin: 50, now })).toBe(true);
  });

  it("true hasta 15 minutos después de terminada (margen de cierre)", () => {
    const now = new Date("2026-07-08T16:00:00.000Z"); // 10 min después de terminar (15:50)
    expect(isJoinWindowOpen({ scheduledAt, durationMin: 50, now })).toBe(true);
  });

  it("false más de 15 minutos después de terminada", () => {
    const now = new Date("2026-07-08T16:06:00.000Z"); // 16 min después de terminar
    expect(isJoinWindowOpen({ scheduledAt, durationMin: 50, now })).toBe(false);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/video-join-token.test.ts`
Expected: FAIL — `Cannot find module '@/lib/video/join-token'`.

- [ ] **Step 3: Implementar `isJoinWindowOpen`**

```ts
// lib/video/join-token.ts

/** Minutos de margen antes/después de la ventana agendada en los que el link
 *  de video sigue siendo válido (permite llegar temprano o cerrar tarde). */
const JOIN_MARGIN_MIN = 15;

/**
 * true si `now` cae dentro de la ventana [scheduledAt - margen, scheduledAt +
 * duración + margen]. Se usa tanto para decidir si /join/[token] deja pasar
 * al paciente como para invalidar el token una vez pasó la ventana.
 */
export function isJoinWindowOpen(params: {
  scheduledAt: string; // ISO
  durationMin: number;
  now?: Date;
}): boolean {
  const now = (params.now ?? new Date()).getTime();
  const scheduled = new Date(params.scheduledAt).getTime();
  const marginMs = JOIN_MARGIN_MIN * 60_000;
  const start = scheduled - marginMs;
  const end = scheduled + params.durationMin * 60_000 + marginMs;
  return now >= start && now <= end;
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run tests/video-join-token.test.ts`
Expected: 5 tests PASS.

- [ ] **Step 5: Lint + commit**

Run: `npx eslint lib/video/join-token.ts tests/video-join-token.test.ts`
Expected: sin salida (limpio).

```bash
git add lib/video/join-token.ts tests/video-join-token.test.ts
git commit -m "feat(telehealth): ventana de validez del token de videollamada"
```

---

### Task 3: `lib/video/types.ts` + `lib/video/mock.ts` (TDD)

**Files:**
- Create: `lib/video/types.ts`
- Create: `lib/video/mock.ts`
- Test: `tests/video-mock.test.ts`

- [ ] **Step 1: Escribir el test (falla: los módulos no existen)**

```ts
// tests/video-mock.test.ts
import { describe, it, expect } from "vitest";
import { MockVideoProvider } from "@/lib/video/mock";

describe("MockVideoProvider", () => {
  it("mode es 'mock'", () => {
    expect(new MockVideoProvider().mode).toBe("mock");
  });

  it("createRoom devuelve un roomName único y una roomUrl con ese nombre, sin red", async () => {
    const provider = new MockVideoProvider();
    const a = await provider.createRoom("consultation-1");
    const b = await provider.createRoom("consultation-2");
    expect(a.roomName).not.toBe(b.roomName);
    expect(a.roomUrl).toContain(a.roomName);
  });

  it("deleteRoom no lanza (no-op)", async () => {
    const provider = new MockVideoProvider();
    await expect(provider.deleteRoom("cualquier-sala")).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/video-mock.test.ts`
Expected: FAIL — `Cannot find module '@/lib/video/mock'`.

- [ ] **Step 3: Implementar `lib/video/types.ts`**

```ts
// lib/video/types.ts

export interface VideoRoom {
  roomName: string;
  /** URL de la sala en el proveedor — la usan doctor y paciente por igual
   *  para unirse vía el SDK. NO es el link que recibe el paciente por email/
   *  WhatsApp (ese es siempre /join/[token], propio de la app). */
  roomUrl: string;
}

export type VideoMode = "mock" | "daily";

export interface VideoProvider {
  readonly mode: VideoMode;
  /** `contextId` es un identificador único para nombrar la sala (en la
   *  práctica, el id de la cita — ver ensureVideoRoom en Task 6 — nunca el
   *  id de una consulta, que puede no existir todavía en este punto). No se
   *  persiste ni se interpreta, solo entra en el nombre de la sala. */
  createRoom(contextId: string): Promise<VideoRoom>;
  deleteRoom(roomName: string): Promise<void>;
}
```

- [ ] **Step 4: Implementar `lib/video/mock.ts`**

```ts
// lib/video/mock.ts
import { randomUUID } from "node:crypto";
import type { VideoProvider, VideoRoom } from "./types";

/** Sin DAILY_API_KEY (o con VIDEO_PROVIDER=mock): sala simulada, sin red. */
export class MockVideoProvider implements VideoProvider {
  readonly mode = "mock" as const;

  async createRoom(contextId: string): Promise<VideoRoom> {
    const roomName = `mock-${contextId}-${randomUUID().slice(0, 8)}`;
    return { roomName, roomUrl: `https://mock.video/${roomName}` };
  }

  async deleteRoom(): Promise<void> {
    // no-op: no hay red que limpiar en modo mock.
  }
}
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npx vitest run tests/video-mock.test.ts`
Expected: 3 tests PASS.

- [ ] **Step 6: Typecheck + lint + commit**

Run: `npm run typecheck && npx eslint lib/video/types.ts lib/video/mock.ts tests/video-mock.test.ts`
Expected: ambos limpios.

```bash
git add lib/video/types.ts lib/video/mock.ts tests/video-mock.test.ts
git commit -m "feat(telehealth): VideoProvider interface + MockVideoProvider"
```

---

### Task 4: `lib/video/daily.ts` — proveedor real (Daily.co REST API)

API verificada contra la documentación oficial de Daily.co (no asumida):
`POST https://api.daily.co/v1/rooms` (crear sala), `POST https://api.daily.co/v1/meeting-tokens`
(token de acceso por participante), auth `Authorization: Bearer <DAILY_API_KEY>`.

**Files:**
- Create: `lib/video/daily.ts`

- [ ] **Step 1: Implementar `DailyVideoProvider`**

```ts
// lib/video/daily.ts
import { randomUUID } from "node:crypto";
import type { VideoProvider, VideoRoom } from "./types";

const DAILY_API_BASE = "https://api.daily.co/v1";

/**
 * Videollamada real vía Daily.co. Resuelve TURN/NAT traversal por nosotros
 * (crítico para que pacientes en redes restrictivas puedan conectar). Salas
 * privadas: solo se puede entrar con un meeting token (ver createMeetingToken),
 * nunca por la URL sola — la URL además NUNCA se expone directo al paciente,
 * solo vía /join/[token] (ver lib/video/join-token.ts y el spec, sección 7).
 */
export class DailyVideoProvider implements VideoProvider {
  readonly mode = "daily" as const;

  private apiKey(): string {
    const key = process.env.DAILY_API_KEY;
    if (!key) throw new Error("DAILY_API_KEY no está configurada");
    return key;
  }

  async createRoom(contextId: string): Promise<VideoRoom> {
    const res = await fetch(`${DAILY_API_BASE}/rooms`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // Sufijo aleatorio: si una llamada anterior creó la sala pero la
        // escritura en BD falló antes de guardar el nombre (ensureVideoRoom,
        // Task 6), un reintento no debe colisionar con la sala huérfana.
        name: `apt-${contextId}-${randomUUID().slice(0, 8)}`,
        privacy: "private",
        properties: {
          // Vencimiento amplio (24h): la ventana real de acceso la controla
          // isJoinWindowOpen()/video_join_token, no esto — es solo un tope
          // de limpieza para no acumular salas huérfanas en Daily.
          exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
          max_participants: 2,
          enable_recording: undefined, // nunca se graba (ver spec §8)
        },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Daily.co (rooms) respondió ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as { name: string; url: string };
    return { roomName: data.name, roomUrl: data.url };
  }

  async deleteRoom(roomName: string): Promise<void> {
    const res = await fetch(`${DAILY_API_BASE}/rooms/${roomName}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${this.apiKey()}` },
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`Daily.co (delete room) respondió ${res.status}`);
    }
  }

  /**
   * Token de acceso a una sala privada, propio de esta implementación (no
   * forma parte de la interfaz VideoProvider — solo DailyVideoProvider lo
   * necesita; MockVideoProvider no valida nada). `isOwner` da controles de
   * host (usado por el doctor); el paciente entra con isOwner=false.
   */
  async createMeetingToken(params: {
    roomName: string;
    userName: string;
    isOwner: boolean;
    expiresInSeconds: number;
  }): Promise<string> {
    const res = await fetch(`${DAILY_API_BASE}/meeting-tokens`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        properties: {
          room_name: params.roomName,
          user_name: params.userName,
          is_owner: params.isOwner,
          exp: Math.floor(Date.now() / 1000) + params.expiresInSeconds,
        },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Daily.co (meeting-tokens) respondió ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as { token: string };
    return data.token;
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: sin errores.

- [ ] **Step 3: Lint + commit**

Run: `npx eslint lib/video/daily.ts`
Expected: limpio.

```bash
git add lib/video/daily.ts
git commit -m "feat(telehealth): DailyVideoProvider (API REST real)"
```

---

### Task 5: `lib/video/index.ts` — factory env-driven

**Files:**
- Create: `lib/video/index.ts`

- [ ] **Step 1: Implementar el factory (mismo patrón que `lib/providers/index.ts`)**

```ts
// lib/video/index.ts
import type { VideoProvider } from "./types";
import { MockVideoProvider } from "./mock";
import { DailyVideoProvider } from "./daily";

export * from "./types";

/**
 * Sin DAILY_API_KEY: MockVideoProvider (la app corre sin keys). Con la key,
 * se activa Daily.co automáticamente; VIDEO_PROVIDER=mock lo fuerza (usado
 * por la suite E2E, igual que TRANSCRIPTION_PROVIDER/ANALYSIS_PROVIDER).
 */
export function getVideoProvider(): VideoProvider {
  const forced = process.env.VIDEO_PROVIDER;
  const hasKey = Boolean(process.env.DAILY_API_KEY);
  if (forced === "mock" || (!hasKey && forced !== "daily")) {
    return new MockVideoProvider();
  }
  return new DailyVideoProvider();
}
```

- [ ] **Step 2: Typecheck + lint + commit**

Run: `npm run typecheck && npx eslint lib/video/index.ts`
Expected: ambos limpios.

```bash
git add lib/video/index.ts
git commit -m "feat(telehealth): factory getVideoProvider() env-driven"
```

---

### Task 6: `lib/db/appointments.ts` — modalidad, sala y token perezosos

**Files:**
- Modify: `lib/db/appointments.ts`

- [ ] **Step 1: Extender tipos, `SELECT`, `mapRow` y `createAppointment`/`updateAppointment`**

Reemplazar el contenido completo de `lib/db/appointments.ts` por:

```ts
// lib/db/appointments.ts
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/crypto";
import { dayKey } from "@/lib/dates";
import { getVideoProvider } from "@/lib/video";
import type { Database } from "@/types/database";

export type AppointmentStatus = Database["public"]["Enums"]["appointment_status"];
export type AppointmentModality = "in_person" | "video";

export interface AppointmentInput {
  patientId: string;
  doctorId: string;
  scheduledAt: string; // ISO
  durationMin: number;
  notes?: string | null;
  status?: AppointmentStatus;
  modality?: AppointmentModality;
}

export interface Appointment {
  id: string;
  patientId: string;
  patientName: string;
  doctorId: string;
  doctorName: string;
  scheduledAt: string;
  durationMin: number;
  status: AppointmentStatus;
  notes: string | null;
  modality: AppointmentModality;
  videoRoomName: string | null;
  videoRoomUrl: string | null;
  videoJoinToken: string | null;
}

const SELECT =
  "id, patient_id, doctor_id, scheduled_at, duration_min, status, notes, " +
  "modality, video_room_name, video_room_url, video_join_token, " +
  "patients!appointments_patient_id_fkey(full_name_enc), " +
  "doctor:users!appointments_doctor_id_fkey(full_name)";

interface RawRow {
  id: string;
  patient_id: string;
  doctor_id: string;
  scheduled_at: string;
  duration_min: number;
  status: AppointmentStatus;
  notes: string | null;
  modality: AppointmentModality;
  video_room_name: string | null;
  video_room_url: string | null;
  video_join_token: string | null;
  patients: { full_name_enc: string } | null;
  doctor: { full_name: string } | null;
}

function mapRow(row: RawRow): Appointment {
  return {
    id: row.id,
    patientId: row.patient_id,
    patientName: row.patients ? decrypt(row.patients.full_name_enc) : "—",
    doctorId: row.doctor_id,
    doctorName: row.doctor?.full_name ?? "—",
    scheduledAt: row.scheduled_at,
    durationMin: row.duration_min,
    status: row.status,
    notes: row.notes,
    modality: row.modality,
    videoRoomName: row.video_room_name,
    videoRoomUrl: row.video_room_url,
    videoJoinToken: row.video_join_token,
  };
}

export async function listAppointments(): Promise<Appointment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("appointments")
    .select(SELECT)
    .order("scheduled_at", { ascending: true });
  if (error) throw error;
  return (data as unknown as RawRow[]).map(mapRow);
}

/**
 * Citas de HOY (zona Bogotá, UTC-5 sin DST) que no estén canceladas, para la
 * agenda del día en el dashboard. Consulta acotada por rango de fecha (no trae
 * toda la agenda).
 */
export async function listTodayAppointments(): Promise<Appointment[]> {
  const supabase = await createClient();
  const key = dayKey(new Date());
  const from = new Date(`${key}T00:00:00-05:00`).toISOString();
  const to = new Date(`${key}T23:59:59-05:00`).toISOString();
  const { data, error } = await supabase
    .from("appointments")
    .select(SELECT)
    .gte("scheduled_at", from)
    .lte("scheduled_at", to)
    .neq("status", "cancelled")
    .order("scheduled_at", { ascending: true });
  if (error) throw error;
  return (data as unknown as RawRow[]).map(mapRow);
}

export async function getAppointment(id: string): Promise<Appointment | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("appointments")
    .select(SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRow(data as unknown as RawRow) : null;
}

/**
 * Busca una cita por su token de acceso a videollamada (para /join/[token]).
 * No requiere sesión — el token ES la autorización (ver spec §5/§8).
 */
export async function getAppointmentByJoinToken(token: string): Promise<Appointment | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("appointments")
    .select(SELECT)
    .eq("video_join_token", token)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRow(data as unknown as RawRow) : null;
}

export async function createAppointment(
  clinicId: string,
  input: AppointmentInput,
): Promise<Appointment> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("appointments")
    .insert({
      clinic_id: clinicId,
      patient_id: input.patientId,
      doctor_id: input.doctorId,
      scheduled_at: input.scheduledAt,
      duration_min: input.durationMin,
      notes: input.notes ?? null,
      status: input.status ?? "scheduled",
      modality: input.modality ?? "in_person",
    })
    .select(SELECT)
    .single();
  if (error) throw error;
  return mapRow(data as unknown as RawRow);
}

export async function updateAppointment(
  id: string,
  input: AppointmentInput,
): Promise<Appointment> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("appointments")
    .update({
      patient_id: input.patientId,
      doctor_id: input.doctorId,
      scheduled_at: input.scheduledAt,
      duration_min: input.durationMin,
      notes: input.notes ?? null,
      modality: input.modality ?? "in_person",
    })
    .eq("id", id)
    .select(SELECT)
    .single();
  if (error) throw error;
  return mapRow(data as unknown as RawRow);
}

export async function setAppointmentStatus(
  id: string,
  status: AppointmentStatus,
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("appointments").update({ status }).eq("id", id);
  if (error) throw error;
}

/**
 * Garantiza que la cita tenga sala de video + token de acceso, creándolos la
 * primera vez que hacen falta (al enviar el recordatorio o al iniciar la
 * videollamada — ver spec §3). Idempotente: si ya existen, los devuelve tal
 * cual sin llamar al proveedor de nuevo.
 */
export async function ensureVideoRoom(
  appointmentId: string,
): Promise<{ roomName: string; roomUrl: string; joinToken: string }> {
  const supabase = await createClient();
  const existing = await getAppointment(appointmentId);
  if (!existing) throw new Error(`Cita ${appointmentId} no encontrada`);
  if (existing.videoRoomName && existing.videoRoomUrl && existing.videoJoinToken) {
    return {
      roomName: existing.videoRoomName,
      roomUrl: existing.videoRoomUrl,
      joinToken: existing.videoJoinToken,
    };
  }

  const room = await getVideoProvider().createRoom(appointmentId);
  const joinToken = randomUUID();
  const { error } = await supabase
    .from("appointments")
    .update({
      video_room_name: room.roomName,
      video_room_url: room.roomUrl,
      video_join_token: joinToken,
    })
    .eq("id", appointmentId);
  if (error) throw error;
  return { roomName: room.roomName, roomUrl: room.roomUrl, joinToken };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: errores esperados en `components/appointment-form.tsx` y
`app/(app)/appointments/actions.ts` (aún no pasan `modality`) — se resuelven en
las próximas tareas. Confirmar que **no** hay errores dentro de
`lib/db/appointments.ts` mismo.

- [ ] **Step 3: Commit**

```bash
git add lib/db/appointments.ts
git commit -m "feat(telehealth): modalidad + sala/token perezosos en appointments"
```

---

### Task 7: Formulario de cita — selector de modalidad

**Files:**
- Modify: `components/appointment-form.tsx`

- [ ] **Step 1: Añadir el campo `modality` al formulario**

En `components/appointment-form.tsx`, extender `Defaults` y agregar el select
entre "Profesional" y "Fecha y hora":

```diff
 interface Defaults {
   patientId?: string;
   doctorId?: string;
   scheduledAt?: string; // "YYYY-MM-DDTHH:mm"
   durationMin?: number;
   notes?: string | null;
+  modality?: "in_person" | "video";
 }
```

```diff
+      <div className="space-y-1.5">
+        <Label htmlFor="modality">Modalidad</Label>
+        <select
+          id="modality"
+          name="modality"
+          defaultValue={d.modality ?? "in_person"}
+          className={selectClass}
+        >
+          <option value="in_person">Presencial</option>
+          <option value="video">Video</option>
+        </select>
+      </div>
+
       <div className="grid gap-5 sm:grid-cols-2">
         <div className="space-y-1.5">
           <Label htmlFor="scheduledAt">Fecha y hora *</Label>
```

(Insertar justo antes del `<div className="grid gap-5 sm:grid-cols-2">` que
contiene fecha/duración.)

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npx eslint components/appointment-form.tsx`
Expected: ambos limpios.

- [ ] **Step 3: Commit**

```bash
git add components/appointment-form.tsx
git commit -m "feat(telehealth): selector de modalidad en el formulario de citas"
```

---

### Task 8: Server Actions de citas — validar y guardar `modality`

**Files:**
- Modify: `app/(app)/appointments/actions.ts`

- [ ] **Step 1: Extender el schema y `toInput`**

```diff
 const schema = z.object({
   patientId: z.uuid("Selecciona un paciente"),
   doctorId: z.uuid("Selecciona un profesional"),
   scheduledAt: z.string().min(1, "Selecciona fecha y hora"),
   durationMin: z.coerce.number().int().min(10).max(240),
   notes: z.string().optional(),
+  modality: z.enum(["in_person", "video"]).default("in_person"),
 });
```

```diff
 function toInput(data: z.infer<typeof schema>): AppointmentInput {
   return {
     patientId: data.patientId,
     doctorId: data.doctorId,
     scheduledAt: fromInputDateTime(data.scheduledAt),
     durationMin: data.durationMin,
     notes: data.notes && data.notes.trim() !== "" ? data.notes.trim() : null,
+    modality: data.modality,
   };
 }
```

```diff
 function parse(formData: FormData) {
   return schema.safeParse({
     patientId: formData.get("patientId"),
     doctorId: formData.get("doctorId"),
     scheduledAt: formData.get("scheduledAt"),
     durationMin: formData.get("durationMin"),
     notes: formData.get("notes"),
+    modality: formData.get("modality"),
   });
 }
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: sin errores.

- [ ] **Step 3: Lint + commit**

Run: `npx eslint "app/(app)/appointments/actions.ts"`
Expected: limpio.

```bash
git add "app/(app)/appointments/actions.ts"
git commit -m "feat(telehealth): guarda modality al crear/editar cita"
```

---

### Task 9: Link de video en el recordatorio (email + WhatsApp)

**Files:**
- Modify: `lib/email/templates.ts`
- Modify: `lib/whatsapp/providers.ts`

- [ ] **Step 1: `buildReminderEmail` acepta `videoJoinUrl` opcional**

```diff
 export function buildReminderEmail(input: {
   to: string;
   patientName: string;
   clinicName: string;
   dateLabel: string;
   timeLabel: string;
+  videoJoinUrl?: string;
 }): EmailMessage {
-  const text = `Hola ${input.patientName}, te recordamos tu cita en ${input.clinicName} el ${input.dateLabel} a las ${input.timeLabel}.`;
+  const videoLine = input.videoJoinUrl
+    ? ` Es una consulta por video — entra desde este enlace a la hora de tu cita: ${input.videoJoinUrl}`
+    : "";
+  const text = `Hola ${input.patientName}, te recordamos tu cita en ${input.clinicName} el ${input.dateLabel} a las ${input.timeLabel}.${videoLine}`;
   return {
     to: input.to,
     subject: `Recordatorio de tu cita · ${input.dateLabel}`,
     text,
     html: wrap(
       "Recordatorio de cita",
       `<p>Hola <strong>${input.patientName}</strong>,</p>
        <p>Te recordamos tu próxima cita en <strong>${input.clinicName}</strong>:</p>
        <p style="background:#f6f9fc;border-radius:8px;padding:12px;font-size:16px">
          📅 ${input.dateLabel} · 🕐 ${input.timeLabel}
        </p>
+       ${
+         input.videoJoinUrl
+           ? `<p>Esta es una consulta por <strong>video</strong>. Entra desde este enlace a la hora de tu cita (no necesitas cuenta ni contraseña):</p>
+       <p><a href="${input.videoJoinUrl}" style="display:inline-block;background:#635bff;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Entrar a la videollamada</a></p>`
+           : ""
+       }
        <p>Si necesitas reprogramar, por favor contáctanos.</p>`,
     ),
   };
 }
```

- [ ] **Step 2: `buildReminderWhatsApp` acepta `videoJoinUrl` opcional**

```diff
 export function buildReminderWhatsApp(input: {
   patientName: string;
   clinicName: string;
   dateLabel: string;
   timeLabel: string;
+  videoJoinUrl?: string;
 }): string {
-  return `Hola ${input.patientName} 👋 Te recordamos tu cita en ${input.clinicName} el ${input.dateLabel} a las ${input.timeLabel}. — E-Irene`;
+  const videoLine = input.videoJoinUrl
+    ? ` Es por video, entra aquí a la hora de tu cita: ${input.videoJoinUrl}`
+    : "";
+  return `Hola ${input.patientName} 👋 Te recordamos tu cita en ${input.clinicName} el ${input.dateLabel} a las ${input.timeLabel}.${videoLine} — E-Irene`;
 }
```

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck && npx eslint lib/email/templates.ts lib/whatsapp/providers.ts`
Expected: ambos limpios (los parámetros nuevos son opcionales, no rompen los
call sites existentes).

- [ ] **Step 4: Commit**

```bash
git add lib/email/templates.ts lib/whatsapp/providers.ts
git commit -m "feat(telehealth): link de videollamada en el recordatorio"
```

---

### Task 10: `sendReminderAction` incluye el link cuando la cita es de video

**Files:**
- Modify: `app/(app)/appointments/actions.ts`

- [ ] **Step 1: Traer `getAppointmentByJoinToken`... no — traer `ensureVideoRoom` y construir la URL pública**

Añadir el import:

```diff
 import {
   createAppointment,
   updateAppointment,
   setAppointmentStatus,
   getAppointment,
+  ensureVideoRoom,
   type AppointmentInput,
 } from "@/lib/db/appointments";
```

En `sendReminderAction`, justo después de obtener `appt` (y antes de calcular
`dateLabel`/`timeLabel`), generar el link si la modalidad es video:

```diff
   const appt = await getAppointment(appointmentId);
   if (!appt) return { ok: false, message: "Cita no encontrada." };

+  let videoJoinUrl: string | undefined;
+  if (appt.modality === "video") {
+    const { joinToken } = await ensureVideoRoom(appointmentId);
+    videoJoinUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/join/${joinToken}`;
+  }
+
   const [patient, overview] = await Promise.all([
     getPatient(appt.patientId),
     getClinicOverview(),
   ]);
```

Y pasar `videoJoinUrl` a ambos builders (dos sitios en la misma función):

```diff
         body: buildReminderWhatsApp({
           patientName: appt.patientName,
           clinicName: user.clinicName,
           dateLabel,
           timeLabel,
+          videoJoinUrl,
         }),
```

```diff
       await email.send(
         buildReminderEmail({
           to: patient!.email!,
           patientName: appt.patientName,
           clinicName: user.clinicName,
           dateLabel,
           timeLabel,
+          videoJoinUrl,
         }),
       );
```

- [ ] **Step 2: Añadir `NEXT_PUBLIC_SITE_URL` al `.env.example`**

```diff
 # ── WhatsApp (Twilio) — opcional, planes Clínica/Enterprise ─
 TWILIO_ACCOUNT_SID=                 # vacío → WhatsApp en modo log/mock
 TWILIO_AUTH_TOKEN=
 TWILIO_WHATSAPP_FROM=               # p.ej. "whatsapp:+14155238886"

+# ── Telehealth (Daily.co) ─────────────────────────────────
+DAILY_API_KEY=                      # vacío → videollamada en modo mock
+VIDEO_PROVIDER=                     # forzado opcional: mock | daily
+NEXT_PUBLIC_SITE_URL=               # p.ej. https://app.tudominio.co (para links de /join)
+
 # Forzado opcional de proveedor (mock | deepgram | openai)
 TRANSCRIPTION_PROVIDER=
 ANALYSIS_PROVIDER=
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: sin errores.

- [ ] **Step 4: Lint + commit**

Run: `npx eslint "app/(app)/appointments/actions.ts"`
Expected: limpio.

```bash
git add "app/(app)/appointments/actions.ts" .env.example
git commit -m "feat(telehealth): sendReminderAction genera y envía el link de video"
```

---

### Task 11: Iniciar videollamada desde la agenda

**Files:**
- Modify: `app/(app)/appointments/actions.ts`
- Modify: `app/(app)/appointments/page.tsx`
- Modify: `lib/db/consultations.ts`

- [ ] **Step 1: `startConsultation` acepta `appointmentId` opcional (ya existe la columna, falta pasarla)**

```diff
 export async function startConsultation(
   clinicId: string,
-  input: { patientId: string; doctorId: string; consentId: string | null; reason?: string | null },
+  input: {
+    patientId: string;
+    doctorId: string;
+    consentId: string | null;
+    reason?: string | null;
+    appointmentId?: string | null;
+  },
 ): Promise<string> {
   const supabase = await createClient();
   const { data, error } = await supabase
     .from("consultations")
     .insert({
       clinic_id: clinicId,
       patient_id: input.patientId,
       doctor_id: input.doctorId,
       consent_id: input.consentId,
+      appointment_id: input.appointmentId ?? null,
       status: "in_progress",
       reason_enc: input.reason ? encrypt(input.reason) : null,
     })
     .select("id")
     .single();
   if (error) throw error;
   return data.id;
 }
```

- [ ] **Step 2: Nueva Server Action `startVideoConsultationAction`**

Añadir dos imports nuevos al bloque de imports existente (`redirect`,
`getAppointment` y `ensureVideoRoom` **ya están importados** — este último
desde el Task 10; no los repitas):

```diff
 import { redirect } from "next/navigation";
 import { revalidatePath } from "next/cache";
 import { z } from "zod";
 import { requireUser } from "@/lib/auth";
 import {
   createAppointment,
   updateAppointment,
   setAppointmentStatus,
   getAppointment,
   ensureVideoRoom,
   type AppointmentInput,
 } from "@/lib/db/appointments";
+import { getActiveConsent } from "@/lib/db/consents";
+import { startConsultation } from "@/lib/db/consultations";
 import { getPatient } from "@/lib/db/patients";
```

Luego añadir la acción al final del archivo:

```ts
/**
 * Inicia una videollamada desde una cita ya agendada: garantiza la sala (si
 * el recordatorio nunca se envió, aquí se crea por primera vez), crea la
 * consulta enlazada, y lleva al doctor a /consultations/[id]/live — donde
 * Task 14 detecta la modalidad video y embebe la llamada.
 */
export async function startVideoConsultationAction(appointmentId: string): Promise<void> {
  const user = await requireUser();
  const appt = await getAppointment(appointmentId);
  if (!appt || appt.modality !== "video") {
    return;
  }

  const consent = await getActiveConsent(appt.patientId);
  if (!consent) redirect(`/patients/${appt.patientId}/consent`);

  await ensureVideoRoom(appointmentId);

  const consultationId = await startConsultation(user.clinicId, {
    patientId: appt.patientId,
    doctorId: appt.doctorId,
    consentId: consent!.id,
    appointmentId,
  });
  await logAudit({
    clinicId: user.clinicId,
    actorId: user.id,
    action: "consultation.started",
    entityType: "consultation",
    entityId: consultationId,
    metadata: { patientId: appt.patientId, appointmentId, modality: "video" },
  });
  redirect(`/consultations/${consultationId}/live`);
}
```

- [ ] **Step 3: Botón "Iniciar videollamada" en la agenda**

En `app/(app)/appointments/page.tsx`, importar la acción y `Video` de
`lucide-react`, y agregar el botón junto a `ReminderButton` **solo para citas
de modalidad video que no estén canceladas/completadas**:

```diff
 import { AppointmentStatusMenu } from "@/components/appointment-status";
 import { ReminderButton } from "@/components/reminder-button";
+import { StartVideoButton } from "@/components/start-video-button";
```

```diff
                     <AppointmentStatusMenu id={appt.id} status={appt.status} />

                     <ReminderButton appointmentId={appt.id} />

+                    {appt.modality === "video" &&
+                      appt.status !== "cancelled" &&
+                      appt.status !== "completed" && (
+                        <StartVideoButton appointmentId={appt.id} />
+                      )}
+
                     <Link
                       href={`/appointments/${appt.id}/edit`}
```

Crear `components/start-video-button.tsx` (client component, mismo patrón que
`components/reminder-button.tsx`):

```tsx
// components/start-video-button.tsx
"use client";

import { useTransition } from "react";
import { Video } from "lucide-react";
import { startVideoConsultationAction } from "@/app/(app)/appointments/actions";

export function StartVideoButton({ appointmentId }: { appointmentId: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      onClick={() => startTransition(() => startVideoConsultationAction(appointmentId))}
      disabled={pending}
      className="text-muted-foreground hover:text-purple disabled:opacity-50"
      aria-label="Iniciar videollamada"
      title="Iniciar videollamada"
    >
      <Video className="size-4" />
    </button>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: sin errores.

- [ ] **Step 5: Lint + commit**

Run: `npx eslint "app/(app)/appointments/actions.ts" "app/(app)/appointments/page.tsx" components/start-video-button.tsx lib/db/consultations.ts`
Expected: todo limpio.

```bash
git add "app/(app)/appointments/actions.ts" "app/(app)/appointments/page.tsx" components/start-video-button.tsx lib/db/consultations.ts
git commit -m "feat(telehealth): botón Iniciar videollamada desde la agenda"
```

---

### Task 12: `components/video-call.tsx` — embed de Daily.co (lado doctor)

Usa `@daily-co/daily-js` (verificado contra la documentación oficial:
`Daily.createCallObject()`, `call.join({url, token, userName})`, evento
`track-started` con payload `{participant, track, type}`, `call.leave()`).

**Files:**
- Modify: `package.json` (nueva dependencia)
- Create: `components/video-call.tsx`

- [ ] **Step 1: Instalar la dependencia**

Run: `npm install @daily-co/daily-js`
Expected: se agrega a `dependencies` en `package.json`.

- [ ] **Step 2: Implementar el componente**

```tsx
// components/video-call.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import Daily, { type DailyCall } from "@daily-co/daily-js";
import { MicOff } from "lucide-react";

/**
 * Embed de la videollamada (Daily.co). Renderiza el video local + remoto y,
 * vía `onRemoteAudioTrack`, entrega al padre la pista de audio del paciente
 * en crudo apenas está disponible — el padre (LiveConsultation) la usa para
 * alimentar una segunda conexión Deepgram tageada "Paciente" (ver spec §6:
 * sin esto no hay forma de transcribir lo que dice el paciente).
 */
export function VideoCall({
  roomUrl,
  token,
  userName,
  onRemoteAudioTrack,
}: {
  roomUrl: string;
  token: string;
  userName: string;
  onRemoteAudioTrack: (track: MediaStreamTrack) => void;
}) {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const callRef = useRef<DailyCall | null>(null);
  const [joinError, setJoinError] = useState(false);

  useEffect(() => {
    const call = Daily.createCallObject();
    callRef.current = call;

    call.on("track-started", (ev) => {
      if (!ev) return;
      const { participant, track, type } = ev;
      if (type === "video") {
        const el = participant?.local ? localVideoRef.current : remoteVideoRef.current;
        if (el) el.srcObject = new MediaStream([track]);
      }
      if (type === "audio" && !participant?.local) {
        onRemoteAudioTrack(track);
      }
    });

    call.join({ url: roomUrl, token, userName }).catch(() => setJoinError(true));

    return () => {
      call.leave().catch(() => {});
      call.destroy();
      callRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- se une una sola vez por montaje; roomUrl/token no cambian durante la llamada.
  }, []);

  if (joinError) {
    return (
      <p className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
        <MicOff className="size-3.5" />
        No se pudo conectar la videollamada. Revisa tu conexión e intenta de nuevo.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2 overflow-hidden rounded-2xl bg-navy">
      <video ref={localVideoRef} autoPlay playsInline muted className="aspect-video w-full rounded-xl object-cover" />
      <video ref={remoteVideoRef} autoPlay playsInline className="aspect-video w-full rounded-xl object-cover" />
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: sin errores.

- [ ] **Step 4: Lint + commit**

Run: `npx eslint components/video-call.tsx`
Expected: limpio.

```bash
git add package.json package-lock.json components/video-call.tsx
git commit -m "feat(telehealth): componente VideoCall (embed Daily.co)"
```

---

### Task 13: `live-consultation.tsx` — modo video (sin diarización)

**Files:**
- Modify: `components/live-consultation.tsx`

- [ ] **Step 1: Nuevas props + rama de modo video**

`transcriptionMode` gana un tercer valor `"video"`, y el componente recibe
`videoRoomUrl`/`videoToken` cuando aplica. En modo video: el mic local del
doctor sigue capturándose igual que en modo `"deepgram"` (misma conexión
Deepgram, tageada `"Doctor"` directamente — sin diarización, ya se sabe quién
es), y una **segunda** conexión Deepgram independiente transcribe la pista
remota que entrega `<VideoCall>`, tageada `"Paciente"`.

```diff
 import { MicOff, Square } from "lucide-react";
 import { MOCK_SESSION } from "@/lib/providers/mock-transcript";
 // Imports directos a los módulos (no al barrel @/lib/providers, que re-exporta
 // mock.ts → node:crypto, incompatible con el bundle del cliente).
 import { DEEPGRAM_LISTEN_URL } from "@/lib/providers/deepgram";
 import { majoritySpeaker, labelForSpeaker, type DiarizedWord } from "@/lib/diarization";
 import {
   appendChunkAction,
   endConsultationAction,
 } from "@/app/(app)/consultations/actions";
 import { Button } from "@/components/ui/button";
+import { VideoCall } from "@/components/video-call";
```

```diff
 export function LiveConsultation({
   consultationId,
   patientName,
   transcriptionMode,
   sessionToken,
+  videoRoomUrl,
+  videoToken,
 }: {
   consultationId: string;
   patientName: string;
-  /** "deepgram" usa streaming real navegador→Deepgram; "mock" reproduce un guion de demo. */
-  transcriptionMode: "mock" | "deepgram";
+  /** "deepgram"/"mock" = modo texto (in-person, como hoy). "video" = telehealth:
+   *  embebe Daily.co y transcribe doctor+paciente por separado, sin diarización. */
+  transcriptionMode: "mock" | "deepgram" | "video";
   sessionToken?: string;
+  videoRoomUrl?: string;
+  videoToken?: string;
 }) {
```

- [ ] **Step 2: Segunda conexión Deepgram para la pista remota**

Añadir, junto a los demás `useRef`, una ref para el WebSocket/recorder del
lado paciente, y un handler `handleRemoteAudioTrack` que arma esa segunda
conexión bajo demanda (se llama una sola vez, cuando `<VideoCall>` entrega la
pista por primera vez):

```diff
   const streamRef = useRef<MediaStream | null>(null);
   const wsRef = useRef<WebSocket | null>(null);
   const recorderRef = useRef<MediaRecorder | null>(null);
+  const remoteWsRef = useRef<WebSocket | null>(null);
+  const remoteRecorderRef = useRef<MediaRecorder | null>(null);
   const seqRef = useRef(0);
+  const remoteSeqRef = useRef(0);
   const speakerLabelsRef = useRef<Map<number, string>>(new Map());
   const scrollRef = useRef<HTMLDivElement>(null);
```

```diff
+  // ── Modo video: pista remota del paciente → segunda conexión Deepgram,
+  // ── tageada "Paciente" directamente (no hace falta diarización: cada
+  // ── pista ya sabe de quién es). Requiere sessionToken propio del doctor
+  // ── (el mismo `sessionToken` que llega por props sirve para ambas
+  // ── conexiones — Deepgram no limita cuántos sockets abre una key efímera).
+  function handleRemoteAudioTrack(track: MediaStreamTrack) {
+    if (transcriptionMode !== "video" || !sessionToken || remoteWsRef.current) return;
+
+    const stream = new MediaStream([track]);
+    const ws = new WebSocket(DEEPGRAM_LISTEN_URL, ["token", sessionToken]);
+    remoteWsRef.current = ws;
+
+    ws.onmessage = (event) => {
+      try {
+        const data: DeepgramResult = JSON.parse(event.data as string);
+        const text = data.channel?.alternatives?.[0]?.transcript?.trim();
+        if (data.is_final && text) {
+          const seq = remoteSeqRef.current++;
+          setChunks((prev) => [...prev, { speaker: "Paciente", text }]);
+          void appendChunkAction(consultationId, { seq, speaker: "Paciente", text }).catch(() => {});
+        }
+      } catch {
+        // mensaje no-JSON; se ignora.
+      }
+    };
+
+    ws.onopen = () => {
+      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
+      remoteRecorderRef.current = recorder;
+      recorder.ondataavailable = (e) => {
+        if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) ws.send(e.data);
+      };
+      recorder.start(250);
+    };
+  }
```

- [ ] **Step 3: El mic local del doctor en modo video se tagea `"Doctor"` fijo (sin diarización)**

El `useEffect` de modo `"deepgram"` existente hace diarización porque no sabe
si el único mic capturado tiene 1 o 2 hablantes mezclados (in-person). En modo
`"video"` el mic local es **solo** el doctor — se reusa la misma conexión pero
sin pasar por `majoritySpeaker`/`labelForSpeaker`:

```diff
   // ── Modo real: micrófono → MediaRecorder → WebSocket directo a Deepgram ──
   useEffect(() => {
-    if (transcriptionMode !== "deepgram" || !sessionToken) return;
+    if ((transcriptionMode !== "deepgram" && transcriptionMode !== "video") || !sessionToken) return;
```

```diff
         ws.onmessage = (event) => {
           try {
             const data: DeepgramResult = JSON.parse(event.data as string);
             const alt = data.channel?.alternatives?.[0];
             const text = alt?.transcript?.trim();
             if (data.is_final && text) {
-              const speakerIndex = majoritySpeaker(alt?.words ?? []);
-              const speaker =
-                speakerIndex !== undefined
-                  ? labelForSpeaker(speakerIndex, speakerLabelsRef.current)
-                  : "Transcripción";
+              const speaker =
+                transcriptionMode === "video"
+                  ? "Doctor"
+                  : (() => {
+                      const speakerIndex = majoritySpeaker(alt?.words ?? []);
+                      return speakerIndex !== undefined
+                        ? labelForSpeaker(speakerIndex, speakerLabelsRef.current)
+                        : "Transcripción";
+                    })();
               const seq = seqRef.current++;
               setChunks((prev) => [...prev, { speaker, text }]);
               void appendChunkAction(consultationId, { seq, speaker, text }).catch(() => {});
             }
           } catch {
             // mensaje no-JSON (p.ej. control frames); se ignora.
           }
         };
```

```diff
   }, [transcriptionMode, sessionToken, consultationId]);
```

(la dependencia del `useEffect` ya incluye `transcriptionMode`, no hace falta
tocarla más).

- [ ] **Step 4: Cerrar también la conexión remota en `finalize()` y en el cleanup**

```diff
   function finalize() {
     if (recorderRef.current && recorderRef.current.state !== "inactive") {
       recorderRef.current.stop();
     }
     if (wsRef.current?.readyState === WebSocket.OPEN) {
       wsRef.current.send(JSON.stringify({ type: "CloseStream" }));
       wsRef.current.close();
     }
     streamRef.current?.getTracks().forEach((t) => t.stop());
+    if (remoteRecorderRef.current && remoteRecorderRef.current.state !== "inactive") {
+      remoteRecorderRef.current.stop();
+    }
+    if (remoteWsRef.current?.readyState === WebSocket.OPEN) {
+      remoteWsRef.current.send(JSON.stringify({ type: "CloseStream" }));
+      remoteWsRef.current.close();
+    }
     setDone(true);
     startTransition(() => endConsultationAction(consultationId));
   }
```

- [ ] **Step 5: Embeber `<VideoCall>` cuando `transcriptionMode === "video"`**

Insertar justo antes del bloque de transcripción (`<div ref={scrollRef}>`):

```diff
+      {transcriptionMode === "video" && videoRoomUrl && videoToken && (
+        <VideoCall
+          roomUrl={videoRoomUrl}
+          token={videoToken}
+          userName="Doctor"
+          onRemoteAudioTrack={handleRemoteAudioTrack}
+        />
+      )}
+
       <div
         ref={scrollRef}
         className="flex-1 space-y-3 overflow-y-auto rounded-2xl border border-gray-line bg-card p-5"
       >
```

Y el texto de estado ("Grabando · identificando Doctor y Paciente") debe
distinguir el modo video (donde ya no se "identifica", se sabe):

```diff
                 {transcriptionMode === "deepgram"
                   ? "Grabando · identificando Doctor y Paciente"
-                  : "Grabando · transcribiendo en vivo"}
+                  : transcriptionMode === "video"
+                    ? "Videollamada en curso · transcribiendo"
+                    : "Grabando · transcribiendo en vivo"}
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: sin errores.

- [ ] **Step 7: Lint + commit**

Run: `npx eslint components/live-consultation.tsx`
Expected: limpio.

```bash
git add components/live-consultation.tsx
git commit -m "feat(telehealth): modo video en LiveConsultation (dos streams, sin diarización)"
```

---

### Task 14: `/consultations/[id]/live` — detectar modalidad video

**Files:**
- Modify: `app/(app)/consultations/[id]/live/page.tsx`

- [ ] **Step 1: Si la consulta viene de una cita de video, generar el meeting token del doctor**

```tsx
// app/(app)/consultations/[id]/live/page.tsx
import { notFound, redirect } from "next/navigation";
import { getConsultation } from "@/lib/db/consultations";
import { getAppointment } from "@/lib/db/appointments";
import { getTranscriptionProvider } from "@/lib/providers";
import { getVideoProvider } from "@/lib/video";
import { DailyVideoProvider } from "@/lib/video/daily";
import { requireUser } from "@/lib/auth";
import { LiveConsultation } from "@/components/live-consultation";

export default async function LiveConsultationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const consultation = await getConsultation(id);
  if (!consultation) notFound();
  // Si ya terminó, no se puede volver a grabar.
  if (consultation.status !== "in_progress") redirect(`/consultations/${id}`);

  const appointment = consultation.appointmentId
    ? await getAppointment(consultation.appointmentId)
    : null;
  const isVideo = appointment?.modality === "video";

  // El token efímero de Deepgram se acuña aquí (servidor); el navegador abre
  // el WebSocket directo con él. La API key real nunca llega al cliente.
  // En modo video se necesita igual (transcribe el mic local del doctor).
  const transcriptionProvider = getTranscriptionProvider();
  const needsDeepgramSession = transcriptionProvider.mode === "deepgram" || isVideo;
  const session = needsDeepgramSession
    ? await transcriptionProvider.createSession(id)
    : null;

  let videoRoomUrl: string | undefined;
  let videoToken: string | undefined;
  if (isVideo && appointment?.videoRoomName && appointment.videoRoomUrl) {
    const videoProvider = getVideoProvider();
    videoRoomUrl = appointment.videoRoomUrl;
    videoToken =
      videoProvider instanceof DailyVideoProvider
        ? await videoProvider.createMeetingToken({
            roomName: appointment.videoRoomName,
            userName: user.fullName,
            isOwner: true,
            expiresInSeconds: (appointment.durationMin + 30) * 60,
          })
        : "mock-token"; // MockVideoProvider: VideoCall renderiza sin conexión real.
  }

  return (
    <LiveConsultation
      consultationId={id}
      patientName={consultation.patientName}
      transcriptionMode={isVideo ? "video" : transcriptionProvider.mode === "deepgram" ? "deepgram" : "mock"}
      sessionToken={session?.sessionToken}
      videoRoomUrl={videoRoomUrl}
      videoToken={videoToken}
    />
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: sin errores.

- [ ] **Step 3: Lint + commit**

Run: `npx eslint "app/(app)/consultations/[id]/live/page.tsx"`
Expected: limpio.

```bash
git add "app/(app)/consultations/[id]/live/page.tsx"
git commit -m "feat(telehealth): la página live detecta modalidad video y arma el meeting token"
```

---

### Task 15: `/join/[token]` — página pública del paciente

**Files:**
- Create: `app/join/[token]/page.tsx`
- Create: `app/join/[token]/join-call.tsx`
- Modify: `proxy.ts`

- [ ] **Step 1: Añadir `/join` al allowlist público**

```diff
 // Rutas accesibles SIN sesión.
 const PUBLIC_PATHS = new Set(["/", "/login", "/signup"]);
 // Prefijos públicos (flujos de auth: confirm, set-password, auth-code-error…).
-const PUBLIC_PREFIXES = ["/auth"];
+const PUBLIC_PREFIXES = ["/auth", "/join"];
```

- [ ] **Step 2: Página del servidor — valida el token y arma el meeting token del paciente**

```tsx
// app/join/[token]/page.tsx
import { getAppointmentByJoinToken } from "@/lib/db/appointments";
import { isJoinWindowOpen } from "@/lib/video/join-token";
import { getVideoProvider } from "@/lib/video";
import { DailyVideoProvider } from "@/lib/video/daily";
import { JoinCall } from "./join-call";

export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const appointment = await getAppointmentByJoinToken(token);

  const invalid =
    !appointment ||
    appointment.modality !== "video" ||
    !appointment.videoRoomUrl ||
    !isJoinWindowOpen({
      scheduledAt: appointment.scheduledAt,
      durationMin: appointment.durationMin,
    });

  if (invalid) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-3 px-4 text-center">
        <h1 className="font-heading text-xl font-bold text-navy">Enlace no válido</h1>
        <p className="text-sm text-muted-foreground">
          Este enlace ya no es válido o aún no es hora de tu cita. Contacta a tu clínica si
          necesitas ayuda.
        </p>
      </div>
    );
  }

  const videoProvider = getVideoProvider();
  const isMock = !(videoProvider instanceof DailyVideoProvider);
  const patientToken = isMock
    ? "mock-token"
    : await videoProvider.createMeetingToken({
        roomName: appointment!.videoRoomName!,
        userName: appointment!.patientName,
        isOwner: false,
        expiresInSeconds: (appointment!.durationMin + 30) * 60,
      });

  return (
    <JoinCall
      roomUrl={appointment!.videoRoomUrl!}
      token={patientToken}
      patientName={appointment!.patientName}
    />
  );
}
```

- [ ] **Step 3: Cliente — reusa `VideoCall`, sin transcripción propia (la lleva el doctor)**

```tsx
// app/join/[token]/join-call.tsx
"use client";

import { useState } from "react";
import { VideoCall } from "@/components/video-call";

/**
 * Vista del paciente: solo la videollamada, sin panel de transcripción (esa
 * la lleva el doctor en /consultations/[id]/live — el paciente no necesita
 * ver ni recibir el texto). `onRemoteAudioTrack` es un no-op aquí: la pista
 * que le interesa capturar al PACIENTE es la del DOCTOR, pero esa transcripción
 * ya la genera el doctor con su propio mic local (ver Task 13) — duplicarla
 * desde este lado sería redundante.
 */
export function JoinCall({
  roomUrl,
  token,
  patientName,
}: {
  roomUrl: string;
  token: string;
  patientName: string;
}) {
  const [joined, setJoined] = useState(true);

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-4 px-4 py-6">
      <div>
        <h1 className="font-heading text-lg font-bold text-navy">Hola, {patientName}</h1>
        <p className="text-sm text-muted-foreground">Tu sesión está por comenzar.</p>
      </div>
      {joined && (
        <VideoCall
          roomUrl={roomUrl}
          token={token}
          userName={patientName}
          onRemoteAudioTrack={() => {}}
        />
      )}
      <p className="text-center text-xs text-muted-foreground">
        🔒 Esta llamada no se graba. Solo tu profesional ve la transcripción de la sesión.
      </p>
    </div>
  );
}
```

(`joined`/`setJoined` queda como estado sin usar más allá del valor inicial —
se deja explícitamente así, listo para un futuro botón "Salir de la llamada"
que está fuera de alcance de este plan; no lo agregues salvo que el spec lo
pida.)

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: sin errores.

- [ ] **Step 5: Lint + commit**

Run: `npx eslint proxy.ts "app/join/[token]/page.tsx" "app/join/[token]/join-call.tsx"`
Expected: limpio.

```bash
git add proxy.ts "app/join/[token]/page.tsx" "app/join/[token]/join-call.tsx"
git commit -m "feat(telehealth): página pública /join/[token] para el paciente"
```

---

### Task 16: Nueva versión de consentimiento (cubre video)

**Files:**
- Modify: `lib/consent.ts`

- [ ] **Step 1: Bump de versión + texto ampliado**

```diff
 /** Versión del documento de consentimiento. Cambiar al modificar el texto. */
-export const CONSENT_VERSION = "2026-06-v1";
+export const CONSENT_VERSION = "2026-07-v2";

 /** Texto del consentimiento informado (salud mental, Colombia). */
 export const CONSENT_TEXT = `CONSENTIMIENTO INFORMADO PARA LA ATENCIÓN PSICOLÓGICA Y EL TRATAMIENTO DE DATOS

 1. Naturaleza del servicio. Declaro que recibo atención psicológica profesional de carácter
 voluntario y comprendo que sus resultados dependen de múltiples factores.

-2. Grabación y transcripción. Autorizo que mis sesiones sean transcritas en tiempo real para
-fines clínicos. El audio NO se almacena: únicamente se conserva la transcripción en texto,
-cifrada. Puedo revocar esta autorización en cualquier momento.
+2. Grabación y transcripción. Autorizo que mis sesiones —presenciales o por videollamada— sean
+transcritas en tiempo real para fines clínicos. El audio y el video NO se almacenan ni se
+graban en ningún momento: únicamente se conserva la transcripción en texto, cifrada. Cuando la
+sesión es por videollamada, la conexión se realiza a través de un proveedor externo especializado
+en videoconferencia, que únicamente transmite la llamada en vivo sin guardar ninguna copia.
+Puedo revocar esta autorización en cualquier momento.

 3. Análisis asistido por inteligencia artificial. Entiendo que la transcripción puede analizarse
 con herramientas de IA para apoyar al profesional (resumen, sentimiento, patrones). Dichas
 sugerencias NO constituyen un diagnóstico y son validadas por el profesional tratante.
```

**⚠️ Nota para quien implemente:** este texto legal debe ser revisado por
alguien con criterio jurídico antes de usarse en producción — el spec (§8) ya
lo marca así explícitamente. No es responsabilidad de este plan validar el
lenguaje legal, solo el mecanismo (bump de versión → los pacientes existentes
deben refirmar, vía `getActiveConsent` comparando `document_version`).

- [ ] **Step 2: Confirmar que el mecanismo de refirma existente sigue funcionando**

Run: `npx vitest run tests/consent-age.test.ts`
Expected: sigue en PASS (este archivo no depende del texto/versión exactos).

- [ ] **Step 3: Typecheck + lint + commit**

Run: `npm run typecheck && npx eslint lib/consent.ts`
Expected: ambos limpios.

```bash
git add lib/consent.ts
git commit -m "feat(telehealth): nueva versión de consentimiento (cubre video)"
```

---

### Task 17: E2E — flujo completo de telehealth en modo mock

**Files:**
- Create: `tests/e2e/telehealth.spec.ts`
- Modify: `playwright.config.ts`

- [ ] **Step 1: Forzar `VIDEO_PROVIDER=mock` en el webServer de Playwright**

```diff
     env: {
       ANALYSIS_PROVIDER: "mock",
       TRANSCRIPTION_PROVIDER: "mock",
+      VIDEO_PROVIDER: "mock",
       RATE_LIMITING_DISABLED: "true",
     },
```

- [ ] **Step 2: Escribir el test E2E**

```ts
// tests/e2e/telehealth.spec.ts
import { test, expect } from "@playwright/test";
import { signUpAndActivate } from "./helpers/signup";

function signConsent(page: import("@playwright/test").Page) {
  const canvas = page.locator("canvas");
  return canvas.evaluate((el: HTMLCanvasElement) => {
    const r = el.getBoundingClientRect();
    const fire = (type: string, x: number, y: number) =>
      el.dispatchEvent(
        new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, clientX: r.left + x, clientY: r.top + y }),
      );
    fire("pointerdown", 60, 80);
    fire("pointermove", 220, 120);
    fire("pointermove", 360, 90);
    fire("pointerup", 360, 90);
  });
}

test("telehealth: cita de video → iniciar videollamada → finalizar → reporte", async ({ page }) => {
  test.setTimeout(60_000);

  const email = `tele_${Date.now()}@e-irene.test`;
  await signUpAndActivate(page, { clinicName: "Clínica Tele", fullName: "Dra. Tele", email });

  await page.goto("/patients/new");
  await page.fill("#fullName", "Paciente Tele");
  await page.getByRole("button", { name: /crear paciente/i }).click();
  await expect(page.getByRole("heading", { name: "Paciente Tele" })).toBeVisible();

  await page.getByRole("link", { name: /capturar consentimiento/i }).click();
  await signConsent(page);
  await page.check('input[name="accepted"]');
  await page.getByRole("button", { name: /firmar consentimiento/i }).click();
  await expect(page.getByText("Firmado", { exact: true })).toBeVisible();

  await page.goto("/appointments/new");
  await page.selectOption("#patientId", { label: "Paciente Tele" });
  await page.selectOption("#modality", "video");
  await page.fill("#scheduledAt", new Date(Date.now() - 5 * 60_000).toISOString().slice(0, 16));
  await page.getByRole("button", { name: /agendar cita/i }).click();
  await expect(page).toHaveURL(/\/appointments$/);

  await page.getByRole("button", { name: /iniciar videollamada/i }).click();
  await expect(page).toHaveURL(/consultations\/.+\/live/);
  await expect(page.getByText(/videollamada en curso/i)).toBeVisible();

  await page.getByRole("button", { name: /finalizar consulta/i }).click();
  await expect(page).toHaveURL(/consultations\/[^/]+$/);
  await expect(page.getByText(/Apoyo clínico, no diagnóstico/)).toBeVisible({ timeout: 20_000 });
});
```

- [ ] **Step 3: Correr el test contra el flujo mock**

Run: `npx playwright test telehealth.spec.ts`
Expected: PASS. (Si el `scheduledAt` construido con `toISOString().slice(0,16)`
no coincide con el formato exacto que espera el input `datetime-local` en la
zona horaria del runner, ajustar usando el mismo helper `fromInputDateTime`/
`toInputDateTime` de `lib/dates.ts` en vez de construirlo a mano — revisar
`tests/dates.test.ts` para el formato esperado antes de depurar a ciegas.)

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/telehealth.spec.ts playwright.config.ts
git commit -m "test(telehealth): E2E del flujo completo en modo mock"
```

---

### Task 18: Suite completa + verificación manual en navegador

**Files:** (ninguno nuevo — solo verificación)

- [ ] **Step 1: Typecheck + lint + unit tests completos**

Run: `npm run typecheck && npm run lint && npm test`
Expected: todo limpio, todos los tests unitarios en PASS.

- [ ] **Step 2: E2E completa (no solo el nuevo test)**

Run: `npm run test:e2e`
Expected: todos los specs en PASS, incluidos los existentes
(`consultation.spec.ts`, `golden.spec.ts`, etc. — confirmar que nada se rompió
por los cambios en `appointments.ts`/`live-consultation.tsx`).

- [ ] **Step 3: Verificación manual en navegador (modo mock, sin cuenta real de Daily.co)**

Levantar el dev server, iniciar sesión, crear una cita de modalidad "Video"
para dentro de los próximos minutos, pulsar "Iniciar videollamada", confirmar
que `<VideoCall>` renderiza sin crashear (en mock, `call.join()` fallará
silenciosamente contra una URL falsa — confirmar que el mensaje de error
"No se pudo conectar la videollamada" se muestra en vez de romper la página),
y que "Finalizar consulta" sigue generando el reporte igual que en el flujo
de texto.

- [ ] **Step 4: Commit final si hubo ajustes de la verificación**

```bash
git add -A
git commit -m "fix(telehealth): ajustes de verificación end-to-end"
```

---

## Fuera de alcance de este plan (ver spec §9)

Salas de espera, llamadas de más de 2 participantes, compartir pantalla, chat
de texto durante la llamada, grabación, app móvil nativa, portal del
paciente. No implementar nada de esto aunque parezca "fácil de agregar ya que
estamos aquí" — YAGNI.

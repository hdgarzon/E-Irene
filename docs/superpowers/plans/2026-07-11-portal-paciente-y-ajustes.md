# Portal Paciente y Ajustes Menores — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the 7 changes from `docs/superpowers/specs/2026-07-10-portal-paciente-y-ajustes-design.md`: signup copy fix, public token-based links for patient consent/psychometric assessments, transcript removal from PDF + 30-day retention via pg_cron, a public security summary page, stronger button press feedback, and a one-off role data fix.

**Architecture:** A new `patient_links` table stores hashed, expiring tokens. A new public route tree (`app/enlace/[token]`) — explicitly allow-listed in `proxy.ts` — validates the token server-side with the Supabase service-role client and renders the *existing* `ConsentForm` / assessment question form. Writes go through new `...ViaLink` functions that use the service-role client (bypassing RLS) instead of the session-scoped client, since there is no authenticated session on this path. Retention is handled entirely in Postgres via `pg_cron`, no new HTTP surface.

**Tech Stack:** Next.js 16 App Router (Server Actions, `proxy.ts`), Supabase (Postgres + RLS + `pg_cron`), `@react-pdf/renderer`, Vitest, Playwright (+ local Mailpit for e2e email assertions).

---

## Before you start

- Read `docs/superpowers/specs/2026-07-10-portal-paciente-y-ajustes-design.md` — this plan implements it task-by-task.
- This repo runs a customized Next.js (16.2.9) with breaking changes from stock Next.js: the middleware file is `proxy.ts` (not `middleware.ts`), its handler is exported as `proxy` (not `middleware`), and its config export **must** be named `config`. Route `params` are always `Promise<...>` and must be awaited. Bundled docs are at `node_modules/next/dist/docs/` — check them if anything here looks off relative to what you remember about Next.js.
- Supabase project id for MCP tool calls: `sljxoqwrnmybivccnsck` (name "E-Irene").
- Run `npm run typecheck` and `npm test` after every task that touches `.ts`/`.tsx` files, not just at the end.

---

### Task 1: Signup label copy fix

**Files:**
- Modify: `components/auth/signup-form.tsx:35`

- [ ] **Step 1: Change the label text**

In `components/auth/signup-form.tsx`, change line 35 from:

```tsx
        <Label htmlFor="clinicName">Nombre de la clínica o consulta</Label>
```

to:

```tsx
        <Label htmlFor="clinicName">Nombre de la clínica</Label>
```

- [ ] **Step 2: Verify no test/snapshot references the old copy**

Run: `grep -rn "clínica o consulta" tests app components`
Expected: no output (no test depends on the old string).

- [ ] **Step 3: Commit**

```bash
git add components/auth/signup-form.tsx
git commit -m "fix(signup): quitar 'o consulta' del label de nombre de clínica"
```

---

### Task 2: Stronger visual press feedback on buttons

**Files:**
- Modify: `components/ui/button.tsx:7`

The base `Button` already has a subtle press state (`active:not-aria-[haspopup]:translate-y-px`). Strengthen it with a scale-down so the "pressed" feel is clearly visible, without touching every call site.

- [ ] **Step 1: Update the base button classes**

In `components/ui/button.tsx`, in the `cva(...)` call, change the base class string (line 7) from:

```tsx
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
```

to:

```tsx
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px active:not-aria-[haspopup]:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
```

(Only change: added `active:not-aria-[haspopup]:scale-[0.97]` right after the existing `translate-y-px` class.)

- [ ] **Step 2: Visually verify in the browser**

Run `npm run dev`, open any page with a `<Button>` (e.g. `/login`), open devtools, and hold the mouse down on a button. Expected: the button visibly shrinks (3%) and nudges down while pressed, and springs back on release. Buttons with `aria-haspopup` (dropdown triggers like the user menu) should NOT shrink, to avoid dropdown-menu jank.

- [ ] **Step 3: Commit**

```bash
git add components/ui/button.tsx
git commit -m "feat(ui): reforzar feedback visual de clic en botones"
```

---

### Task 3: Migration — `patient_links` table

**Files:**
- Create: `supabase/migrations/0020_patient_links.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- ============================================================================
-- patient_links: enlaces únicos con token para que el paciente firme
-- consentimiento o responda escalas psicométricas sin necesitar cuenta.
-- ============================================================================

create table patient_links (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  purpose text not null check (purpose in ('consent', 'assessment')),
  assessment_type text check (assessment_type in ('phq9', 'gad7')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  completed_at timestamptz,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  constraint patient_links_assessment_type_check
    check (purpose <> 'assessment' or assessment_type is not null)
);
create index patient_links_patient_idx on patient_links(patient_id);
create index patient_links_token_hash_idx on patient_links(token_hash);

alter table patient_links enable row level security;

create policy patient_links_select on patient_links
  for select using (clinic_id = auth_clinic_id());
create policy patient_links_insert on patient_links
  for insert with check (clinic_id = auth_clinic_id());

-- Trazabilidad: qué link (si alguno) originó cada consentimiento/escala.
alter table consents add column link_id uuid references patient_links(id);
alter table psychometric_assessments add column link_id uuid references patient_links(id);
```

- [ ] **Step 2: Apply the migration via Supabase MCP**

Use the `apply_migration` MCP tool with `project_id: "sljxoqwrnmybivccnsck"`, `name: "patient_links"`, and the SQL above as `query`.

- [ ] **Step 3: Verify the table exists**

Use the `list_tables` MCP tool with `project_id: "sljxoqwrnmybivccnsck"`, `schemas: ["public"]`, `verbose: true`. Expected: `patient_links` appears with the columns above, and `consents`/`psychometric_assessments` each show a new `link_id` column.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0020_patient_links.sql
git commit -m "feat(db): tabla patient_links para enlaces de consentimiento/escalas"
```

---

### Task 4: Regenerate `types/database.ts`

**Files:**
- Modify: `types/database.ts` (fully regenerated, not hand-edited)

- [ ] **Step 1: Regenerate types**

Use the `generate_typescript_types` MCP tool with `project_id: "sljxoqwrnmybivccnsck"`. Overwrite `types/database.ts` with the returned content (use the Write tool with the full returned TypeScript).

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no new errors (existing code shouldn't reference anything removed; `patient_links` types simply become available).

- [ ] **Step 3: Commit**

```bash
git add types/database.ts
git commit -m "chore(db): regenerar tipos tras agregar patient_links"
```

---

### Task 5: Token utilities (`lib/patient-links.ts`)

**Files:**
- Create: `lib/patient-links.ts`
- Test: `tests/patient-links.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { generatePatientLinkToken, patientLinkExpiryDate, buildPatientLinkUrl } from "@/lib/patient-links";
import { sha256 } from "@/lib/consent";

describe("generatePatientLinkToken", () => {
  it("returns a token whose hash matches tokenHash", () => {
    const { token, tokenHash } = generatePatientLinkToken();
    expect(sha256(token)).toBe(tokenHash);
  });

  it("generates a different token each call", () => {
    const a = generatePatientLinkToken();
    const b = generatePatientLinkToken();
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });

  it("generates a URL-safe token with no padding characters", () => {
    const { token } = generatePatientLinkToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("patientLinkExpiryDate", () => {
  it("expires 7 days after the given date", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const expiry = patientLinkExpiryDate(from);
    expect(expiry.toISOString()).toBe("2026-01-08T00:00:00.000Z");
  });
});

describe("buildPatientLinkUrl", () => {
  it("builds an absolute /enlace/<token> URL using NEXT_PUBLIC_APP_URL", () => {
    const original = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = "https://e-irene.co";
    expect(buildPatientLinkUrl("abc123")).toBe("https://e-irene.co/enlace/abc123");
    process.env.NEXT_PUBLIC_APP_URL = original;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/patient-links.test.ts`
Expected: FAIL with a module-not-found error for `@/lib/patient-links`.

- [ ] **Step 3: Write the implementation**

```ts
import { randomBytes } from "node:crypto";
import { sha256 } from "@/lib/consent";

/** Días de validez de un link único de paciente antes de expirar. */
export const PATIENT_LINK_TTL_DAYS = 7;

/** Genera un token de 256 bits (URL-safe) y su hash SHA-256. El token crudo
 * solo existe en memoria por esta llamada — nunca se persiste. */
export function generatePatientLinkToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: sha256(token) };
}

/** Fecha de expiración a partir de `from` (por defecto, ahora). */
export function patientLinkExpiryDate(from: Date = new Date()): Date {
  return new Date(from.getTime() + PATIENT_LINK_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/** URL pública absoluta que se envía al paciente por correo. */
export function buildPatientLinkUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://e-irene.co";
  return `${base}/enlace/${token}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/patient-links.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Add the new env var to `.env.example`**

In `.env.example`, add this line under the Supabase section:

```
NEXT_PUBLIC_APP_URL=                # dominio público, p.ej. https://e-irene.co (usado en links de paciente)
```

- [ ] **Step 6: Commit**

```bash
git add lib/patient-links.ts tests/patient-links.test.ts .env.example
git commit -m "feat(patient-links): utilidades de token (generación, expiración, URL)"
```

---

### Task 6: DB access for `patient_links` (`lib/db/patient-links.ts`)

**Files:**
- Create: `lib/db/patient-links.ts`

- [ ] **Step 1: Write the implementation**

```ts
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sha256 } from "@/lib/consent";
import { generatePatientLinkToken, patientLinkExpiryDate } from "@/lib/patient-links";
import type { AssessmentType } from "@/lib/psychometrics";

export type PatientLinkPurpose = "consent" | "assessment";

export interface PatientLink {
  id: string;
  clinicId: string;
  patientId: string;
  purpose: PatientLinkPurpose;
  assessmentType: AssessmentType | null;
  expiresAt: string;
  completedAt: string | null;
}

interface PatientLinkRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  purpose: PatientLinkPurpose;
  assessment_type: AssessmentType | null;
  expires_at: string;
  completed_at: string | null;
}

const COLS = "id, clinic_id, patient_id, purpose, assessment_type, expires_at, completed_at";

function mapRow(r: PatientLinkRow): PatientLink {
  return {
    id: r.id,
    clinicId: r.clinic_id,
    patientId: r.patient_id,
    purpose: r.purpose,
    assessmentType: r.assessment_type,
    expiresAt: r.expires_at,
    completedAt: r.completed_at,
  };
}

/**
 * Crea un link de paciente. Llamado por el personal de la clínica (sesión con
 * RLS). Devuelve el token en claro UNA sola vez — solo se persiste su hash.
 */
export async function createPatientLink(
  clinicId: string,
  createdBy: string,
  input: { patientId: string; purpose: PatientLinkPurpose; assessmentType: AssessmentType | null },
): Promise<{ link: PatientLink; token: string }> {
  const supabase = await createClient();
  const { token, tokenHash } = generatePatientLinkToken();
  const { data, error } = await supabase
    .from("patient_links")
    .insert({
      clinic_id: clinicId,
      patient_id: input.patientId,
      purpose: input.purpose,
      assessment_type: input.assessmentType,
      token_hash: tokenHash,
      expires_at: patientLinkExpiryDate().toISOString(),
      created_by: createdBy,
    })
    .select(COLS)
    .single();
  if (error) throw error;
  return { link: mapRow(data as unknown as PatientLinkRow), token };
}

export type PatientLinkLookup =
  | { status: "valid"; link: PatientLink }
  | { status: "not_found" }
  | { status: "expired" }
  | { status: "completed" };

/**
 * Valida un token recibido en una ruta pública (sin sesión). Usa el cliente
 * service-role porque no hay `auth.uid()` que satisfaga RLS en este flujo.
 */
export async function getPatientLinkByToken(token: string): Promise<PatientLinkLookup> {
  const admin = createAdminClient();
  const tokenHash = sha256(token);
  const { data, error } = await admin
    .from("patient_links")
    .select(COLS)
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { status: "not_found" };
  const link = mapRow(data as unknown as PatientLinkRow);
  if (link.completedAt) return { status: "completed" };
  if (new Date(link.expiresAt).getTime() < Date.now()) return { status: "expired" };
  return { status: "valid", link };
}

/** Marca un link como completado. Cliente service-role — solo se llama tras
 * escribir exitosamente el consentimiento/escala asociado. */
export async function markPatientLinkCompleted(id: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("patient_links")
    .update({ completed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/db/patient-links.ts
git commit -m "feat(patient-links): acceso a datos (crear, validar por token, completar)"
```

---

### Task 7: Public audit logging (`lib/db/audit.ts`)

**Files:**
- Modify: `lib/db/audit.ts`

The existing `logAudit` uses the session-scoped client and requires a non-null `actorId`. The public link flow has no session and no actor, so add a twin function using the service-role client.

- [ ] **Step 1: Add `logAuditPublic`**

Append to `lib/db/audit.ts`:

```ts
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Igual que `logAudit`, pero para acciones sin sesión (flujo de link público
 * del paciente): usa el cliente service-role y no requiere `actorId`.
 */
export async function logAuditPublic(params: {
  clinicId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const admin = createAdminClient();
  await admin.from("audit_logs").insert({
    clinic_id: params.clinicId,
    actor_id: null,
    action: params.action,
    entity_type: params.entityType,
    entity_id: params.entityId ?? null,
    metadata: (params.metadata ?? {}) as never,
  });
}
```

(Add the `createAdminClient` import to the existing top-of-file imports, next to the existing `createClient` import.)

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/db/audit.ts
git commit -m "feat(audit): logAuditPublic para acciones sin sesión (links de paciente)"
```

---

### Task 8: Admin-client patient lookup (`lib/db/patients.ts`)

**Files:**
- Modify: `lib/db/patients.ts`

- [ ] **Step 1: Add `getPatientForLink`**

Add this import at the top of `lib/db/patients.ts` (next to the existing `createClient` import):

```ts
import { createAdminClient } from "@/lib/supabase/admin";
```

Add this function after `getPatient`:

```ts
/**
 * Obtiene un paciente para el flujo de link público (sin sesión), con el
 * cliente service-role. SOLO debe invocarse después de validar un token en
 * `patient_links` — nunca expone datos de paciente sin esa verificación previa.
 */
export async function getPatientForLink(id: string): Promise<Patient | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("patients")
    .select(COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? tryDecryptPatient(data as unknown as PatientRow) : null;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/db/patients.ts
git commit -m "feat(patients): getPatientForLink (lectura sin sesión tras validar token)"
```

---

### Task 9: `createConsentViaLink` (`lib/db/consents.ts`)

**Files:**
- Modify: `lib/db/consents.ts`

- [ ] **Step 1: Add the function**

Add this import at the top of `lib/db/consents.ts` (next to the existing `createClient` import):

```ts
import { createAdminClient } from "@/lib/supabase/admin";
```

Add this function after `createConsent`:

```ts
/**
 * Igual que `createConsent`, pero para el flujo de link público sin sesión:
 * usa el cliente service-role (bypassa RLS). SOLO debe invocarse después de
 * revalidar el token en `patient_links` — nunca desde una ruta autenticada.
 */
export async function createConsentViaLink(input: {
  clinicId: string;
  patientId: string;
  linkId: string;
  documentVersion: string;
  documentHash: string;
  signaturePath: string | null;
  signerName: string;
  ip: string | null;
  userAgent: string | null;
  isMinor: boolean;
  representativeDocument?: string | null;
  representativeRelationship?: string | null;
}): Promise<Consent> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("consents")
    .insert({
      clinic_id: input.clinicId,
      patient_id: input.patientId,
      link_id: input.linkId,
      document_version: input.documentVersion,
      document_hash: input.documentHash,
      signature_path: input.signaturePath,
      signer_name: input.signerName,
      ip: input.ip,
      user_agent: input.userAgent,
      is_minor: input.isMinor,
      representative_document_enc: encryptNullable(input.representativeDocument ?? null),
      representative_relationship: input.representativeRelationship ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return mapRow(data as ConsentRow);
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/db/consents.ts
git commit -m "feat(consents): createConsentViaLink para el flujo de link público"
```

---

### Task 10: `createAssessmentViaLink` (`lib/db/assessments.ts`)

**Files:**
- Modify: `lib/db/assessments.ts`

- [ ] **Step 1: Add the function**

Add this import at the top of `lib/db/assessments.ts` (next to the existing `createClient` import):

```ts
import { createAdminClient } from "@/lib/supabase/admin";
```

Add this function after `createAssessment`:

```ts
/**
 * Igual que `createAssessment`, pero para el flujo de link público sin
 * sesión: usa el cliente service-role, sin `created_by` (nadie del personal
 * lo administró) y registrando `link_id` para trazabilidad.
 */
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

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/db/assessments.ts
git commit -m "feat(assessments): createAssessmentViaLink para el flujo de link público"
```

---

### Task 11: Email template for patient links

**Files:**
- Modify: `lib/email/templates.ts`

- [ ] **Step 1: Add `buildPatientLinkEmail`**

Append to `lib/email/templates.ts`:

```ts
export function buildPatientLinkEmail(input: {
  to: string;
  patientName: string;
  clinicName: string;
  url: string;
  purpose: "consent" | "assessment";
}): EmailMessage {
  const isConsent = input.purpose === "consent";
  const subject = isConsent
    ? "Firma tu consentimiento informado"
    : "Completa tu cuestionario de seguimiento";
  const actionLabel = isConsent ? "Firmar consentimiento" : "Responder cuestionario";
  const intro = isConsent
    ? "tu profesional de salud mental te pide firmar el consentimiento informado antes de tu próxima sesión."
    : "tu profesional de salud mental te pide completar un breve cuestionario de seguimiento.";
  const text = `Hola ${input.patientName}, ${intro} Abre este enlace para continuar: ${input.url} (válido por 7 días).`;
  return {
    to: input.to,
    subject,
    text,
    html: wrap(
      subject,
      `<p>Hola <strong>${input.patientName}</strong>,</p>
       <p>De parte de <strong>${input.clinicName}</strong>: ${intro}</p>
       <p style="margin:20px 0">
         <a href="${input.url}" style="background:#635bff;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">
           ${actionLabel}
         </a>
       </p>
       <p style="font-size:13px;color:#5b6b7c">Este enlace es personal y vence en 7 días. Si no esperabas este correo, puedes ignorarlo.</p>`,
    ),
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/email/templates.ts
git commit -m "feat(email): plantilla de correo para links de consentimiento/escalas"
```

---

### Task 12: Staff-side server actions to generate + send a link

**Files:**
- Create: `app/(app)/patients/[id]/actions.ts`

- [ ] **Step 1: Write the actions**

```ts
"use server";

import { requireUser } from "@/lib/auth";
import { getPatient } from "@/lib/db/patients";
import { createPatientLink } from "@/lib/db/patient-links";
import { buildPatientLinkUrl } from "@/lib/patient-links";
import { getEmailProvider } from "@/lib/email/providers";
import { buildPatientLinkEmail } from "@/lib/email/templates";
import { recordNotification } from "@/lib/db/notifications";
import { logAudit } from "@/lib/db/audit";
import { logger } from "@/lib/logger";
import type { AssessmentType } from "@/lib/psychometrics";
import type { PatientLinkPurpose } from "@/lib/db/patient-links";

export type GenerateLinkResult = { ok: true; url: string } | { ok: false; error: string };

async function generateAndSendLink(
  patientId: string,
  purpose: PatientLinkPurpose,
  assessmentType: AssessmentType | null,
): Promise<GenerateLinkResult> {
  const user = await requireUser();
  const patient = await getPatient(patientId);
  if (!patient) return { ok: false, error: "Paciente no encontrado." };
  if (!patient.email) return { ok: false, error: "El paciente no tiene correo registrado." };

  try {
    const { link, token } = await createPatientLink(user.clinicId, user.id, {
      patientId,
      purpose,
      assessmentType,
    });
    const url = buildPatientLinkUrl(token);

    const email = getEmailProvider();
    await email.send(
      buildPatientLinkEmail({
        to: patient.email,
        patientName: patient.fullName,
        clinicName: user.clinicName,
        url,
        purpose,
      }),
    );

    await recordNotification(user.clinicId, {
      patientId,
      channel: "email",
      type: purpose === "consent" ? "consent_link_sent" : "assessment_link_sent",
      status: "sent",
      payload: { linkId: link.id },
    });
    await logAudit({
      clinicId: user.clinicId,
      actorId: user.id,
      action: "patient_link.created",
      entityType: "patient_link",
      entityId: link.id,
      metadata: { purpose, assessmentType, patientId },
    });

    return { ok: true, url };
  } catch (error) {
    logger.error("patient_link.generate_failed", {
      clinicId: user.clinicId,
      patientId,
      purpose,
      error,
    });
    return { ok: false, error: "No se pudo generar el link. Intenta de nuevo." };
  }
}

export async function generateConsentLinkAction(patientId: string): Promise<GenerateLinkResult> {
  return generateAndSendLink(patientId, "consent", null);
}

export async function generateAssessmentLinkAction(
  patientId: string,
  type: AssessmentType,
): Promise<GenerateLinkResult> {
  return generateAndSendLink(patientId, "assessment", type);
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "app/(app)/patients/[id]/actions.ts"
git commit -m "feat(patients): server actions para generar y enviar links de paciente"
```

---

### Task 13: `GeneratePatientLinkButton` component

**Files:**
- Create: `components/generate-patient-link-button.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useState, useTransition } from "react";
import { Link2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { GenerateLinkResult } from "@/app/(app)/patients/[id]/actions";

export function GeneratePatientLinkButton({
  action,
  label,
}: {
  action: () => Promise<GenerateLinkResult>;
  label: string;
}) {
  const [pending, startTransition] = useTransition();
  const [url, setUrl] = useState<string | null>(null);

  function handleClick() {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        setUrl(result.url);
        toast.success("Link generado y enviado al correo del paciente.");
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" size="sm" onClick={handleClick} disabled={pending}>
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />}
        {label}
      </Button>
      {url && (
        <p className="break-all rounded-lg bg-cloud px-3 py-2 text-xs text-muted-foreground">
          Enviado: {url}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/generate-patient-link-button.tsx
git commit -m "feat(ui): botón para generar y enviar links de paciente"
```

---

### Task 14: Wire the buttons into the patient detail page

**Files:**
- Modify: `app/(app)/patients/[id]/page.tsx`

- [ ] **Step 1: Add imports**

At the top of `app/(app)/patients/[id]/page.tsx`, add:

```tsx
import { GeneratePatientLinkButton } from "@/components/generate-patient-link-button";
import { generateConsentLinkAction, generateAssessmentLinkAction } from "./actions";
```

- [ ] **Step 2: Add the assessment link button**

In the "Escalas psicométricas" section, inside the `latestByType.map(({ type, latest }) => (...))` block, right after the existing `<Link href={\`/patients/${id}/assessments/new?type=${type}\`} ...>Aplicar ...</Link>` and before the closing `</div>` of that card (around line 185), add:

```tsx
              <div className="mt-2">
                <GeneratePatientLinkButton
                  action={generateAssessmentLinkAction.bind(null, id, type)}
                  label={`Generar link de ${ASSESSMENT_LABEL[type].split(" ")[0]}`}
                />
              </div>
```

So the block becomes:

```tsx
              <Link
                href={`/patients/${id}/assessments/new?type=${type}`}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-3")}
              >
                Aplicar {ASSESSMENT_LABEL[type].split(" ")[0]}
              </Link>
              <div className="mt-2">
                <GeneratePatientLinkButton
                  action={generateAssessmentLinkAction.bind(null, id, type)}
                  label={`Generar link de ${ASSESSMENT_LABEL[type].split(" ")[0]}`}
                />
              </div>
```

- [ ] **Step 3: Add the consent link button**

In the "Consentimiento informado" section, inside the `{consent ? (...) : (...)}` block's `else` branch (the "Pendiente" state, around lines 223-233), add the button next to "Capturar consentimiento":

```tsx
        ) : (
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Requerido antes de iniciar una consulta.
            </p>
            <div className="flex items-center gap-3">
              <GeneratePatientLinkButton
                action={generateConsentLinkAction.bind(null, id)}
                label="Generar link de consentimiento"
              />
              <Link
                href={`/patients/${id}/consent`}
                className={cn(buttonVariants({ size: "sm" }))}
              >
                Capturar consentimiento
              </Link>
            </div>
          </div>
        )}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Run `npm run dev`, log in, open any patient without a signed consent, and confirm both "Generar link de consentimiento" and "Generar link de PHQ-9"/"Generar link de GAD-7" buttons render and are clickable (full send flow is verified end-to-end in Task 18, once the public route exists).

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/patients/[id]/page.tsx"
git commit -m "feat(patients): botones para generar links de consentimiento y escalas"
```

---

### Task 15: Allow the new public routes in `proxy.ts`

**Files:**
- Modify: `proxy.ts:19-21`

**This step is mandatory before Task 17 — without it, `/enlace/*` and `/seguridad` will redirect anonymous visitors to `/login`, breaking both features.**

- [ ] **Step 1: Update `PUBLIC_PATHS` and `PUBLIC_PREFIXES`**

Change:

```ts
// Rutas accesibles SIN sesión.
const PUBLIC_PATHS = new Set(["/", "/login", "/signup"]);
// Prefijos públicos (flujos de auth: confirm, set-password, auth-code-error…).
const PUBLIC_PREFIXES = ["/auth"];
```

to:

```ts
// Rutas accesibles SIN sesión.
const PUBLIC_PATHS = new Set(["/", "/login", "/signup", "/seguridad"]);
// Prefijos públicos (flujos de auth: confirm, set-password, auth-code-error…;
// /enlace: links de paciente con token, ver app/enlace/[token]).
const PUBLIC_PREFIXES = ["/auth", "/enlace"];
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add proxy.ts
git commit -m "feat(proxy): permitir acceso público a /enlace/* y /seguridad"
```

---

### Task 16: Public submit actions (`app/enlace/[token]/actions.ts`)

**Files:**
- Create: `app/enlace/[token]/actions.ts`

- [ ] **Step 1: Write the actions**

```ts
"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPatientLinkByToken, markPatientLinkCompleted } from "@/lib/db/patient-links";
import { createConsentViaLink } from "@/lib/db/consents";
import { createAssessmentViaLink } from "@/lib/db/assessments";
import { CONSENT_VERSION, CONSENT_HASH } from "@/lib/consent";
import { scoreAssessment, questionsFor, type AssessmentType } from "@/lib/psychometrics";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { logAuditPublic } from "@/lib/db/audit";
import { logger } from "@/lib/logger";
import type { ConsentState } from "@/app/(app)/patients/[id]/consent/actions";

export async function submitPublicConsentAction(
  token: string,
  _prev: ConsentState,
  formData: FormData,
): Promise<ConsentState> {
  const ip = await getClientIp();
  const rateOk = await checkRateLimit(`patient_link:${ip}`, 20, 3600);
  if (!rateOk) return { error: "Demasiados intentos. Espera unos minutos e intenta de nuevo." };

  const lookup = await getPatientLinkByToken(token);
  if (lookup.status !== "valid" || lookup.link.purpose !== "consent") {
    return { error: "Este enlace ya no es válido. Solicita uno nuevo a tu clínica." };
  }
  const { link } = lookup;

  const signerName = String(formData.get("signerName") ?? "").trim();
  const signature = String(formData.get("signature") ?? "");
  const accepted = formData.get("accepted") === "on";
  const isMinor = formData.get("isMinor") === "on";
  const representativeDocument = String(formData.get("representativeDocument") ?? "").trim();
  const representativeRelationship = String(formData.get("representativeRelationship") ?? "").trim();

  const fieldErrors: Record<string, string> = {};
  if (signerName.length < 3) fieldErrors.signerName = "Ingresa el nombre completo de quien firma";
  if (!signature.startsWith("data:image/png")) fieldErrors.signature = "Falta la firma";
  if (!accepted) fieldErrors.accepted = "Debes aceptar el consentimiento";
  if (isMinor && representativeDocument.length < 5) {
    fieldErrors.representativeDocument = "Ingresa el documento del representante legal";
  }
  if (isMinor && !representativeRelationship) {
    fieldErrors.representativeRelationship = "Indica el parentesco del representante legal";
  }
  if (Object.keys(fieldErrors).length) return { fieldErrors };

  const h = await headers();
  const requestIp =
    (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "").trim() || null;
  const userAgent = h.get("user-agent");

  try {
    const admin = createAdminClient();
    const bytes = Buffer.from(signature.split(",")[1], "base64");
    const path = `${link.clinicId}/${link.patientId}-${Date.now()}.png`;
    const { error: upErr } = await admin.storage
      .from("signatures")
      .upload(path, bytes, { contentType: "image/png", upsert: false });
    if (upErr) throw upErr;

    const consent = await createConsentViaLink({
      clinicId: link.clinicId,
      patientId: link.patientId,
      linkId: link.id,
      documentVersion: CONSENT_VERSION,
      documentHash: CONSENT_HASH,
      signaturePath: path,
      signerName,
      ip: requestIp,
      userAgent,
      isMinor,
      representativeDocument: isMinor ? representativeDocument : null,
      representativeRelationship: isMinor ? representativeRelationship : null,
    });
    await markPatientLinkCompleted(link.id);
    await logAuditPublic({
      clinicId: link.clinicId,
      action: "consent.signed_via_link",
      entityType: "consent",
      entityId: consent.id,
      metadata: { patientId: link.patientId, linkId: link.id },
    });
  } catch (error) {
    logger.error("consent.sign_via_link_failed", {
      clinicId: link.clinicId,
      patientId: link.patientId,
      error,
    });
    return { error: "No se pudo registrar el consentimiento. Intenta de nuevo." };
  }

  redirect(`/enlace/${token}/gracias`);
}

export async function submitPublicAssessmentAction(token: string, formData: FormData): Promise<void> {
  const ip = await getClientIp();
  const rateOk = await checkRateLimit(`patient_link:${ip}`, 20, 3600);
  if (!rateOk) redirect(`/enlace/${token}`);

  const lookup = await getPatientLinkByToken(token);
  if (lookup.status !== "valid" || lookup.link.purpose !== "assessment" || !lookup.link.assessmentType) {
    redirect(`/enlace/${token}`);
  }
  const { link } = lookup;
  const type = link.assessmentType as AssessmentType;
  const count = questionsFor(type).length;
  const answers: number[] = [];
  for (let i = 0; i < count; i++) {
    answers.push(Number(formData.get(`q${i}`)));
  }
  const result = scoreAssessment(type, answers);

  const assessment = await createAssessmentViaLink(link.clinicId, {
    patientId: link.patientId,
    type,
    result,
    linkId: link.id,
  });
  await markPatientLinkCompleted(link.id);
  await logAuditPublic({
    clinicId: link.clinicId,
    action: "assessment.created_via_link",
    entityType: "psychometric_assessment",
    entityId: assessment.id,
    metadata: { type, totalScore: result.totalScore, linkId: link.id, patientId: link.patientId },
  });

  redirect(`/enlace/${token}/gracias`);
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "app/enlace/[token]/actions.ts"
git commit -m "feat(enlace): server actions públicas para firmar consentimiento y responder escalas"
```

---

### Task 17: Public page (`app/enlace/[token]/page.tsx`) and thank-you page

**Files:**
- Create: `app/enlace/[token]/page.tsx`
- Create: `app/enlace/[token]/gracias/page.tsx`

- [ ] **Step 1: Write the thank-you page**

```tsx
export default function PatientLinkThanksPage() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="font-heading text-xl font-bold text-navy">¡Gracias!</h1>
      <p className="text-sm text-muted-foreground">
        Tu información se registró correctamente. Ya puedes cerrar esta ventana.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Write the main link page**

```tsx
import { notFound } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { getPatientLinkByToken } from "@/lib/db/patient-links";
import { getPatientForLink } from "@/lib/db/patients";
import { CONSENT_TEXT, CONSENT_VERSION, isMinorByBirthDate } from "@/lib/consent";
import { questionsFor, RESPONSE_OPTIONS, ASSESSMENT_LABEL, type AssessmentType } from "@/lib/psychometrics";
import { ConsentForm } from "@/components/consent-form";
import { Button } from "@/components/ui/button";
import { submitPublicConsentAction, submitPublicAssessmentAction } from "./actions";

export default async function PatientLinkPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const lookup = await getPatientLinkByToken(token);

  if (lookup.status !== "valid") {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="font-heading text-xl font-bold text-navy">
          {lookup.status === "completed" ? "Este enlace ya fue utilizado" : "Este enlace ya no es válido"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {lookup.status === "completed"
            ? "Ya se registró tu respuesta. Si necesitas hacer cambios, solicita un nuevo enlace a tu clínica."
            : "Este enlace expiró o no existe. Solicita uno nuevo a tu clínica."}
        </p>
      </div>
    );
  }

  const { link } = lookup;
  const patient = await getPatientForLink(link.patientId);
  if (!patient) notFound();

  if (link.purpose === "consent") {
    const action = submitPublicConsentAction.bind(null, token);
    return (
      <div className="mx-auto max-w-2xl space-y-6 px-6 py-10">
        <div>
          <h1 className="font-heading text-2xl font-bold text-navy">Consentimiento informado</h1>
          <p className="text-sm text-muted-foreground">
            Paciente: {patient.fullName} · Versión {CONSENT_VERSION}
          </p>
        </div>
        <div className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-2xl border border-gray-line bg-card p-5 text-sm leading-relaxed text-foreground/90">
          {CONSENT_TEXT}
        </div>
        <div className="rounded-2xl border border-gray-line bg-card p-6">
          <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="size-4 text-mint" />
            La firma se almacena con hash del documento, IP y fecha como prueba legal (Ley 527).
          </div>
          <ConsentForm
            action={action}
            defaultSignerName={patient.fullName}
            isMinorByBirthDate={isMinorByBirthDate(patient.birthDate)}
          />
        </div>
      </div>
    );
  }

  const assessmentType = link.assessmentType as AssessmentType;
  const questions = questionsFor(assessmentType);
  const action = submitPublicAssessmentAction.bind(null, token);
  return (
    <div className="mx-auto max-w-2xl space-y-6 px-6 py-10">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy">{ASSESSMENT_LABEL[assessmentType]}</h1>
        <p className="text-sm text-muted-foreground">
          Hola {patient.fullName}. Durante las últimas 2 semanas, ¿con qué frecuencia le han
          molestado los siguientes problemas?
        </p>
      </div>
      <form action={action} className="space-y-6">
        {questions.map((q, i) => (
          <fieldset key={i} className="rounded-2xl border border-gray-line bg-card p-5">
            <legend className="mb-3 text-sm font-medium text-navy">
              {i + 1}. {q}
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {RESPONSE_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className="flex items-center gap-2 rounded-lg border border-gray-line px-3 py-2 text-sm has-[:checked]:border-purple has-[:checked]:bg-purple/5"
                >
                  <input type="radio" name={`q${i}`} value={opt.value} required className="accent-purple" />
                  {opt.label}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <Button type="submit" size="lg" className="w-full">
          Guardar respuestas
        </Button>
      </form>
    </div>
  );
}
```

Note: `ConsentForm`'s "Cancelar" button calls `router.back()`, which has no meaningful destination on a public magic-link page reached from email (no app history). This is a pre-existing component reused as-is; it's a harmless no-op in the worst case, not a data or security issue, so it's left unchanged rather than forking the component.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Manual verification (no session)**

Run `npm run dev`. Generate a consent link for a test patient from the UI (Task 14's button), copy the printed URL from the server logs (email provider defaults to log mode), open it in an incognito window, and confirm the consent form renders without needing to log in. Submit it and confirm you land on "¡Gracias!". Reload the same link and confirm it now shows "Este enlace ya fue utilizado".

- [ ] **Step 5: Commit**

```bash
git add "app/enlace"
git commit -m "feat(enlace): página pública de link de paciente (consentimiento y escalas)"
```

---

### Task 18: End-to-end test for the consent link flow

**Files:**
- Create: `tests/e2e/patient-link-consent.spec.ts`

This mirrors `tests/e2e/consent.spec.ts` but drives the public, session-less flow: sign up as staff, create a patient, generate a consent link, read the email from Mailpit, open the link in a **fresh incognito browser context** (no cookies), and complete it there.

- [ ] **Step 1: Write the test**

```ts
import { test, expect } from "@playwright/test";
import { signUpAndActivate } from "./helpers/signup";

const MAILPIT_URL = "http://127.0.0.1:54324";

async function getLatestLinkUrl(toEmail: string): Promise<string> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const searchRes = await fetch(
      `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${toEmail}`)}`,
    );
    const search = await searchRes.json();
    const messageId = search.messages?.[0]?.ID;
    if (messageId) {
      const msgRes = await fetch(`${MAILPIT_URL}/api/v1/message/${messageId}`);
      const msg = await msgRes.json();
      const match = /(https?:\/\/\S*\/enlace\/\S+)/.exec(msg.Text ?? "");
      if (match) return match[1].replace(/[).,]+$/, "");
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`No llegó el correo con link a ${toEmail}`);
}

test("link de consentimiento: generar, abrir sin sesión, firmar", async ({ page, browser }) => {
  const staffEmail = `linkstaff_${Date.now()}@e-irene.test`;
  const patientEmail = `linkpatient_${Date.now()}@e-irene.test`;

  await signUpAndActivate(page, { clinicName: "Clínica Links", fullName: "Dra. Links", email: staffEmail });

  await page.goto("/patients/new");
  await page.fill("#fullName", "Mateo Ríos");
  await page.fill("#email", patientEmail);
  await page.getByRole("button", { name: /crear paciente/i }).click();
  await expect(page.getByRole("heading", { name: "Mateo Ríos" })).toBeVisible();
  const patientUrl = page.url();

  await page.getByRole("button", { name: /generar link de consentimiento/i }).click();
  await expect(page.getByText(/link generado y enviado/i)).toBeVisible();

  const linkUrl = await getLatestLinkUrl(patientEmail);
  const relativeUrl = new URL(linkUrl).pathname;

  // Contexto de navegador nuevo, sin cookies de la sesión del personal: simula
  // que el paciente abre el correo en su propio dispositivo.
  const patientContext = await browser.newContext();
  const patientPage = await patientContext.newPage();
  await patientPage.goto(relativeUrl);
  await expect(patientPage.getByRole("heading", { name: "Consentimiento informado" })).toBeVisible();
  await expect(patientPage.getByText("Mateo Ríos")).toBeVisible();

  const canvas = patientPage.locator("canvas");
  await canvas.evaluate((el: HTMLCanvasElement) => {
    const r = el.getBoundingClientRect();
    const fire = (type: string, x: number, y: number) =>
      el.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          clientX: r.left + x,
          clientY: r.top + y,
        }),
      );
    fire("pointerdown", 60, 80);
    fire("pointermove", 200, 120);
    fire("pointerup", 200, 120);
  });
  await patientPage.check('input[name="accepted"]');
  await patientPage.getByRole("button", { name: /firmar consentimiento/i }).click();

  await expect(patientPage).toHaveURL(/\/enlace\/.+\/gracias$/);
  await expect(patientPage.getByText("¡Gracias!")).toBeVisible();

  // Reabrir el mismo link: ya debe mostrarse como usado.
  await patientPage.goto(relativeUrl);
  await expect(patientPage.getByText(/este enlace ya fue utilizado/i)).toBeVisible();
  await patientContext.close();

  // La ficha del paciente (personal, sesión original) ya muestra "Firmado".
  await page.goto(patientUrl);
  await expect(page.getByText("Firmado", { exact: true })).toBeVisible();
});
```

- [ ] **Step 2: Run the test**

Run: `npx playwright test tests/e2e/patient-link-consent.spec.ts`
Expected: PASS. (Requires local Supabase + Mailpit running, same as the rest of the e2e suite — check `README.md` or `package.json` for the local dev setup command if `npm run dev` alone doesn't have Supabase running.)

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/patient-link-consent.spec.ts
git commit -m "test(e2e): flujo de link de consentimiento sin sesión"
```

---

### Task 19: Remove transcript page from the PDF

**Files:**
- Modify: `lib/pdf/report-pdf.tsx`
- Modify: `app/(app)/consultations/[id]/pdf/route.ts`

- [ ] **Step 1: Read the current transcript block**

Run: `grep -n "transcript" "lib/pdf/report-pdf.tsx"`
Confirm the conditional `<Page>` block (around lines 262-277) and the `transcript` field in the data type, matching what's described in the design spec.

- [ ] **Step 2: Remove the transcript page from `ReportDocument`**

In `lib/pdf/report-pdf.tsx`, delete the whole conditional block that renders the second page:

```tsx
{transcript && (
  <Page size="A4" style={styles.page}>
    <View style={styles.brandBar} />
    <Text style={styles.sectionTitle}>Transcripción completa</Text>
    {transcript.split("\n").map((line, i) => {
      const [speaker, ...rest] = line.split(": ");
      return (
        <Text key={i} style={styles.transcriptLine}>
          <Text style={styles.speaker}>{speaker}: </Text>
          {rest.join(": ")}
        </Text>
      );
    })}
  </Page>
)}
```

Then remove `transcript` from the destructured props/data type of `ReportDocument` (search for `transcript` in the file and remove the field from the props interface and from the destructuring at the top of the component — keep every other field as-is).

- [ ] **Step 3: Update the PDF route**

In `app/(app)/consultations/[id]/pdf/route.ts`, change:

```ts
import { getConsultation, getTranscript } from "@/lib/db/consultations";
```

to:

```ts
import { getConsultation } from "@/lib/db/consultations";
```

Change:

```ts
  const [consultation, report, transcript, soapNote] = await Promise.all([
    getConsultation(id),
    getReportByConsultation(id),
    getTranscript(id),
    getSoapNoteByConsultation(id),
  ]);
```

to:

```ts
  const [consultation, report, soapNote] = await Promise.all([
    getConsultation(id),
    getReportByConsultation(id),
    getSoapNoteByConsultation(id),
  ]);
```

Remove the `transcript,` line from the object passed to `renderReportPdf({...})`.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors (this will surface if `transcript` is still referenced anywhere in `report-pdf.tsx`).

- [ ] **Step 5: Manual verification**

Run `npm run dev`, open any consultation with a transcript, download/view its PDF (`/consultations/[id]/pdf`), and confirm it no longer has a "Transcripción completa" page while the rest of the report (summary, SOAP note, signature) is unchanged.

- [ ] **Step 6: Commit**

```bash
git add lib/pdf/report-pdf.tsx "app/(app)/consultations/[id]/pdf/route.ts"
git commit -m "fix(pdf): quitar la página de transcripción completa del reporte"
```

---

### Task 20: Migration — 30-day transcript retention via `pg_cron`

**Files:**
- Create: `supabase/migrations/0021_transcript_retention_cron.sql`

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================================
-- Retención de transcripción: 30 días después de terminada la consulta,
-- se elimina el texto de la transcripción (transcript_chunks + transcript_enc).
-- El resto de la historia clínica (reportes, notas SOAP) no se toca.
-- ============================================================================

create extension if not exists pg_cron;

create or replace function purge_expired_transcripts() returns void
language plpgsql security definer as $$
begin
  delete from transcript_chunks
  where consultation_id in (
    select id from consultations
    where ended_at is not null
      and ended_at < now() - interval '30 days'
      and transcript_enc is not null
  );

  update consultations
  set transcript_enc = null
  where ended_at is not null
    and ended_at < now() - interval '30 days'
    and transcript_enc is not null;
end;
$$;

select cron.schedule(
  'purge-expired-transcripts',
  '0 3 * * *',
  'select purge_expired_transcripts()'
);
```

- [ ] **Step 2: Apply the migration via Supabase MCP**

Use the `apply_migration` MCP tool with `project_id: "sljxoqwrnmybivccnsck"`, `name: "transcript_retention_cron"`, and the SQL above as `query`.

- [ ] **Step 3: Verify the cron job is scheduled**

Use the `execute_sql` MCP tool with `project_id: "sljxoqwrnmybivccnsck"` and query:

```sql
select jobname, schedule, active from cron.job where jobname = 'purge-expired-transcripts';
```

Expected: one row, `active = true`, `schedule = '0 3 * * *'`.

- [ ] **Step 4: Verify the function works on a test row**

Use `execute_sql` with `project_id: "sljxoqwrnmybivccnsck"`:

```sql
-- Prepara un caso de prueba: una consulta ficticia terminada hace 31 días.
do $$
declare
  test_clinic uuid;
  test_patient uuid;
  test_doctor uuid;
  test_consultation uuid;
begin
  select id into test_clinic from clinics limit 1;
  select id into test_patient from patients where clinic_id = test_clinic limit 1;
  select id into test_doctor from users where clinic_id = test_clinic limit 1;
  if test_clinic is null or test_patient is null or test_doctor is null then
    raise notice 'No hay datos de prueba suficientes; omite esta verificación manual.';
    return;
  end if;
  insert into consultations (clinic_id, patient_id, doctor_id, status, transcript_enc, started_at, ended_at)
  values (test_clinic, test_patient, test_doctor, 'analyzed', 'fake_enc_payload', now() - interval '32 days', now() - interval '31 days')
  returning id into test_consultation;
  insert into transcript_chunks (clinic_id, consultation_id, seq, speaker, text_enc)
  values (test_clinic, test_consultation, 1, 'doctor', 'fake_chunk');

  perform purge_expired_transcripts();

  raise notice 'transcript_enc after purge: %', (select transcript_enc from consultations where id = test_consultation);
  raise notice 'transcript_chunks remaining: %', (select count(*) from transcript_chunks where consultation_id = test_consultation);

  delete from consultations where id = test_consultation;
end $$;
```

Expected in the notices: `transcript_enc after purge: <NULL>` and `transcript_chunks remaining: 0`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0021_transcript_retention_cron.sql
git commit -m "feat(db): retención automática de transcripción a 30 días vía pg_cron"
```

---

### Task 21: Distinguish "purged" from "never had a transcript" in the UI

**Files:**
- Modify: `app/(app)/consultations/[id]/page.tsx`

The page already renders "Sin transcripción." when `transcript` is `null` — this already works correctly after a purge (no crash, no blank section). Make the message clearer when the consultation is old enough to have been purged.

- [ ] **Step 1: Update the transcript section**

Change:

```tsx
        {transcript ? (
          <div className="space-y-2 text-sm leading-relaxed">
            {transcript.split("\n").map((line, i) => {
              const [speaker, ...rest] = line.split(": ");
              return (
                <p key={i}>
                  <span className="font-medium text-purple">{speaker}:</span>{" "}
                  <span className="text-foreground/90">{rest.join(": ")}</span>
                </p>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Sin transcripción.</p>
        )}
```

to:

```tsx
        {transcript ? (
          <div className="space-y-2 text-sm leading-relaxed">
            {transcript.split("\n").map((line, i) => {
              const [speaker, ...rest] = line.split(": ");
              return (
                <p key={i}>
                  <span className="font-medium text-purple">{speaker}:</span>{" "}
                  <span className="text-foreground/90">{rest.join(": ")}</span>
                </p>
              );
            })}
          </div>
        ) : consultation.endedAt &&
          Date.now() - new Date(consultation.endedAt).getTime() > 30 * 24 * 60 * 60 * 1000 ? (
          <p className="text-sm text-muted-foreground">
            Esta transcripción ya no está disponible: se elimina automáticamente 30 días después
            de terminada la consulta.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Sin transcripción.</p>
        )}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "app/(app)/consultations/[id]/page.tsx"
git commit -m "fix(consultations): distinguir transcripción purgada de nunca-existente"
```

---

### Task 22: Public security summary page

**Files:**
- Create: `app/seguridad/page.tsx`
- Modify: `app/page.tsx` (footer link)

- [ ] **Step 1: Write the page**

```tsx
import Link from "next/link";
import { Activity, Lock, Users, FileSignature, ScrollText, Trash2, LifeBuoy } from "lucide-react";

const sections = [
  {
    icon: Lock,
    title: "Cifrado de tus datos",
    body: "Toda la información sensible (datos de pacientes, transcripciones, notas clínicas) se cifra con AES-256-GCM antes de guardarse, y viaja siempre por conexiones cifradas (TLS). El audio de las sesiones nunca se almacena — solo el texto transcrito, cifrado.",
  },
  {
    icon: Users,
    title: "Aislamiento por clínica",
    body: "Cada clínica solo puede ver y modificar sus propios datos. Esto se aplica a nivel de base de datos (row-level security), no solo en la interfaz — ni siquiera un error de programación en la aplicación podría exponer datos de una clínica a otra.",
  },
  {
    icon: FileSignature,
    title: "Consentimiento informado digital",
    body: "El consentimiento del paciente se firma digitalmente y queda protegido con un hash del documento, la fecha, IP y dispositivo — evidencia con validez legal según la Ley 527 de 1999.",
  },
  {
    icon: ScrollText,
    title: "Cumplimiento legal colombiano",
    body: "La plataforma está construida sobre los requisitos de la Ley 1581 de 2012 (Habeas Data, tratamiento de datos sensibles de salud), la Ley 2015 de 2020 y el Decreto 580 de 2024 (historia clínica electrónica) y la Resolución 1995 de 1999 (reserva y trazabilidad de la historia clínica).",
  },
  {
    icon: Trash2,
    title: "Retención y eliminación de datos",
    body: "Las transcripciones completas de las sesiones se eliminan automáticamente 30 días después de finalizada la consulta. El resumen clínico, las notas y el reporte firmado por el profesional permanecen como parte de la historia clínica.",
  },
  {
    icon: LifeBuoy,
    title: "¿Encontraste un problema de seguridad?",
    body: "Escríbenos a seguridad@e-irene.co con el detalle de lo que encontraste. Respondemos y priorizamos cualquier reporte de seguridad de buena fe.",
  },
];

export default function SecurityPage() {
  return (
    <main className="flex-1">
      <header className="sticky top-0 z-10 border-b border-gray-line bg-cloud/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2 font-heading text-lg font-bold text-navy">
            <span className="grid size-8 place-items-center rounded-lg bg-navy text-white">
              <Activity className="size-4 text-mint" />
            </span>
            E-Irene
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="font-heading text-3xl font-bold text-navy">Seguridad y cumplimiento</h1>
        <p className="mt-3 text-muted-foreground">
          Resumen en lenguaje claro de cómo protegemos los datos clínicos en E-Irene. No reemplaza
          un contrato ni una certificación formal — describe los controles técnicos que la
          plataforma ya implementa hoy.
        </p>

        <div className="mt-10 space-y-8">
          {sections.map((s) => (
            <div key={s.title} className="flex gap-4">
              <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-cloud">
                <s.icon className="size-5 text-purple" />
              </div>
              <div>
                <h2 className="font-heading font-semibold text-navy">{s.title}</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-gray-line bg-cloud">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-6 py-8 text-sm text-muted-foreground sm:flex-row">
          <span>© {new Date().getFullYear()} E-Irene. Plataforma clínica de salud mental.</span>
          <Link href="/" className="text-xs hover:text-navy">
            Volver al inicio
          </Link>
        </div>
      </footer>
    </main>
  );
}
```

- [ ] **Step 2: Link it from the landing page footer**

In `app/page.tsx`, change the footer:

```tsx
      {/* Footer */}
      <footer className="border-t border-gray-line bg-cloud">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-6 py-8 text-sm text-muted-foreground sm:flex-row">
          <span>© {new Date().getFullYear()} E-Irene. Plataforma clínica de salud mental.</span>
          <span className="text-xs">
            Las sugerencias de IA no constituyen diagnóstico médico.
          </span>
        </div>
      </footer>
```

to:

```tsx
      {/* Footer */}
      <footer className="border-t border-gray-line bg-cloud">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-6 py-8 text-sm text-muted-foreground sm:flex-row">
          <span>© {new Date().getFullYear()} E-Irene. Plataforma clínica de salud mental.</span>
          <div className="flex items-center gap-4 text-xs">
            <Link href="/seguridad" className="hover:text-navy">
              Seguridad y cumplimiento
            </Link>
            <span>Las sugerencias de IA no constituyen diagnóstico médico.</span>
          </div>
        </div>
      </footer>
```

(`Link` is already imported at the top of `app/page.tsx`.)

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Run `npm run dev`, open `/` logged out, click "Seguridad y cumplimiento" in the footer, confirm `/seguridad` renders without requiring login (this depends on Task 15 already being applied).

- [ ] **Step 5: Share the draft for review before treating this as final**

This page's content is a plain-language summary of `docs/COMPLIANCE.md`. Point the user at the rendered `/seguridad` page (or paste the section text) and confirm the wording is accurate and nothing overstates what's implemented, before considering this task fully done.

- [ ] **Step 6: Commit**

```bash
git add app/seguridad app/page.tsx
git commit -m "feat(seguridad): página pública de resumen de seguridad y cumplimiento"
```

---

### Task 23: Data fix — correct role for henrygarzon089@gmail.com

**Files:** none (data-only change, confirmed with the user)

- [ ] **Step 1: Apply the fix**

Use the `execute_sql` MCP tool with `project_id: "sljxoqwrnmybivccnsck"`:

```sql
update users set role = 'doctor' where email = 'henrygarzon089@gmail.com';
```

- [ ] **Step 2: Verify**

Use `execute_sql` with `project_id: "sljxoqwrnmybivccnsck"`:

```sql
select email, role from users where email = 'henrygarzon089@gmail.com';
```

Expected: `role = 'doctor'`.

Note: this clinic ("Henry t") now has no user with `role = 'admin'`, so nobody can access Settings → Team for that clinic anymore. This was explicitly accepted by the user (test account).

---

## Final verification

- [ ] Run `npm run typecheck` — no errors.
- [ ] Run `npm test` — all unit tests pass (including the new `tests/patient-links.test.ts`).
- [ ] Run `npx playwright test` — full e2e suite passes, including `tests/e2e/patient-link-consent.spec.ts`.
- [ ] Run `npm run lint` — no new lint errors.
- [ ] Manually smoke-test: signup label, one button's press feel, a generated+opened consent link, a generated+opened assessment link, the PDF without a transcript page, `/seguridad` while logged out, and the corrected role showing "Profesional" in the user menu.

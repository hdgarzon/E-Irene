# E-Irene Plan 1 — Fundación + Auth/Multi-tenant + Pacientes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Levantar la base ejecutable de E-Irene: app Next.js 15 con design system de marca, Supabase (schema + RLS multi-tenant + cifrado), autenticación con roles, y CRUD de pacientes con PII cifrada — una rebanada vertical real que corre sin API keys externas.

**Architecture:** Monolito Next.js 15 (App Router) + Supabase (Postgres + Auth + RLS + Storage). Acceso a datos con `supabase-js` y tipos TS autogenerados (RLS aplicado por el JWT del usuario). Cifrado app-layer AES-256-GCM en columnas sensibles. Capa de proveedores (mock por defecto) lista para Deepgram/OpenAI en planes posteriores.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS 4, shadcn/ui, supabase-js, Zod, Vitest, Playwright.

---

## File Structure

```
e-irene/
├── app/                          # Next.js App Router
│   ├── (auth)/login|signup       # rutas públicas de auth
│   ├── (app)/                    # rutas protegidas (layout con sesión)
│   │   ├── layout.tsx            # app shell + guard de sesión
│   │   ├── dashboard/page.tsx
│   │   └── patients/             # lista, nuevo, [id] ficha
│   ├── layout.tsx                # root layout + fuentes + tokens
│   └── globals.css               # tokens de marca + Tailwind
├── lib/
│   ├── supabase/                 # clients (browser, server, middleware)
│   ├── crypto.ts                 # AES-256-GCM encrypt/decrypt
│   ├── providers/                # transcription + analysis interfaces (+ mocks)
│   ├── auth.ts                   # helpers de sesión/rol
│   └── db/                       # tipos generados + queries por dominio
├── components/ui/                # shadcn/ui
├── components/                   # componentes de dominio
├── supabase/
│   ├── migrations/               # SQL: schema, RLS, triggers
│   └── seed.sql
├── types/database.ts             # tipos autogenerados de Supabase
├── middleware.ts                 # refresh de sesión + guard
└── tests/                        # vitest + playwright
```

---

## Task 1: Scaffold del proyecto Next.js + Tailwind + git

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `.gitignore`, `.env.example`

- [ ] **Step 1:** Crear app con `create-next-app` (TS, Tailwind, App Router, ESLint, sin src dir, alias `@/*`).

Run: `npx create-next-app@latest . --ts --tailwind --app --eslint --no-src-dir --import-alias "@/*" --use-npm --yes`
Expected: proyecto generado, `npm run dev` levanta en :3000.

- [ ] **Step 2:** Inicializar git y primer commit.

```bash
git init && git add -A && git commit -m "chore: scaffold next.js app"
```

- [ ] **Step 3:** Crear `.env.example` con todas las variables del spec (sección 10), y añadir `.env.local` al `.gitignore` (verificar que ya esté).

- [ ] **Step 4:** Commit.

```bash
git add -A && git commit -m "chore: add env example"
```

---

## Task 2: Design system — tokens de marca + shadcn/ui

**Files:**
- Modify: `app/globals.css` (tokens), `tailwind.config` si aplica
- Create: `components/ui/*` (vía shadcn), `lib/utils.ts` (`cn`)

- [ ] **Step 1:** Inicializar shadcn/ui.

Run: `npx shadcn@latest init --yes` (base color neutral, CSS variables on)

- [ ] **Step 2:** En `app/globals.css`, definir los tokens de marca como CSS variables y mapearlos al theme de Tailwind 4 (`@theme`):

```css
@theme {
  --color-navy: #0A2540;
  --color-purple: #635BFF;
  --color-mint: #00D4AA;
  --color-coral: #FF6B6B;
  --color-cloud: #F6F9FC;
  --color-soft-mint: #96F7D6;
  --color-gray-line: #E3E8EE;
}
```

Mapear `--primary` → purple, `--destructive` → coral, fondos → cloud, bordes → gray-line.

- [ ] **Step 3:** Instalar componentes base: `npx shadcn@latest add button input label card dialog form table badge sonner avatar dropdown-menu`

- [ ] **Step 4:** Crear una página `/` simple que muestre botones/cards con los colores de marca para verificar visualmente. `npm run dev` y revisar.

- [ ] **Step 5:** Commit. `git add -A && git commit -m "feat: brand design system + shadcn/ui"`

---

## Task 3: Util de cifrado AES-256-GCM (TDD)

**Files:**
- Create: `lib/crypto.ts`, `tests/crypto.test.ts`
- Test: `tests/crypto.test.ts`

- [ ] **Step 1:** Instalar y configurar Vitest. `npm i -D vitest` + script `"test": "vitest"`. Crear `vitest.config.ts` con `environment: 'node'`.

- [ ] **Step 2:** Escribir test que falla:

```ts
import { describe, it, expect } from 'vitest'
import { encrypt, decrypt } from '@/lib/crypto'

describe('crypto', () => {
  const key = Buffer.from('a'.repeat(32)).toString('base64') // 32 bytes
  it('round-trips a string', () => {
    const ct = encrypt('Juan Pérez', key)
    expect(ct).not.toContain('Juan')
    expect(decrypt(ct, key)).toBe('Juan Pérez')
  })
  it('produces different ciphertext each call (random IV)', () => {
    expect(encrypt('x', key)).not.toBe(encrypt('x', key))
  })
  it('throws on tampered ciphertext', () => {
    const ct = encrypt('secreto', key)
    const bad = ct.slice(0, -2) + (ct.endsWith('AA') ? 'BB' : 'AA')
    expect(() => decrypt(bad, key)).toThrow()
  })
})
```

- [ ] **Step 3:** Run `npx vitest run tests/crypto.test.ts` → FAIL (módulo no existe).

- [ ] **Step 4:** Implementar `lib/crypto.ts` con `crypto` de Node (AES-256-GCM, IV aleatorio de 12 bytes, formato `base64(iv).base64(tag).base64(ciphertext)`):

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

function keyBuf(b64: string) {
  const k = Buffer.from(b64, 'base64')
  if (k.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes (base64)')
  return k
}
export function encrypt(plain: string, b64Key = process.env.ENCRYPTION_KEY!): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', keyBuf(b64Key), iv)
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return [iv, c.getAuthTag(), ct].map((b) => b.toString('base64')).join('.')
}
export function decrypt(payload: string, b64Key = process.env.ENCRYPTION_KEY!): string {
  const [iv, tag, ct] = payload.split('.').map((p) => Buffer.from(p, 'base64'))
  const d = createDecipheriv('aes-256-gcm', keyBuf(b64Key), iv)
  d.setAuthTag(tag)
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8')
}
```

- [ ] **Step 5:** Run `npx vitest run tests/crypto.test.ts` → PASS.

- [ ] **Step 6:** Commit. `git add -A && git commit -m "feat: AES-256-GCM crypto util with tests"`

---

## Task 4: Capa de proveedores (interfaces + mocks, TDD)

**Files:**
- Create: `lib/providers/types.ts`, `lib/providers/mock.ts`, `lib/providers/index.ts`, `tests/providers.test.ts`

- [ ] **Step 1:** Definir `types.ts` con `TranscriptionProvider`, `AnalysisProvider` y `ReportPayload` (Zod schema + tipo inferido):

```ts
import { z } from 'zod'
export const reportSchema = z.object({
  summary: z.string(),
  sentiment: z.object({ score: z.number().min(-1).max(1), label: z.string() }),
  keywords: z.array(z.object({ term: z.string(), weight: z.number() })),
  patterns: z.record(z.string(), z.number()),
  suggestion: z.string(),
})
export type ReportPayload = z.infer<typeof reportSchema>
export interface AnalysisProvider { analyze(transcript: string): Promise<ReportPayload> }
export interface TranscriptionProvider { createSession(consultationId: string): Promise<{ sessionToken: string; mode: 'mock' | 'deepgram' }> }
```

- [ ] **Step 2:** Escribir test que falla: `getAnalysisProvider()` sin `OPENAI_API_KEY` devuelve mock cuyo `analyze()` cumple `reportSchema`.

```ts
import { describe, it, expect } from 'vitest'
import { getAnalysisProvider } from '@/lib/providers'
import { reportSchema } from '@/lib/providers/types'
it('mock analysis satisfies schema', async () => {
  delete process.env.OPENAI_API_KEY
  const r = await getAnalysisProvider().analyze('Me siento ansioso por el trabajo.')
  expect(() => reportSchema.parse(r)).not.toThrow()
})
```

- [ ] **Step 3:** Run → FAIL.

- [ ] **Step 4:** Implementar `mock.ts` (genera un `ReportPayload` plausible a partir del texto: score por palabras clave, top keywords por frecuencia) e `index.ts` con la factory que elige por env (`OPENAI_API_KEY` → real en plan posterior; por ahora siempre mock).

- [ ] **Step 5:** Run → PASS. Commit. `git commit -am "feat: provider abstraction with mock providers"`

---

## Task 5: Migración SQL — schema + RLS + triggers

**Files:**
- Create: `supabase/migrations/0001_init.sql`, `supabase/seed.sql`

- [ ] **Step 1:** Instalar Supabase CLI local (`npx supabase init`) y arrancar stack local (`npx supabase start`) para iterar migraciones. (Si no hay Docker, usar proyecto Supabase remoto vía MCP `apply_migration`.)

- [ ] **Step 2:** Escribir `0001_init.sql` con las 12 tablas (sección 3 del spec), todas con `clinic_id uuid not null references clinics(id)`, PKs `uuid default gen_random_uuid()`, timestamps. Columnas sensibles como `text` (guardan ciphertext). Tabla `users` = perfil enlazado a `auth.users(id)` con `role` enum (`admin|doctor|secretaria|paciente`) y `clinic_id`.

- [ ] **Step 3:** Función helper `auth_clinic_id()` (SQL) que lee el `clinic_id` del perfil del usuario autenticado (`auth.uid()`), y `auth_role()`.

- [ ] **Step 4:** Activar RLS en todas las tablas + políticas: `SELECT/INSERT/UPDATE/DELETE` permitidos solo si `clinic_id = auth_clinic_id()`. Refinar por rol donde aplique (p.ej. `secretaria` no borra pacientes).

- [ ] **Step 5:** `audit_logs`: política solo `INSERT` + trigger:

```sql
create or replace function block_audit_mutation() returns trigger as $$
begin raise exception 'audit_logs is immutable'; end; $$ language plpgsql;
create trigger audit_no_update before update or delete on audit_logs
  for each row execute function block_audit_mutation();
```

- [ ] **Step 6:** Aplicar migración (`npx supabase db reset` local o `apply_migration` remoto). Verificar tablas creadas.

- [ ] **Step 7:** Commit. `git add -A && git commit -m "feat: db schema, RLS multi-tenant, immutable audit logs"`

---

## Task 6: Clientes Supabase + tipos generados + middleware de sesión

**Files:**
- Create: `lib/supabase/server.ts`, `lib/supabase/client.ts`, `lib/supabase/middleware.ts`, `middleware.ts`, `types/database.ts`

- [ ] **Step 1:** Instalar `@supabase/supabase-js` y `@supabase/ssr`.

- [ ] **Step 2:** Generar tipos: `npx supabase gen types typescript --local > types/database.ts` (o vía MCP `generate_typescript_types`).

- [ ] **Step 3:** Crear `client.ts` (browser client) y `server.ts` (server client con cookies de `next/headers`) usando `@supabase/ssr`, tipados con `Database`.

- [ ] **Step 4:** Crear `middleware.ts` que refresca la sesión en cada request (patrón oficial `@supabase/ssr`) y redirige a `/login` si no hay sesión en rutas `(app)`.

- [ ] **Step 5:** Verificar `npm run build` compila. Commit. `git commit -am "feat: supabase clients, generated types, session middleware"`

---

## Task 7: Auth — signup (crea clínica + admin), login, logout

**Files:**
- Create: `app/(auth)/login/page.tsx`, `app/(auth)/signup/page.tsx`, `app/(auth)/actions.ts`, `lib/auth.ts`
- Test: `tests/e2e/auth.spec.ts` (Playwright)

- [ ] **Step 1:** `lib/auth.ts`: `getSessionUser()` (perfil + rol + clinic_id) y `requireRole(roles)` para Server Components.

- [ ] **Step 2:** `actions.ts` (Server Actions): `signUp` crea usuario en Supabase Auth, **crea la clínica** y el perfil `users` con rol `admin` enlazado, en una transacción (RPC `create_clinic_and_admin`). `signIn`/`signOut`.

- [ ] **Step 3:** Crear la RPC `create_clinic_and_admin(clinic_name, user_id, full_name)` en una migración `0002_auth_rpc.sql` (SECURITY DEFINER, inserta clinic + users).

- [ ] **Step 4:** Páginas `login` y `signup` con `Form` de shadcn + validación Zod (email, password ≥ 8, nombre clínica).

- [ ] **Step 5:** Playwright E2E: signup → redirige a dashboard → logout → login. Run: `npx playwright test tests/e2e/auth.spec.ts`. Expected: PASS (con Supabase local).

- [ ] **Step 6:** Commit. `git commit -am "feat: auth signup/login with clinic+admin bootstrap"`

---

## Task 8: App shell protegido + dashboard + nav por rol

**Files:**
- Create: `app/(app)/layout.tsx`, `app/(app)/dashboard/page.tsx`, `components/app-sidebar.tsx`, `components/user-menu.tsx`

- [ ] **Step 1:** `(app)/layout.tsx`: server component que llama `getSessionUser()`; si no hay sesión → redirect `/login`. Renderiza sidebar + topbar + `{children}`.

- [ ] **Step 2:** `app-sidebar.tsx`: navegación con items filtrados por rol (admin/doctor ven Pacientes, Agenda; secretaria ve Agenda; etc.).

- [ ] **Step 3:** `dashboard/page.tsx`: tarjetas de resumen (n° pacientes, próximas citas) — consultas reales scoped por RLS.

- [ ] **Step 4:** Verificar navegación en dev. Commit. `git commit -am "feat: protected app shell, role-based nav, dashboard"`

---

## Task 9: Pacientes — capa de datos con cifrado (TDD)

**Files:**
- Create: `lib/db/patients.ts`, `tests/patients-db.test.ts`

- [ ] **Step 1:** Definir `Patient` (claro) y mapeadores `encryptPatient`/`decryptPatient` que cifran/descifran columnas sensibles (nombre, documento, teléfono, email, notas) con `lib/crypto`.

- [ ] **Step 2:** Test (unit, sin DB): `encryptPatient` deja `full_name_enc` ilegible y `decryptPatient(encryptPatient(p))` reconstruye `p`.

```ts
it('encrypts and restores patient PII', () => {
  process.env.ENCRYPTION_KEY = Buffer.from('a'.repeat(32)).toString('base64')
  const p = { fullName: 'Ana Gómez', document: 'CC123', phone: '300', email: 'a@x.co', notes: 'n' }
  const enc = encryptPatient(p)
  expect(enc.full_name_enc).not.toContain('Ana')
  expect(decryptPatient(enc)).toMatchObject(p)
})
```

- [ ] **Step 3:** Run → FAIL → implementar → PASS.

- [ ] **Step 4:** Funciones `listPatients()`, `getPatient(id)`, `createPatient(input)`, `updatePatient(id, input)` usando el server client (RLS). Descifran al leer, cifran al escribir. `clinic_id` se setea desde la sesión.

- [ ] **Step 5:** Commit. `git commit -am "feat: patients data layer with encrypted PII"`

---

## Task 10: Pacientes — UI (lista, crear, ficha)

**Files:**
- Create: `app/(app)/patients/page.tsx`, `app/(app)/patients/new/page.tsx`, `app/(app)/patients/[id]/page.tsx`, `app/(app)/patients/actions.ts`, `components/patient-form.tsx`
- Test: `tests/e2e/patients.spec.ts`

- [ ] **Step 1:** `patients/page.tsx`: tabla (shadcn `Table`) con pacientes de la clínica (datos descifrados server-side). Botón "Nuevo paciente".

- [ ] **Step 2:** `patient-form.tsx` + `actions.ts` (Server Action `createPatientAction` con validación Zod) para crear/editar.

- [ ] **Step 3:** `[id]/page.tsx`: ficha del paciente con sus datos y placeholder de "Consultas" (se llena en Plan 2).

- [ ] **Step 4:** Auditoría: cada create/update inserta en `audit_logs` (acción, actor, entity, timestamp).

- [ ] **Step 5:** Playwright E2E: login → crear paciente → aparece en lista → abrir ficha. Run y PASS.

- [ ] **Step 6:** Commit. `git commit -am "feat: patients UI (list, create, detail) + audit logging"`

---

## Task 11: Test de aislamiento multi-tenant (RLS)

**Files:**
- Create: `tests/rls.test.ts`

- [ ] **Step 1:** Test que crea 2 clínicas con 2 usuarios; el usuario A no puede leer pacientes de la clínica B (consulta con el JWT de A devuelve 0 filas). Usa supabase-js con sesiones reales contra Supabase local.

- [ ] **Step 2:** Run → debe PASS (valida que RLS aísla). Si falla, corregir políticas.

- [ ] **Step 3:** Commit. `git commit -am "test: multi-tenant RLS isolation"`

---

## Definition of Done (Plan 1)
- `npm run dev` levanta la app con design system de marca.
- Signup crea clínica + admin; login/logout funcionan; rutas protegidas.
- CRUD de pacientes con PII cifrada en DB; lista/ficha descifran server-side.
- RLS aísla datos entre clínicas (test verde).
- audit_logs inmutable y cableado en acciones de pacientes.
- Vitest (crypto, providers, patients) y Playwright (auth, patients) en verde.

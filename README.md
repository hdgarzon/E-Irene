# E-Irene

Plataforma clínica SaaS multi-tenant para profesionales de salud mental. Transcribe sesiones
en vivo, las analiza con IA y genera reportes clínicos, bajo cumplimiento legal colombiano
(Habeas Data, consentimiento digital, historia clínica electrónica).

> **Estado:** Fases 1-4 implementadas (modo demo, sin API keys requeridas).
> Ver [docs/superpowers/plans](docs/superpowers/plans) para el detalle de cada fase.

## Funcionalidades

- **Auth multi-tenant** con roles (admin/doctor/secretaría) y aislamiento RLS por clínica.
- **Pacientes** con PII cifrada (AES-256) · **Agenda** de citas con estados y recordatorios.
- **Consentimiento digital** (firma en canvas + hash + IP/UA).
- **Consulta con transcripción en vivo** (el audio nunca se almacena) → **análisis con IA**
  (sentimiento, nube de palabras, patrones, sugerencia editable) → **reporte PDF** de 8 secciones.
- **Historial comparativo** de la evolución del paciente entre sesiones.
- **Multi-clínica:** equipo, planes (Free/Pro/Clínica/Enterprise) con límites aplicados.
- **Recordatorios** por correo (Resend) o WhatsApp (Twilio) según el plan.
- **PWA** instalable con shell offline. Ver [docs/COMPLIANCE.md](docs/COMPLIANCE.md) para seguridad.

## Stack

- **Next.js 16** (App Router) + React 19 + TypeScript
- **Supabase** — Postgres + Auth + RLS (multi-tenant) + Storage + Realtime
- **Tailwind CSS 4** + shadcn/ui con tokens de marca
- **Zod** (validación) · **Vitest** (unit) · **Playwright** (E2E)
- Cifrado **AES-256-GCM** app-layer para PII y datos clínicos
- Capa de proveedores para transcripción (Deepgram) y análisis (OpenAI GPT-4o), con **mock**
  por defecto para correr sin API keys

## Requisitos

- Node 20+ y npm
- Docker (para Supabase local)
- Supabase CLI (`npx supabase`)

## Puesta en marcha

```bash
# 1. Dependencias
npm install

# 2. Levantar Supabase local (Postgres, Auth, Storage…) — requiere Docker
npx supabase start

# 3. Aplicar el schema + RLS + audit logs
npx supabase db reset

# 4. Variables de entorno
cp .env.example .env.local
#   Rellena con los valores de `npx supabase status`:
#   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY (publishable),
#   SUPABASE_SERVICE_ROLE_KEY (secret).
#   Genera la clave de cifrado:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
#   …y pégala en ENCRYPTION_KEY.

# 5. Regenerar tipos TS desde la DB (opcional, ya versionados)
npx supabase gen types typescript --local > types/database.ts

# 6. Arrancar
npm run dev   # http://localhost:3000
```

Las API keys de Deepgram/OpenAI/Resend son **opcionales**: si se dejan vacías, la app funciona
en modo demo (mock). Al añadirlas en `.env.local` se activan los proveedores reales.

## Scripts

| Comando | Descripción |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Build de producción |
| `npm run typecheck` | Chequeo de tipos |
| `npm test` | Tests unitarios (Vitest) |
| `npm run test:e2e` | Tests E2E (Playwright) — requiere Supabase local |

## Estructura

```
app/(auth)        Login / signup
app/(app)         Rutas protegidas: dashboard, pacientes
lib/crypto.ts     Cifrado AES-256-GCM
lib/providers     Interfaces de transcripción/IA + mocks
lib/supabase      Clientes server/browser/admin
lib/db            Capa de datos por dominio (pacientes, audit)
lib/auth.ts       Sesión y control de roles
supabase/migrations  Schema, RLS multi-tenant, audit inmutable
proxy.ts          Refresh de sesión + guard de rutas (Next 16)
tests/            Vitest (unit + RLS) y Playwright (E2E)
docs/             Spec, planes y diseño original
```

## Seguridad y cumplimiento

- **Aislamiento por clínica** vía RLS (testeado en `tests/rls.test.ts`).
- **PII cifrada** en reposo (AES-256-GCM) + TLS en tránsito.
- **audit_logs inmutable** (solo INSERT; trigger bloquea UPDATE/DELETE).
- **Consentimiento digital** con hash + firma + IP/UA (Ley 527).
- El **audio nunca se persiste**: WebRTC → Deepgram directo; el servidor solo recibe texto.
- Las sugerencias de IA **no constituyen diagnóstico** (disclaimers visibles).

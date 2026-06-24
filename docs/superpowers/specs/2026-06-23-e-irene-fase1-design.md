# E-Irene — Diseño Fase 1 (MVP)

> Fecha: 2026-06-23
> Estado: Aprobado (brainstorming) — fuente de verdad para la implementación.

## 1. Contexto del producto

E-Irene es un SaaS multi-tenant para profesionales de salud mental (psicólogos/clínicas) en
Colombia. El diferenciador central es:

1. **Transcripción en vivo** de sesiones de terapia (WebRTC → Deepgram directo; el audio nunca
   pasa por el servidor, solo el texto).
2. **Análisis con IA post-sesión** (GPT-4o): sentimiento, keywords, nube de palabras, patrones
   lingüísticos y una sugerencia preliminar **editable por el doctor**.
3. **Reporte PDF** de 8 secciones, bajo cumplimiento legal colombiano (Habeas Data Ley 1581,
   Comercio Electrónico Ley 527, Historia Clínica Electrónica Ley 2015/2020 y Decreto 580/2024).

Esta Fase 1 cubre el MVP del roadmap: auth, pacientes, agenda, consentimiento, transcripción,
análisis IA y PDF, con email de notificaciones y audit logs.

## 2. Decisiones de arquitectura (locked)

| Decisión | Elección | Razón |
|---|---|---|
| Forma de despliegue | Monolito **Next.js 15 (App Router)** en Vercel | Un solo deploy, rapidez de Fase 1 |
| Backend de datos | **Supabase** (Postgres + Auth + RLS + Storage + Realtime) | Colapsa 5-6 servicios en uno |
| Acceso a datos | **`supabase-js` + tipos TS autogenerados + migraciones SQL** | RLS aplicado por JWT del usuario; multi-tenant seguro por defecto. (Prisma evitado: rompe RLS al usar service-role.) |
| Auth | **Supabase Auth** | Integra nativo con RLS |
| Transcripción | **Provider interface** → `MockProvider` (default) \| `DeepgramProvider` (con key) | Corre sin keys hoy, conecta real con `.env` |
| Análisis IA | **Provider interface** → `MockProvider` (default) \| `OpenAIProvider` (con key) | Igual |
| PDF | **`@react-pdf/renderer`** | Serverless-friendly; evita Puppeteer/Chromium en Vercel |
| Email | **Resend** | Recordatorios + aviso de reporte listo |
| Idioma | Español (Colombia) | Mercado objetivo |
| Cifrado | **AES-256-GCM** a nivel app + TLS | "Todos los campos del paciente cifrados" |

## 3. Modelo de datos (12 entidades)

Todas las tablas de negocio llevan `clinic_id` (raíz multi-tenant) y timestamps.

| Entidad | Propósito | Seguridad |
|---|---|---|
| `clinics` | Raíz del multi-tenant | — |
| `users` | Roles: admin, doctor, secretaria, paciente | Gestionado por Supabase Auth + perfil |
| `patients` | Datos del paciente | **PII cifrada (AES-256)** |
| `consents` | Consentimiento informado digital | Firma + hash SHA-256 + IP + UA + timestamp |
| `appointments` | Citas y agenda | — |
| `consultations` | Sesiones de consulta | Transcripción cifrada |
| `transcript_chunks` | Fragmentos de transcripción | Texto cifrado |
| `reports` | Reportes generados por IA | Sentimiento/keywords/sugerencia cifrados; `doctor_edited` |
| `patient_progress` | Seguimiento del paciente | Notas cifradas (mayormente Fase 2) |
| `audit_logs` | **Inmutable** — cumplimiento legal | Solo INSERT; trigger bloquea UPDATE/DELETE |
| `notifications` | Email/WhatsApp recordatorios | — |
| `clinic_doctors` | Relación N:M clínica-doctor | — |

### Reglas de seguridad de datos
- **RLS** en todas las tablas: el usuario solo ve filas de su `clinic_id`; permisos finos por rol.
- **Cifrado app-layer** (AES-256-GCM, clave `ENCRYPTION_KEY`) en columnas sensibles: PII de
  `patients`, texto de `transcript_chunks`, contenido de `consultations` y `reports`.
- **`audit_logs` inmutable**: RLS permite solo `INSERT`; trigger `raise exception` en UPDATE/DELETE.
- **`consents`**: hash del texto versionado del documento + firma (canvas → Storage) + IP +
  user-agent + timestamp → prueba legal (Ley 527).
- **Audio**: nunca persistido. WebRTC → Deepgram directo; el servidor solo guarda texto cifrado.

## 4. Capa de proveedores (provider abstraction)

```ts
interface TranscriptionProvider {
  createSession(opts): Promise<{ sessionToken; wsUrl }>   // token efímero
  // streaming manejado en cliente; chunks finales → backend
}
interface AnalysisProvider {
  analyze(transcript): Promise<ReportPayload>             // validado con Zod
}
```

- Factory elige implementación por env (`TRANSCRIPTION_PROVIDER`, `ANALYSIS_PROVIDER` o presencia
  de `DEEPGRAM_API_KEY` / `OPENAI_API_KEY`).
- `MockProvider` produce transcripción y análisis realistas para correr sin keys (modo demo).
- Adaptadores reales: `DeepgramProvider` (Live API, token efímero 15 min) y `OpenAIProvider`
  (GPT-4o, JSON mode, salida validada con Zod).

## 5. Módulos y orden de construcción

Foundation-first; cada rebanada corre end-to-end con el mock.

1. **Base** — scaffold Next.js, schema + RLS + seed, design system (tokens de marca + shadcn/ui),
   app shell/layout, util de cifrado, capa de proveedores (skeleton + mock).
2. **Auth & multi-tenant** — login/signup, creación de clínica, roles, rutas protegidas, nav por rol.
3. **Pacientes** — CRUD cifrado, lista, ficha del paciente.
4. **Agenda/citas** — CRUD + vista calendario + estados.
5. **Consentimiento digital** — captura firma/hash, requerido antes de consulta.
6. **Consulta + transcripción** — `getUserMedia`, provider (mock→Deepgram), transcript en vivo por
   Realtime, chunks cifrados, cierre de sesión.
7. **Análisis IA** — al cerrar, `AnalysisProvider` (mock→GPT-4o) genera reporte JSON validado (Zod),
   editable por el doctor.
8. **Reporte PDF** — render 8 secciones con `@react-pdf/renderer` → Storage → descarga firmada.
9. **Email** — recordatorios de cita + aviso "reporte listo" (Resend).
10. **Audit logs** — cableado en acciones sensibles.

Fuera de Fase 1: portal del paciente / historial comparativo (Fase 2), WhatsApp, billing,
panel multi-clínica admin avanzado.

## 6. Estructura del reporte (8 secciones)

1. Información general (paciente, doctor, clínica, fecha, duración, consentimiento)
2. Resumen ejecutivo (máx. 200 palabras) — GPT-4o
3. Análisis de sentimiento (score −1 a +1, timeline emocional) — GPT-4o + HuggingFace
4. Nube de palabras (Top 15 keywords + temas) — TF-IDF + GPT-4o
5. Patrones lingüísticos (1ª persona, negaciones, dudas, intensidad) — NLP
6. Sugerencia preliminar (con **disclaimer grande**, editable) — GPT-4o
7. Transcripción completa (timestamps + speakers) — Deepgram
8. Firmas y validación (firma del doctor + checkbox)

## 7. Diseño visual (tokens de marca)

| Token | Hex | Uso |
|---|---|---|
| Navy Deep | `#0A2540` | Fondos principales, texto |
| Purple Accent | `#635BFF` | CTAs, botones primarios |
| Mint Green | `#00D4AA` | Éxito, salud |
| Coral Alert | `#FF6B6B` | Alertas, errores |
| Cloud White | `#F6F9FC` | Fondos de tarjetas |
| Soft Mint | `#96F7D6` | Hover, badges |
| Gray Line | `#E3E8EE` | Bordes, divisores |

## 8. Testing

- **Vitest** (unit): crypto utils, providers, schemas Zod, lógica de negocio.
- **Playwright** (E2E): auth, crear paciente, consulta con transcripción mock, generar reporte.
- **Tests de RLS**: aislamiento entre clínicas (un usuario no ve datos de otra clínica).
- TDD donde aporte (crypto, providers, validación).

## 9. Cumplimiento legal (transversal)

- Ley 1581 (Habeas Data): datos de salud = sensibles → consentimiento + cifrado obligatorios.
- Ley 527: firma/consentimiento digital legalmente válido (hash + firma + metadata).
- Ley 2015/2020 + Decreto 580/2024: HC electrónica válida por sí sola → firma digital del doctor,
  trazabilidad (audit logs), conservación.
- Disclaimers grandes: las sugerencias de IA **no son diagnóstico**.

## 10. Variables de entorno

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=        # solo server, tareas de sistema
ENCRYPTION_KEY=                   # 32 bytes base64, AES-256-GCM
DEEPGRAM_API_KEY=                 # opcional → activa transcripción real
OPENAI_API_KEY=                   # opcional → activa análisis real
RESEND_API_KEY=                   # opcional → activa email real
```

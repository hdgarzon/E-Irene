# E-Irene Planes 3-7 — Consentimiento → Consulta/Transcripción → IA → PDF → Email

> Mismo patrón que Planes 1-2 (Server Actions + Zod + RLS + audit + tests). APIs externas en
> **modo mock** (Deepgram/OpenAI/Resend); se activan con su key en `.env.local`.

## Plan 3 — Consentimiento digital
- Migración `0003`: bucket Storage `signatures` (privado) + políticas por clínica.
- `lib/consent.ts`: texto del consentimiento versionado + `sha256()` del documento.
- `lib/db/consents.ts`: `createConsent`, `getActiveConsent(patientId)`.
- Componente firma (canvas → PNG dataURL).
- Acción `signConsentAction`: sube firma a Storage, guarda hash + IP + UA + signer_name.
- UI: `/patients/[id]/consent` (captura) + estado en la ficha del paciente.

## Plan 4 — Consulta + transcripción en vivo (mock)
- `lib/db/consultations.ts`: `startConsultation`, `appendChunk` (cifrado), `endConsultation`.
- Provider mock de transcripción que emite chunks simulados en el cliente.
- `/consultations/new` (elige paciente con consentimiento) → `/consultations/[id]/live`
  (micrófono + transcript en vivo + cerrar).
- Gate: requiere consentimiento activo del paciente.

## Plan 5 — Análisis IA (mock)
- Al cerrar consulta: `getAnalysisProvider().analyze(transcript)` → `reports` (cifrado).
- `lib/db/reports.ts`: `createReport`, `getReport`, `updateSuggestion` (editable por doctor).
- UI `/consultations/[id]` → reporte de 8 secciones con disclaimer; edición de sugerencia.

## Plan 6 — Reporte PDF
- `@react-pdf/renderer`: documento de 8 secciones.
- Acción genera PDF → Storage `reports` → descarga firmada. Botón "Descargar PDF".

## Plan 7 — Email (recordatorios)
- `lib/email/`: interface + `ResendProvider` | `LogProvider` (sin key → log + registro en
  `notifications`).
- Acción "Enviar recordatorio" desde una cita; aviso "reporte listo" al generar reporte.

## DoD global
Cada módulo: typecheck + unit + build verdes, audit logging, RLS scoped, commit propio.

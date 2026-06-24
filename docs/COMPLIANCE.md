# Cumplimiento y seguridad — E-Irene

> Estado de los controles técnicos implementados y mapeo a la normativa. La **certificación**
> formal (HIPAA, habilitación) es un proceso organizacional/auditoría que excede el código;
> este documento describe los controles que la plataforma ya provee.

## Controles técnicos implementados

| Control | Implementación | Dónde |
|---|---|---|
| Cifrado en reposo (PII y datos clínicos) | AES-256-GCM a nivel app | `lib/crypto.ts`; columnas `*_enc` |
| Cifrado en tránsito | TLS (Supabase/Vercel) | infraestructura |
| Aislamiento multi-tenant | RLS por `clinic_id` en todas las tablas | `supabase/migrations/0001_init.sql` |
| Control de acceso por rol | admin/doctor/secretaria/paciente | RLS + `requireRole` |
| Trazabilidad (audit trail) | `audit_logs` **inmutable** (solo INSERT; trigger bloquea UPDATE/DELETE) | migración 0001 |
| Consentimiento informado | firma + hash SHA-256 del documento + IP + user-agent + timestamp | `lib/consent.ts`, `consents` |
| Minimización de datos de audio | el audio **nunca se persiste**; solo texto cifrado | flujo de transcripción |
| Firma del profesional en reportes | validación con `validated_by`/`validated_at` | `reports` |
| Almacenamiento seguro de archivos | buckets privados con RLS por clínica | migración 0003 |

## Mapeo normativo (Colombia)

| Norma | Requisito | Cobertura |
|---|---|---|
| **Ley 1581/2012** (Habeas Data) | datos de salud = sensibles; consentimiento y cifrado | consentimiento digital + AES-256 |
| **Ley 527/1999** | validez de firma/mensaje de datos | firma con hash + metadata como prueba |
| **Resolución 1995/1999** | historia clínica reservada, con firma y trazabilidad | RLS + audit logs + validación |
| **Ley 2015/2020 + Decreto 580/2024** | HC electrónica interoperable y válida por sí sola | reporte firmado + retención |

## Salvaguardas tipo HIPAA (referencia)

- **Technical safeguards:** control de acceso (RLS/roles), cifrado, audit controls (audit_logs),
  integridad (auth tag GCM + hash de consentimiento).
- **Administrative / Physical safeguards:** **pendientes de proceso organizacional** — BAA con
  proveedores (Supabase/Vercel/OpenAI/Deepgram en planes con acuerdo), políticas de acceso,
  gestión de incidentes, backups y retención, formación del personal.

## Pendiente para producción (no-código)

- Acuerdos de tratamiento de datos / BAA con proveedores de IA y nube.
- Rotación y custodia de `ENCRYPTION_KEY` en un KMS (hoy en variable de entorno).
- Política de retención y respaldo de la historia clínica (10–20 años).
- Evaluación de impacto y plan de respuesta a incidentes.

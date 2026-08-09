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
| Minimización de datos de audio | el audio **nunca se persiste**; solo texto cifrado. Requiere `mip_opt_out=true` en la URL de Deepgram, sin el cual el proveedor persiste audio para entrenar modelos | `lib/providers/deepgram.ts`; test de regresión en `tests/providers.test.ts` |
| Retención de transcripción | purga automática: 30 días tras validar el reporte, techo duro de 90 días, incluidas consultas abandonadas. Cada purga queda en `audit_logs` y en `transcript_purged_at` | migración 0033 |
| Aceptación de la política por el profesional | compuerta en `/terminos`: sin aceptar la versión vigente no hay acceso. Prueba inmutable con versión + hash SHA-256 + IP + user-agent; autorización comercial separada | migración 0035; `lib/legal.ts` |
| Verificación de habilitación profesional | cédula + tarjeta profesional con aprobación manual; RLS `auth_can_access_clinical()` bloquea crear pacientes/consultas sin verificar, y un trigger impide auto-verificarse | migración 0032; `lib/verification.ts` |
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

- Acuerdos de tratamiento de datos / BAA con proveedores de IA y nube. **Sin ellos, la política de
  tratamiento no puede afirmar que las transferencias internacionales tienen garantías
  contractuales** — ver `docs/legal/politica-tratamiento-datos-borrador.md`, sección 4.1.
- Rotación y custodia de `ENCRYPTION_KEY` en un KMS (hoy en variable de entorno).
- Política de retención y respaldo de la historia clínica (15 años, Resolución 839 de 2017).
- Evaluación de impacto y plan de respuesta a incidentes.
- Inscripción en el Registro Nacional de Bases de Datos (RNBD) ante la SIC, si aplica.

## Brechas conocidas entre lo declarado y lo implementado

| Brecha | Impacto | Estado |
|---|---|---|
| **Cuentas anteriores a la verificación quedaron aprobadas automáticamente** | Nadie revisó sus credenciales | La migración 0032 las marca aparte; revisión retroactiva pendiente en `/admin/verificaciones` |
| **No hay acuerdos de tratamiento (DPA/BAA) con Deepgram ni OpenAI** | La política no puede afirmar que las transferencias internacionales tienen garantías contractuales | Pendiente, es gestión comercial |

> Documentos legales preliminares en [docs/legal/](legal/). Los controles marcados arriba como
> "sin implementar" **no deben presentarse como vigentes** ante terceros ni ante la autoridad.

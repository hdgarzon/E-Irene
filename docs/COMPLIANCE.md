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
| Consentimiento informado | firma + hash SHA-256 del documento + IP + user-agent + timestamp; la transcripción solo arranca cuando el profesional la inicia, tras el aviso al paciente | `lib/consent.ts`, `consents`, `components/live-consultation.tsx` |
| Minimización de datos de audio | el audio **nunca se persiste**; solo texto cifrado. Exige `mip_opt_out=true` en la URL de Deepgram, sin el cual el proveedor persiste audio para entrenar modelos. La exclusión es **por petición**, no de cuenta: una sola conexión sin el parámetro vuelve a exponer el audio | `lib/providers/deepgram.ts` (invariante que impide arrancar sin él), test de regresión, y `scripts/audit-deepgram-mip.mjs` para auditar el tráfico real del proveedor |
| Retención de transcripción | purga automática a los 7 días de la sesión (cierre, o inicio si quedó abandonada), se haya validado o no el reporte. Cada purga queda en `audit_logs` y en `transcript_purged_at` | migración 0059 |
| Aceptación de la política por el profesional | casillas al crear la cuenta (`/auth/set-password`) y compuerta en `/terminos`: sin aceptar la versión vigente no hay acceso. El hash cubre la casilla y los tres documentos que cita. Prueba inmutable con versión + hash SHA-256 + IP + user-agent; autorización comercial separada | migración 0035; `lib/legal.ts` |
| Documentos legales publicados | Política de tratamiento, Aviso de privacidad, Términos de uso y Vinculación del profesional, en página y PDF desde una sola fuente; enlazados en el pie de la landing junto a la SIC | `lib/legal-documents/` |
| PQR con radicado (Ley 1480, art. 50 lit. g) | formulario público `/pqr`; la base asigna radicado consecutivo y fecha, inmutables; constancia por correo y plazo de 15 días hábiles con festivos de Colombia en `/admin/pqr` | migración 0061; `lib/pqr.ts`, `lib/dates.ts` |
| Eliminación de la cuenta y portabilidad (Términos de Vinculación, cl. 7) | el admin exporta todo en JSON (`/settings/exportar`) y solicita la eliminación; 30 días para exportar o desistir; vencido el plazo, el cron borra firmas y documentos en Storage, bloquea el acceso y suprime pacientes e información clínica en una transacción. Se conservan clínica, usuarios, auditoría, facturación y aceptaciones | migración 0062; `lib/db/account-deletion.ts` |
| Identificación de cuentas eliminadas (Política, sección 5: "mientras esté vigente la relación, más 2 años") | 2 años después de la eliminación, el mismo cron anonimiza a los usuarios, borra sus aceptaciones y sus cuentas de acceso. Se conservan la clínica y la facturación (10 años) y audit_logs, sin datos personales | migración 0063; `lib/db/account-deletion.ts` |
| Revocación del consentimiento (Consentimiento, cl. 9; Ley 1581, art. 8 lit. e) | el personal registra la revocación pedida por el paciente; las firmas quedan marcadas, no se borran, y sin firma vigente no se inicia consulta ni transcripción. La historia clínica se conserva | migración 0064; `lib/db/consents.ts` |
| Aviso de cambios legales (Política 10; Vinculación cl. 10) | el admin de plataforma publica el aviso en `/admin/avisos`; la vigencia exige 15 días hábiles con festivos de Colombia; se muestra en la app hasta la vigencia y se envía una vez por correo, con constancia inmutable de fecha y destinatarios | migración 0065; `lib/legal-notices.ts` |
| Consentimiento de menores | desde 14 años firma el paciente; por debajo, el representante y el profesional registra el asentimiento (Res. 309 de 2025) | `lib/consent.ts`; migración 0060 |
| Verificación de habilitación profesional | cédula + tarjeta profesional con aprobación manual; RLS `auth_can_access_clinical()` bloquea crear pacientes/consultas sin verificar. Con la sesión no se puede auto-verificar, cambiar el propio rol, insertar perfiles, ni declarar documentos ajenos o sacarlos de la purga | migraciones 0032, 0043 y 0044; `lib/verification.ts` |
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
| **Cuentas anteriores a la verificación quedaron aprobadas automáticamente** | Nadie revisó sus credenciales | Deben subir cédula y tarjeta antes del 18-oct-2026: plazo de la 0040, prorrogado por la 0043 porque no tenían cómo cumplir. Conservan el acceso mientras el admin revisa en `/admin/verificaciones`; sin documentos, al vencer pierden la creación de registros clínicos |
| **No hay acuerdos de tratamiento (DPA/BAA) con Deepgram ni OpenAI** | La política no puede afirmar que las transferencias internacionales tienen garantías contractuales | Pendiente, es gestión comercial |
| **Canales sin credenciales en producción** | Sin `RESEND_API_KEY`, `TWILIO_*`, `DAILY_API_KEY` ni `NEXT_PUBLIC_SITE_URL`, el correo y WhatsApp no envían y las videollamadas corren en modo simulado (`https://mock.video/...`) | Pendiente, son credenciales. La app ya lo registra como `simulated` en vez de afirmar el envío |

> Documentos legales preliminares en [docs/legal/](legal/). Los controles marcados arriba como
> "sin implementar" **no deben presentarse como vigentes** ante terceros ni ante la autoridad.

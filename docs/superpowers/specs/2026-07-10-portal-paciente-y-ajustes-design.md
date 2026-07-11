# Diseño: Links de paciente, retención de transcripción, página de seguridad y ajustes menores

**Fecha**: 2026-07-10
**Rama**: `feat/telehealth`
**Estado**: Aprobado, pendiente de plan de implementación

## Resumen

Siete cambios solicitados sobre la plataforma en producción (e-irene.co). Tres son ajustes
pequeños y autocontenidos (copy, feedback visual, corrección de dato). Cuatro requieren
diseño: un mecanismo nuevo de "link único" para que el paciente firme consentimiento o
responda escalas psicométricas sin necesitar cuenta, la eliminación de la transcripción del
PDF con retención automática de 30 días, y una página pública de resumen de seguridad.

Contexto importante: antes de diseñar se hizo una exploración del código (agente Explore) que
confirmó que consentimiento y escalas psicométricas **ya existen** como funcionalidad completa
para el personal de la clínica (`app/(app)/patients/[id]/consent`,
`app/(app)/patients/[id]/assessments/new`). Lo que falta es un **acceso público sin login**
para que el paciente los complete directamente. También se confirmó que no existe ningún
mecanismo de retención/expiración de datos en la plataforma hoy, y que el rol mostrado en el
menú de usuario ya es dinámico (no hardcodeado) — el caso reportado era un dato de rol
incorrecto en la base de datos, no un bug de código.

## 1. Copy del label de signup

**Archivo**: `components/auth/signup-form.tsx:35`

Cambiar el texto del `<Label>` de `"Nombre de la clínica o consulta"` a
`"Nombre de la clínica"`. Sin cambios de lógica, validación ni el campo `name="clinicName"`.

## 2 y 6. Link único de paciente (consentimiento + escalas psicométricas)

### Decisión de acceso

El paciente completa estos formularios **sin cuenta ni login**, a través de un link único con
token que expira. No se construye un portal de paciente con sesión propia — se descartó por ser
más pesado (nuevas políticas RLS para `role='paciente'`, usuarios temporales) que lo que pide
este alcance.

### Modelo de datos — tabla nueva `patient_links`

```sql
create table patient_links (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  purpose text not null check (purpose in ('consent', 'assessment')),
  assessment_type text check (assessment_type in ('phq9', 'gad7')),
  token_hash text not null unique,        -- sha256 del token; el token crudo NUNCA se guarda
  expires_at timestamptz not null,        -- created_at + 7 días
  completed_at timestamptz,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  constraint patient_links_assessment_type_check
    check (purpose <> 'assessment' or assessment_type is not null)
);
create index patient_links_patient_idx on patient_links(patient_id);

alter table patient_links enable row level security;
create policy patient_links_select on patient_links
  for select using (clinic_id = auth_clinic_id());
create policy patient_links_insert on patient_links
  for insert with check (clinic_id = auth_clinic_id());
```

Sin política RLS para acceso público — la ruta pública usa exclusivamente el cliente
`service-role` (`lib/supabase/admin.ts`) después de validar el token en servidor. El token es
la autorización; RLS protege el resto (personal de clínica solo ve/crea links de su propia
clínica).

Adicional: agregar columna nullable `link_id uuid references patient_links(id)` a `consents` y
a `psychometric_assessments`, para trazabilidad de qué firma/resultado vino de un link público
vs. de personal en la app.

### Generación y envío

- Botón "Generar link de consentimiento" en la ficha del paciente (junto a la sección de
  consentimiento existente) y "Generar link de [PHQ-9 / GAD-7]" junto al flujo de escalas.
- Server Action valida sesión de staff (`requireUser()`), crea la fila en `patient_links` con
  `expires_at = now() + 7 días`, genera un token aleatorio de alta entropía
  (`crypto.randomBytes(32).toString("base64url")`), guarda solo su hash SHA-256, arma la URL
  (`https://e-irene.co/enlace/<token>`), y envía el correo automáticamente usando el mismo
  patrón que `sendReminderAction` (`getEmailProvider().send(...)`), con una plantilla nueva en
  `lib/email/templates.ts`. Se registra en `notifications` (mismo patrón existente) y en
  `audit_logs` (`action: 'patient_link.created'`).

### Ruta pública

**`app/enlace/[token]/page.tsx`** — fuera del grupo `(app)`, sin `requireUser()`, sin sesión.

1. Server component recibe `token` de la URL, calcula su hash SHA-256.
2. Busca en `patient_links` por `token_hash` usando el cliente `service-role`.
3. Si no existe, ya expiró (`expires_at < now()`) o ya está completado
   (`completed_at is not null`): renderiza una página de error amigable ("Este enlace ya no es
   válido. Solicita uno nuevo a tu clínica.").
4. Si es válido: carga el paciente (`service-role`) y según `purpose` renderiza:
   - `consent`: el mismo componente `<ConsentForm>` ya existente, con el mismo texto de
     `lib/consent.ts` (`CONSENT_TEXT`, manejo de menores).
   - `assessment`: el mismo formulario de preguntas PHQ-9/GAD-7 ya existente
     (`lib/psychometrics.ts`).

### Escritura (nuevas funciones, sin tocar las existentes)

Las funciones actuales `createConsent` / `createAssessment` dependen de RLS vía sesión de
staff (`createClient()` con cookies) — no funcionan sin sesión. Se agregan funciones gemelas:

- `createConsentViaLink(linkId, ...)` en `lib/db/consents.ts`
- `createAssessmentViaLink(linkId, ...)` en `lib/db/assessments.ts`

Ambas usan `createAdminClient()` (`service-role`) y **solo se invocan desde una Server Action
pública que revalida el token en servidor antes de escribir** (nunca confía en
`clinicId`/`patientId` que pudiera llegar del cliente — todo se deriva de la fila de
`patient_links` ya verificada). Al completar, se marca `patient_links.completed_at = now()`.

### Seguridad

- Token de 256 bits de entropía, solo se guarda su hash (mismo patrón que `document_hash` de
  consentimiento).
- Expira a los 7 días desde su creación.
- Un link ya completado deja de aceptar nuevos envíos (aunque no haya expirado por tiempo), pero
  permanece accesible en modo lectura si el paciente quiere ver qué firmó/respondió.
- Las funciones `...ViaLink` son las únicas que usan `service-role` para escritura de datos
  clínicos fuera de una sesión — quedan documentadas y acotadas a este flujo exclusivamente.

## 3. Quitar transcripción del PDF + retención de 30 días

### PDF

- `lib/pdf/report-pdf.tsx`: eliminar el bloque condicional de la página "Transcripción
  completa" (líneas 262-277) y quitar `transcript` de las props de `ReportDocument`.
- `app/(app)/consultations/[id]/pdf/route.ts`: quitar `getTranscript(id)` del `Promise.all` (ya
  no se usa para nada más en esa ruta) y quitar `transcript` del objeto pasado a
  `renderReportPdf`.

### Retención en la plataforma (30 días)

La transcripción **sigue visible dentro de la app** (ya se muestra hoy en
`app/(app)/consultations/[id]/page.tsx`) hasta que se purga automáticamente.

Mecanismo: **Supabase `pg_cron`** (extensión disponible en el proyecto, no instalada aún).

```sql
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

select cron.schedule('purge-expired-transcripts', '0 3 * * *', 'select purge_expired_transcripts()');
```

El corte se basa en `consultations.ended_at` (fecha en que terminó la sesión), no en la fecha
de creación del registro. La página de detalle de consulta debe manejar el caso
`transcript_enc is null` mostrando "Esta transcripción ya no está disponible (se elimina
automáticamente a los 30 días)" en vez de dejar la sección vacía o romperse.

No se purgan `reports`, `soap_notes` ni otros datos clínicos — solo la transcripción cruda. El
resumen, notas SOAP y demás quedan intactos indefinidamente (historia clínica).

## 4. Página pública de resumen de seguridad

**Ruta nueva**: `app/seguridad/page.tsx` (pública, sin login), enlazada desde el landing
(`app/page.tsx`) y desde login/signup.

Contenido basado en `docs/COMPLIANCE.md`, traducido a lenguaje claro para audiencia no técnica
(clínica evaluando el producto, paciente, auditor). Secciones:

- Cifrado de datos (AES-256-GCM) en tránsito y en reposo.
- Aislamiento por clínica (row-level security / multi-tenant).
- Consentimiento informado y firma digital.
- Cumplimiento legal colombiano: Ley 1581/2012 (Habeas Data), Ley 2015/2020 (telemedicina),
  Resolución 1995/1999.
- Retención y eliminación de datos (incluye la nueva política de 30 días para transcripciones).
- Cómo reportar un incidente de seguridad.

El borrador de contenido se comparte para revisión antes de publicarlo — no se inventan
afirmaciones de cumplimiento (ej. certificaciones) que no estén ya respaldadas por
`docs/COMPLIANCE.md`.

## 5. Feedback visual al hacer clic en botones

**Archivo**: `components/ui/button.tsx` (componente base shadcn, usado por los ~39 usos de
`<Button>` en la app).

Agregar un estado `active:` a las clases base de todas las variantes (ej.
`active:scale-[0.97]` con una transición corta ya existente o agregada). Cambio centralizado —
no se toca cada botón individualmente. Se aplica también, si tiene sentido visualmente, a los
`<button>` nativos que ya tienen su propio estilo (`signature-pad.tsx`, `mobile-nav.tsx`, etc.),
evaluando caso por caso para no romper estilos existentes.

## 7. Corrección de rol de usuario (dato, no código)

Se confirmó que `components/user-menu.tsx` ya muestra el rol dinámicamente según la columna
`role` de la tabla `users`. El caso reportado (cuenta `henrygarzon089@gmail.com` mostrando
"Administrador") es un dato incorrecto en base de datos, no un bug de código.

**Acción**: `update users set role = 'doctor' where email = 'henrygarzon089@gmail.com'`,
ejecutado directamente vía el MCP de Supabase, con confirmación del usuario antes de aplicar.

## Fuera de alcance

- Portal de paciente con cuenta/sesión propia (se optó por links con token en su lugar).
- Certificaciones formales (SOC2, HIPAA) en la página de seguridad — solo se documentan
  controles técnicos reales.
- Envío del link por WhatsApp/SMS (solo email por ahora; el proveedor de WhatsApp ya existe en
  el código para recordatorios y podría reutilizarse a futuro si se pide).
- Políticas de retención para otros datos clínicos (SOAP, reportes, historia clínica) — la
  retención de 10-20 años mencionada en `docs/COMPLIANCE.md` sigue pendiente y no se aborda
  aquí.

## Testing

- Tests unitarios para `createConsentViaLink` / `createAssessmentViaLink` (token válido,
  expirado, ya completado, inexistente).
- Test e2e del flujo completo: generar link → abrir en modo "sin sesión" (browser context
  limpio) → completar → verificar que quede marcado `completed_at` y visible en la ficha del
  paciente.
- Test de que el PDF generado ya no incluye la página de transcripción.
- Test de la función `purge_expired_transcripts()` (aplicar migración en rama de prueba de
  Supabase, insertar consulta con `ended_at` de hace 31 días, ejecutar la función, verificar
  `transcript_enc is null` y `transcript_chunks` vacío).

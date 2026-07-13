# E-Irene — Diseño: Telehealth (videollamada integrada al pipeline de IA)

> Fecha: 2026-07-08
> Estado: Aprobado (brainstorming) — fuente de verdad para la implementación.

## 1. Contexto y alcance

Este spec nace del roadmap de largo plazo de la auditoría integral (portal del paciente +
telehealth). Ambos son subsistemas independientes; se decidió empezar por **telehealth**, porque
no requiere inventar autenticación de pacientes (el paciente entra por link de un solo uso, igual
que hoy no necesita cuenta para nada) — el portal del paciente queda como un spec futuro,
separado.

**Decisión de producto clave:** la videollamada NO es una feature aislada de "ver la cara del
paciente". Se integra al mismo pipeline que ya existe — transcripción en vivo → análisis de IA →
reporte clínico — para que una consulta remota produzca exactamente el mismo tipo de reporte que
una presencial. La videollamada se convierte en el **modo remoto de iniciar una consulta**, no en
un producto aparte.

## 2. Decisiones de arquitectura (locked)

| Decisión | Elección | Razón |
|---|---|---|
| Infra de video | **Proveedor hospedado (Daily.co)** vía `VideoProvider` interface | Resuelve TURN/NAT traversal (crítico: sin esto, una fracción real de pacientes no conecta) sin operar infraestructura propia. Expone pistas de audio en crudo por participante. |
| Transcripción en llamada | **Dos conexiones Deepgram separadas** (mic local del doctor + pista remota del paciente), cada una con speaker fijo | Elimina la heurística de diarización actual (que adivina quién habla) — con pistas separadas el speaker se conoce con certeza. Límites de concurrencia y costo verificados: ver §6.1. |
| Acceso del paciente | **Link de un solo uso (`/join/[token]`), sin cuenta** | Consistente con que hoy los pacientes no tienen ningún tipo de sesión; evita construir autenticación de pacientes en este spec. |
| Entrega del link | **Automático**, reutilizando el sistema de recordatorios (email/WhatsApp) ya existente | Cero trabajo manual del doctor; reusa `sendReminderAction`/`buildReminderEmail`/`buildReminderWhatsApp`. |
| Modalidad de cita | Nuevo campo `appointments.modality` (`in_person` \| `video`) | El doctor decide al agendar; determina si el recordatorio incluye el link de video. |
| Grabación | **Nunca** — Daily.co solo relay, nada se almacena | Mismo principio ya establecido: "el audio nunca se guarda". |
| Consentimiento | **Nueva versión de `CONSENT_VERSION`** | El texto actual no cubre video ni el uso de un proveedor externo de videollamada. El mecanismo existente (`getActiveConsent` compara versión) ya obliga a refirmar sin cambios adicionales. |
| Modo de pruebas | `VIDEO_PROVIDER=mock` (mismo patrón que `ANALYSIS_PROVIDER`/`TRANSCRIPTION_PROVIDER`) | CI y desarrollo local no requieren cuenta real de Daily.co. |

## 3. Modelo de datos

### Migración: `appointments`

```sql
alter table appointments add column modality text not null default 'in_person'
  check (modality in ('in_person', 'video'));
alter table appointments add column video_room_name text;
alter table appointments add column video_join_token text unique;
```

- `video_room_name`/`video_join_token` se generan de forma perezosa: la primera vez que hacen
  falta (al enviar el recordatorio, o al pulsar "Iniciar videollamada" si el recordatorio nunca se
  envió).
- `video_join_token` es un token de acceso **separado del `id` de la fila** — un UUID/random
  string propio. No se reutiliza el id interno como credencial (práctica estándar: no mezclar
  identificador de recurso con capacidad de acceso).
- Validez del token: solo dentro de una ventana horaria alrededor de `scheduled_at` (p. ej. desde
  15 min antes hasta el fin de la ventana de duración + margen), y se invalida cuando la
  `consultation` asociada llega a `ended`/`analyzed`.

### `consultations` (sin migración adicional)

Ya tiene `appointment_id` (FK nullable) — una consulta de video simplemente se crea igual que hoy,
enlazada a la cita. No hace falta un campo de "modalidad" propio en `consultations`: se infiere de
`appointments.modality` a través de `appointment_id`.

## 4. Flujo del doctor

1. Al crear/editar una cita, elige modalidad "Video" (select, junto a fecha/duración/notas).
2. Si la cita es de modalidad video, aparece un botón **"Iniciar videollamada"** (en la ficha de la
   cita y en la ficha del paciente). Al pulsarlo:
   - Se crea la sala en Daily.co (si no existe) y se genera `video_join_token` (si no existe).
   - Se crea la `consultation` (igual que `startConsultationAction` hoy).
   - Redirige a una versión ampliada de `/consultations/[id]/live`: el panel de transcripción de
     siempre + el embed de video (participante local + remoto).
3. "Finalizar consulta" cierra la llamada (Daily.co) y dispara el mismo `endConsultationAction` →
   `runConsultationAnalysis` en background que ya existe — **sin cambios en ese pipeline**.

## 5. Flujo del paciente

1. El recordatorio (email o WhatsApp, ya construido) incluye el link `/join/[token]` cuando la
   cita es de modalidad video.
2. `/join/[token]` es una ruta **pública** (sin sesión) — el token es la autorización:
   - Válido y dentro de ventana → valida el token, descifra y muestra el nombre del paciente
     (autorizado por el token, no requiere login), embebe el video de Daily.co.
   - Inválido/expirado/ya usado → mensaje claro ("Este enlace ya no es válido. Contacta a tu
     clínica.").
3. Sin registro, sin contraseña, sin necesidad de estar en la app en ningún otro momento.

## 6. Transcripción de la llamada

- El doctor sigue capturando su propio audio local exactamente igual que hoy (`getUserMedia` +
  MediaRecorder → WebSocket a Deepgram), tageado como `"Doctor"`.
- La pista remota del paciente (expuesta por el SDK de Daily.co por participante) se envía a una
  **segunda conexión Deepgram independiente**, tageada como `"Paciente"`.
- Ambos flujos escriben a la misma `transcript_chunks` (vía `appendChunkAction`, sin cambios), con
  el `speaker` ya conocido — se elimina la heurística de diarización (`lib/diarization.ts`) para
  el modo video (sigue existiendo para el modo texto in-person, sin cambios ahí).
- En modo mock, ambos "streams" se simulan igual que el guion actual (`MOCK_SESSION`), sin
  necesitar cuenta de Deepgram ni Daily.co.

### 6.1 Límites de concurrencia y costo (verificado jul-2026)

Este apartado documenta el hallazgo pendiente que quedó marcado como "no verificado" en el
comentario original antes de `handleRemoteAudioTrack` (`components/live-consultation.tsx`).
Verificado contra `developers.deepgram.com/reference/api-rate-limits`,
`developers.deepgram.com/docs/working-with-concurrency-rate-limits` y `deepgram.com/pricing`
(julio 2026; estos precios y límites pueden cambiar — Deepgram no versiona esa página).

- **El límite de concurrencia es por proyecto de Deepgram, no por API key.** Las dos keys
  efímeras que abre una consulta de video (doctor + paciente) comparten el mismo cupo del
  proyecto — no hay una cuota independiente por key, así que abrir una key por conexión no evade
  el límite ni tampoco lo empeora por sí solo.
- Deepgram separa el cupo de streaming según si la conexión pide `diarize=true` o no:
  - **Con diarización** (parámetro que el modo in-person sigue necesitando): hasta 50 streams
    concurrentes en Norteamérica, 25 en Europa/Australia — mismo número en pay-as-you-go y en
    Growth (no escala con el plan).
  - **Sin diarización** (STT streaming general): hasta 150 concurrentes en NA en pay-as-you-go
    (225 en Growth), 150 en EU/AU en ambos planes.
  - Como consecuencia de esta verificación, se quitó `diarize=true` del modo video (no hacía
    falta: cada conexión ya sabe de quién es el audio por venir de una pista separada de
    Daily.co) — ver `DEEPGRAM_LISTEN_URL_VIDEO` en `lib/providers/deepgram.ts`. Esto separa el
    modo video del pool más chico de diarización (que ahora usa en exclusiva el modo in-person) y
    lo mueve al pool general, 3x más grande en NA.
  - Cada consulta de video consume **2 conexiones** de ese cupo (project-wide, compartido con
    cualquier otra consulta — video o in-person — activa al mismo tiempo).
  - **Pendiente de confirmar en el dashboard real (no verificable desde documentación pública):**
    los proyectos "secundarios" de una cuenta self-serve están limitados a **1 solo stream
    concurrente por diseño**. Si el proyecto de `DEEPGRAM_API_KEY` en producción fuera uno de
    esos, cualquier consulta de video fallaría siempre (necesita 2 streams simultáneos). Acción
    antes de producción: confirmar en Deepgram Dashboard → Settings → Projects que el proyecto en
    uso es el principal de la cuenta (o un proyecto Growth/Enterprise), no uno secundario.
  - Si se excede el límite, Deepgram responde `429` sin cola del lado del servidor — el cliente
    ve el WebSocket fallar (el navegador no expone el código HTTP del handshake fallido, solo un
    evento `error`/`close`). `components/live-consultation.tsx` ahora maneja esto: si cualquiera
    de las dos conexiones falla o se cierra inesperadamente, se muestra un aviso en la UI
    ("esa parte no quedará en el reporte") sin interrumpir la videollamada ni el resto del flujo.
- **Costo:** streaming base ronda $0.0048/min (pay-as-you-go); el add-on de diarización agrega
  ~$0.0020/min. Una consulta in-person (1 conexión, con diarización) cuesta ~$0.0068/min de
  transcripción. Una consulta de video (2 conexiones en paralelo durante toda la llamada, sin
  diarización tras este ajuste) cuesta ~2 × $0.0048 = $0.0096/min — más del doble en minutos
  facturables que una consulta in-person de la misma duración (por los dos streams paralelos),
  pero no un 2x limpio sobre el costo por minuto de in-person porque ya no paga el add-on de
  diarización que antes se cobraba (y no se usaba) en ambas conexiones. Confirmar tarifa y plan
  contratado vigentes en el dashboard antes de proyectar costos reales de producción.

## 7. Proveedor de video

Mismo patrón que transcripción/análisis/email/WhatsApp — interfaz + mock + real:

```ts
// lib/video/types.ts
export interface VideoRoom {
  roomName: string;
  /** URL de la sala en el proveedor — la usan doctor y paciente por igual para
   *  unirse vía el SDK. NO es el link que recibe el paciente por email/WhatsApp
   *  (ese es siempre /join/[token], propio de la app — ver sección 5). */
  roomUrl: string;
}

export interface VideoProvider {
  readonly mode: "mock" | "daily";
  createRoom(consultationId: string): Promise<VideoRoom>;
  deleteRoom(roomName: string): Promise<void>;
}
```

El doctor llega a la sala navegando dentro de la app (ya autenticado, vía
`/consultations/[id]/live`, que internamente lee `roomUrl`). El paciente NUNCA ve `roomUrl`
directamente: recibe `/join/[token]`, y esa ruta —tras validar el token— es la que carga
`roomUrl` para unirlo a la misma sala. Así el link entregado por email/WhatsApp siempre pasa por
la validación de la app (ventana horaria, invalidación tras finalizar la consulta), nunca por una
URL "viva" del proveedor que no se pueda revocar.

- `DailyVideoProvider`: crea la sala vía API REST de Daily.co (server-side, como ya se hace con
  Deepgram — el servidor acuña la sala/token, el navegador se conecta directo).
- `MockVideoProvider`: activo por defecto sin `DAILY_API_KEY`, o forzado con
  `VIDEO_PROVIDER=mock`. Renderiza un placeholder de video (sin conexión real) para que el resto
  del flujo (transcripción simulada, reporte) se pueda probar sin costo ni red.

## 8. Seguridad

- `/join/[token]` se añade a `PUBLIC_PATHS`/`PUBLIC_PREFIXES` de `proxy.ts` — única ruta nueva sin
  sesión. El resto de la defensa (deny-by-default) no cambia.
- El token de un solo uso vive fuera del alcance de RLS normal: la validación ocurre en la propia
  ruta (`/join/[token]`) usando el service-role client SOLO para esa validación puntual y
  acotada — igual de justificado que otros usos ya existentes de `createAdminClient()` en el
  proyecto (p. ej. `lib/db/team.ts`).
- Nunca se graba la llamada — se documenta explícitamente en el código y en `docs/COMPLIANCE.md`.
- Nueva versión de consentimiento cubre: uso de proveedor externo de videollamada, que el audio Y
  video no se almacenan, y que el video se transcribe en vivo igual que el audio. El texto exacto
  se redacta como parte de la implementación; se marca para revisión legal antes de producción
  (no soy abogado).

## 9. Fuera de alcance (explícito)

- Salas de espera.
- Llamadas de más de 2 participantes.
- Compartir pantalla.
- Chat de texto durante la llamada.
- Grabación de la sesión.
- App móvil nativa (sigue siendo web, como el resto del producto).
- Portal del paciente (spec independiente, futuro).

## 10. Testing

- Unit: validación de token (formato, expiración por ventana horaria, invalidación tras
  `ended`/`analyzed`), `MockVideoProvider`.
- E2E: flujo completo en modo mock (crear cita de video → iniciar videollamada → transcripción
  simulada con dos speakers fijos → finalizar → reporte generado), siguiendo el mismo patrón que
  `tests/e2e/consultation.spec.ts`.
- Real Daily.co: verificación manual (no automatizable en CI sin credenciales/costo), documentada
  como paso posterior al despliegue.

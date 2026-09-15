import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { signUpAndActivate } from "./helpers/signup";
import { E2E_DAILY_WEBHOOK_HMAC } from "./helpers/daily";
import { computeDailySignature } from "@/lib/video/daily-webhook";
import { patientVideoUserId } from "@/lib/video/participant-id";

const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function service() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
}

async function clinicIdFor(email: string): Promise<string> {
  const { data, error } = await service().from("users").select("clinic_id").eq("email", email).single();
  if (error) throw error;
  return data.clinic_id as string;
}

/**
 * Suma videollamadas al saldo como lo hace un pago aprobado: la misma función que
 * llaman el webhook de Wompi y la reconciliación (grant_video_pack, migración 0058).
 */
async function grantVideoCredits(clinicId: string, quantity: 1 | 5 | 10): Promise<void> {
  const amount = quantity * 900_000;
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { data: checkout, error } = await service()
    .from("billing_checkouts")
    .insert({
      wompi_payment_link_id: `test_e2e_video_${stamp}`,
      clinic_id: clinicId,
      plan: "pro",
      amount_in_cents: amount,
      reference: `videopack-${clinicId}-${quantity}-${Date.now()}`,
      kind: "video_pack",
      quantity,
    })
    .select("id")
    .single();
  if (error) throw error;
  const { data, error: grantError } = await service().rpc("grant_video_pack", {
    p_clinic: clinicId,
    p_transaction_id: `tx-e2e-video-${stamp}`,
    p_checkout_id: checkout.id,
    p_amount: amount,
  });
  if (grantError) throw grantError;
  if ((data as { outcome: string }).outcome !== "applied") {
    throw new Error(`grant_video_pack no aplicó el pack: ${JSON.stringify(data)}`);
  }
}

/** Plan Profesional con saldo de videollamadas: desde 0058, Free no inicia video. */
async function enableVideoCalls(email: string, quantity: 1 | 5 | 10): Promise<string> {
  const clinicId = await clinicIdFor(email);
  const { error } = await service().rpc("activate_subscription", { p_clinic: clinicId, p_plan: "pro" });
  if (error) throw error;
  await grantVideoCredits(clinicId, quantity);
  return clinicId;
}

/** "YYYY-MM-DDTHH:mm" de AHORA en hora Bogotá, para <input type="datetime-local">
 *  (misma conversión que lib/dates.ts#toInputDateTime, pero desde Date.now()
 *  en vez de parsear un ISO — evita el desfase de zona horaria de construir
 *  el string a mano según la zona de la máquina que corre el test). */
function nowInputDateTime(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

function signConsent(page: import("@playwright/test").Page) {
  const canvas = page.locator("canvas");
  return canvas.evaluate((el: HTMLCanvasElement) => {
    const r = el.getBoundingClientRect();
    const fire = (type: string, x: number, y: number) =>
      el.dispatchEvent(
        new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, clientX: r.left + x, clientY: r.top + y }),
      );
    fire("pointerdown", 60, 80);
    fire("pointermove", 220, 120);
    fire("pointermove", 360, 90);
    fire("pointerup", 360, 90);
  });
}

test("telehealth: cita de video → iniciar videollamada → finalizar → reporte", async ({ page }) => {
  test.setTimeout(60_000);

  const email = `tele_${Date.now()}@e-irene.test`;
  await signUpAndActivate(page, { clinicName: "Clínica Tele", fullName: "Dra. Tele", email });
  await enableVideoCalls(email, 1);

  await page.goto("/patients/new");
  await page.fill("#fullName", "Paciente Tele");
  await page.getByRole("button", { name: /crear paciente/i }).click();
  await expect(page.getByRole("heading", { name: "Paciente Tele" })).toBeVisible();

  await page.getByRole("link", { name: /capturar consentimiento/i }).click();
  await signConsent(page);
  await page.check('input[name="accepted"]');
  await page.getByRole("button", { name: /firmar consentimiento/i }).click();
  await expect(page.getByText("Firmado", { exact: true })).toBeVisible();

  await page.goto("/appointments/new");
  await page.selectOption("#patientId", { label: "Paciente Tele" });
  await page.selectOption("#modality", "video");
  // Fecha fija: startVideoConsultationAction no valida ventana horaria (eso
  // solo aplica a /join/[token], del lado paciente), así que no hace falta
  // que la cita esté "ahora" — un literal fijo evita el desfase de zona
  // horaria de construirla a mano con Date.now().
  await page.fill("#scheduledAt", "2030-01-15T14:30");
  await page.getByRole("button", { name: /agendar cita/i }).click();
  await expect(page).toHaveURL(/\/appointments$/);

  await page.getByRole("button", { name: /iniciar videollamada/i }).click();
  await expect(page).toHaveURL(/consultations\/.+\/live/);
  await expect(page.getByText(/videollamada en curso/i)).toBeVisible();

  // Sin DEEPGRAM_API_KEY, el modo video transmite el mismo guion simulado que
  // el modo in-person (MOCK_SESSION, una línea cada 700ms). El texto aparece
  // en pantalla apenas actualiza el estado local, pero appendChunkAction (el
  // que persiste el fragmento) se dispara sin esperarlo — hay que darle un
  // margen real, no solo esperar a que el texto se vea, o "finalizar
  // consulta" puede correr antes de que el primer fragmento llegue a la base
  // de datos y el reporte de IA nunca se genera (transcript vacío).
  await expect(page.getByText(/no puedo respirar bien/)).toBeVisible();

  await page.getByRole("button", { name: /finalizar consulta/i }).click();
  await expect(page).toHaveURL(/consultations\/[^/]+$/);
  await expect(page.getByText(/Apoyo clínico, no diagnóstico/)).toBeVisible({ timeout: 20_000 });
});

test("telehealth: paciente entra a /join/[token] sin sesión (válido, inválido, cancelada)", async ({
  page,
  browser,
}) => {
  test.setTimeout(60_000);

  const email = `telejoin_${Date.now()}@e-irene.test`;
  await signUpAndActivate(page, { clinicName: "Clínica Join", fullName: "Dra. Join", email });
  await enableVideoCalls(email, 1);

  await page.goto("/patients/new");
  await page.fill("#fullName", "Paciente Join");
  await page.getByRole("button", { name: /crear paciente/i }).click();
  await expect(page.getByRole("heading", { name: "Paciente Join" })).toBeVisible();

  await page.getByRole("link", { name: /capturar consentimiento/i }).click();
  await signConsent(page);
  await page.check('input[name="accepted"]');
  await page.getByRole("button", { name: /firmar consentimiento/i }).click();
  await expect(page.getByText("Firmado", { exact: true })).toBeVisible();

  await page.goto("/appointments/new");
  await page.selectOption("#patientId", { label: "Paciente Join" });
  await page.selectOption("#modality", "video");
  // A diferencia del test anterior, acá SÍ importa que la cita esté "ahora":
  // isJoinWindowOpen (lado paciente) exige que /join/[token] se abra dentro
  // de la ventana agendada ± 15 min, así que se construye a partir de
  // Date.now() en hora Bogotá (ver nowInputDateTime) en vez de un literal fijo.
  await page.fill("#scheduledAt", nowInputDateTime());
  await page.getByRole("button", { name: /agendar cita/i }).click();
  await expect(page).toHaveURL(/\/appointments$/);

  const editHref = await page.getByRole("link", { name: /editar cita/i }).getAttribute("href");
  const appointmentId = /\/appointments\/([^/]+)\/edit/.exec(editHref ?? "")?.[1];
  if (!appointmentId) throw new Error("No se pudo leer el id de la cita desde el link de editar");

  // Iniciar videollamada (como en el flujo del doctor) ya llama a
  // ensureVideoRoom internamente y persiste video_join_token.
  await page.getByRole("button", { name: /iniciar videollamada/i }).click();
  await expect(page).toHaveURL(/consultations\/.+\/live/);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: apptRow, error } = await admin
    .from("appointments")
    .select("video_join_token")
    .eq("id", appointmentId)
    .single();
  expect(error).toBeNull();
  const token = apptRow?.video_join_token as string | null;
  expect(token).toBeTruthy();

  // Paciente: contexto nuevo, sin cookies de la sesión de la doctora — simula
  // que abre el enlace desde su propio dispositivo, sin cuenta ni contraseña.
  const patientContext = await browser.newContext();
  const patientPage = await patientContext.newPage();

  // Token inventado: no hay cita asociada → enlace no válido.
  await patientPage.goto("/join/token-que-no-existe");
  await expect(patientPage.getByRole("heading", { name: "Enlace no válido" })).toBeVisible();

  // Token real, cita vigente dentro de la ventana horaria → el enlace es
  // válido. Sin DAILY_API_KEY (VIDEO_PROVIDER=mock en toda la suite e2e), la
  // sala es falsa y la app ya no lo simula en silencio (ver 978ed9b): en vez
  // de armar la videollamada (JoinCall), avisa que no está disponible.
  await patientPage.goto(`/join/${token}`);
  await expect(patientPage.getByRole("heading", { name: "Enlace no válido" })).not.toBeVisible();
  await expect(
    patientPage.getByRole("heading", { name: "La videollamada no está disponible" }),
  ).toBeVisible();

  // La doctora cancela la cita: el mismo token deja de ser válido. El control
  // de estado vive en la agenda, no en la consulta en vivo donde quedó `page`
  // tras "iniciar videollamada".
  await page.goto("/appointments");
  // Viniendo de la consulta en vivo, /appointments puede tardar en hidratar y el
  // primer clic cae en un botón todavía sin manejador: se repite hasta que abre.
  const cancelada = page.getByRole("menuitem", { name: "Cancelada" });
  await expect(async () => {
    await page.getByRole("button", { name: /Agendada/ }).click();
    await expect(cancelada).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await cancelada.click();
  await expect(page.getByRole("button", { name: /Cancelada/ })).toBeVisible();

  await patientPage.goto(`/join/${token}`);
  await expect(patientPage.getByRole("heading", { name: "Enlace no válido" })).toBeVisible();

  await patientContext.close();
});

test("videollamadas: iniciar exige saldo y se descuenta cuando el paciente se conecta", async ({ page }) => {
  test.setTimeout(90_000);

  const email = `video_${Date.now()}@e-irene.test`;
  await signUpAndActivate(page, { clinicName: "Clínica Video", fullName: "Dra. Video", email });

  await page.goto("/patients/new");
  await page.fill("#fullName", "Paciente Video");
  await page.getByRole("button", { name: /crear paciente/i }).click();
  await expect(page.getByRole("heading", { name: "Paciente Video" })).toBeVisible();
  await page.getByRole("link", { name: /capturar consentimiento/i }).click();
  await signConsent(page);
  await page.check('input[name="accepted"]');
  await page.getByRole("button", { name: /firmar consentimiento/i }).click();
  await expect(page.getByText("Firmado", { exact: true })).toBeVisible();

  await page.goto("/appointments/new");
  await page.selectOption("#patientId", { label: "Paciente Video" });
  await page.selectOption("#modality", "video");
  // Agendar no descuenta, pero avisa que el plan no tiene videollamadas.
  await expect(page.getByText(/no incluye videollamadas: puedes agendar/)).toBeVisible();
  await page.fill("#scheduledAt", "2030-01-15T14:30");
  await page.getByRole("button", { name: /agendar cita/i }).click();
  await expect(page).toHaveURL(/\/appointments$/);

  // Free no tiene videollamadas.
  await page.getByRole("button", { name: /iniciar videollamada/i }).click();
  await expect(page.getByText(/El plan Free no incluye videollamadas/)).toBeVisible();
  await expect(page).toHaveURL(/\/appointments$/);

  // Plan pago sin saldo: tampoco.
  const clinicId = await clinicIdFor(email);
  const { error: planError } = await service().rpc("activate_subscription", {
    p_clinic: clinicId,
    p_plan: "pro",
  });
  if (planError) throw planError;
  await page.reload();
  await page.getByRole("button", { name: /iniciar videollamada/i }).click();
  await expect(page.getByText(/No tienes videollamadas disponibles/)).toBeVisible();

  await page.goto("/settings/plan");
  const section = page.locator("#videollamadas");
  await expect(section).toContainText("0 disponibles");
  await expect(section.getByRole("button", { name: "5 videollamadas · $45.000" })).toBeVisible();

  // Con saldo 1 inicia y la reserva retiene la videollamada mientras dura la consulta.
  await grantVideoCredits(clinicId, 1);
  await page.goto("/appointments");
  await page.getByRole("button", { name: /iniciar videollamada/i }).click();
  await expect(page).toHaveURL(/consultations\/.+\/live/);
  await expect(page.getByText(/videollamada en curso/i)).toBeVisible();

  await page.goto("/settings/plan");
  await expect(section).toContainText("0 disponibles");
  await expect(section).toContainText("1 reservada");

  // Daily avisa que el paciente se conectó: evento firmado contra la ruta real.
  const { data: appointment, error } = await service()
    .from("appointments")
    .select("id, video_room_name")
    .eq("clinic_id", clinicId)
    .single();
  if (error) throw error;
  const nowSec = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({
    version: "1.0.0",
    type: "participant.joined",
    id: `evt-e2e-${Date.now()}`,
    event_ts: nowSec,
    payload: {
      room: appointment.video_room_name,
      user_id: patientVideoUserId(appointment.id as string),
      user_name: "Paciente Video",
      session_id: "sesion-demo",
      joined_at: nowSec,
      owner: false,
    },
  });
  const timestamp = String(nowSec);
  const res = await page.request.post("/api/webhooks/daily", {
    headers: {
      "content-type": "application/json",
      "x-webhook-timestamp": timestamp,
      "x-webhook-signature": computeDailySignature({ timestamp, body, secret: E2E_DAILY_WEBHOOK_HMAC }),
    },
    data: body,
  });
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ result: "consumed" });

  await page.goto("/settings/plan");
  await expect(section).toContainText("0 disponibles");
  await expect(section).not.toContainText("reservada");
});

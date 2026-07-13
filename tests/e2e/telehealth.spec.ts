import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { signUpAndActivate } from "./helpers/signup";

const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

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

  // Token real, cita vigente dentro de la ventana horaria → arma la
  // videollamada del lado paciente (JoinCall).
  await patientPage.goto(`/join/${token}`);
  await expect(patientPage.getByRole("heading", { name: "Enlace no válido" })).not.toBeVisible();
  await expect(patientPage.getByRole("heading", { name: /Hola, Paciente Join/ })).toBeVisible();
  await expect(patientPage.getByText(/Esta llamada no se graba/)).toBeVisible();

  // La doctora cancela la cita: el mismo token deja de ser válido.
  await page.getByRole("button", { name: /Agendada/ }).click();
  await page.getByRole("menuitem", { name: "Cancelada" }).click();
  await expect(page.getByRole("button", { name: /Cancelada/ })).toBeVisible();

  await patientPage.goto(`/join/${token}`);
  await expect(patientPage.getByRole("heading", { name: "Enlace no válido" })).toBeVisible();

  await patientContext.close();
});

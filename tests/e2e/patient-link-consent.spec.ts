import { test, expect } from "@playwright/test";
import { signUpAndActivate } from "./helpers/signup";

const MAILPIT_URL = "http://127.0.0.1:54324";

async function getLatestLinkUrl(toEmail: string): Promise<string> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const searchRes = await fetch(
      `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${toEmail}`)}`,
    );
    const search = await searchRes.json();
    const messageId = search.messages?.[0]?.ID;
    if (messageId) {
      const msgRes = await fetch(`${MAILPIT_URL}/api/v1/message/${messageId}`);
      const msg = await msgRes.json();
      const match = /(https?:\/\/\S*\/enlace\/\S+)/.exec(msg.Text ?? "");
      if (match) return match[1].replace(/[).,]+$/, "");
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`No llegó el correo con link a ${toEmail}`);
}

test("link de consentimiento: generar, abrir sin sesión, firmar", async ({ page, browser }) => {
  const staffEmail = `linkstaff_${Date.now()}@e-irene.test`;
  const patientEmail = `linkpatient_${Date.now()}@e-irene.test`;

  await signUpAndActivate(page, { clinicName: "Clínica Links", fullName: "Dra. Links", email: staffEmail });

  await page.goto("/patients/new");
  await page.fill("#fullName", "Mateo Ríos");
  await page.fill("#email", patientEmail);
  await page.getByRole("button", { name: /crear paciente/i }).click();
  await expect(page.getByRole("heading", { name: "Mateo Ríos" })).toBeVisible();
  const patientUrl = page.url();

  await page.getByRole("button", { name: /generar link de consentimiento/i }).click();
  await expect(page.getByText(/link generado y enviado/i)).toBeVisible();

  const linkUrl = await getLatestLinkUrl(patientEmail);
  const relativeUrl = new URL(linkUrl).pathname;

  // Contexto de navegador nuevo, sin cookies de la sesión del personal: simula
  // que el paciente abre el correo en su propio dispositivo.
  const patientContext = await browser.newContext();
  const patientPage = await patientContext.newPage();
  await patientPage.goto(relativeUrl);
  await expect(patientPage.getByRole("heading", { name: "Consentimiento informado" })).toBeVisible();
  await expect(patientPage.getByText("Mateo Ríos")).toBeVisible();

  const canvas = patientPage.locator("canvas");
  await canvas.evaluate((el: HTMLCanvasElement) => {
    const r = el.getBoundingClientRect();
    const fire = (type: string, x: number, y: number) =>
      el.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          clientX: r.left + x,
          clientY: r.top + y,
        }),
      );
    fire("pointerdown", 60, 80);
    fire("pointermove", 200, 120);
    fire("pointerup", 200, 120);
  });
  await patientPage.check('input[name="accepted"]');
  await patientPage.getByRole("button", { name: /firmar consentimiento/i }).click();

  await expect(patientPage).toHaveURL(/\/enlace\/.+\/gracias$/);
  await expect(patientPage.getByText("¡Gracias!")).toBeVisible();

  // Reabrir el mismo link: ya debe mostrarse como usado.
  await patientPage.goto(relativeUrl);
  await expect(patientPage.getByText(/este enlace ya fue utilizado/i)).toBeVisible();
  await patientContext.close();

  // La ficha del paciente (personal, sesión original) ya muestra "Firmado".
  await page.goto(patientUrl);
  await expect(page.getByText("Firmado", { exact: true })).toBeVisible();
});

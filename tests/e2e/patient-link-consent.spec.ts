import { test, expect } from "@playwright/test";
import { signUpAndActivate } from "./helpers/signup";

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

  // Sin RESEND_API_KEY (como en este entorno), el link no sale por correo de
  // verdad — la app ya no lo simula en silencio (ver 99fcffe): avisa que hay
  // que compartirlo a mano y lo deja visible en pantalla, que es de donde se
  // toma acá (no de un inbox que nunca recibiría nada).
  const linkParagraph = page.getByText(/Compártelo tú \(no se envió por correo\):/i);
  await expect(linkParagraph).toBeVisible();
  const linkText = await linkParagraph.innerText();
  const linkUrl = linkText.match(/(https?:\/\/\S+)/)?.[1];
  if (!linkUrl) throw new Error("No se encontró el link generado en la página");
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
  // getByText resuelve dos nodos: el <h1> y el route-announcer de accesibilidad
  // de Next.js (también anuncia el texto de la página al navegar).
  await expect(patientPage.getByRole("heading", { name: "¡Gracias!" })).toBeVisible();

  // Reabrir el mismo link: ya debe mostrarse como usado.
  await patientPage.goto(relativeUrl);
  await expect(patientPage.getByText(/este enlace ya fue utilizado/i)).toBeVisible();
  await patientContext.close();

  // La ficha del paciente (personal, sesión original) ya muestra "Firmado".
  await page.goto(patientUrl);
  await expect(page.getByText("Firmado", { exact: true })).toBeVisible();
});

import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const MAILPIT_URL = "http://127.0.0.1:54324";
const SUPABASE_URL = "http://127.0.0.1:54321";

/**
 * Marca al profesional como verificado saltándose la subida de documentos y
 * la revisión manual (migración 0032): ningún spec de e2e ejercita ese flujo
 * en sí, así que hacerlo por UI en cada test solo agregaría pasos sin cubrir
 * nada nuevo. Mismo patrón que grantPlatformAdmin en platform-admin.spec.ts.
 */
async function verifyProfessional(email: string) {
  const admin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { error } = await admin
    .from("users")
    .update({ verification_status: "verified" })
    .eq("email", email);
  if (error) throw error;
}

/**
 * Busca en Mailpit (inbox local de dev) el código de activación de 6 dígitos
 * más reciente enviado a `email`. Reintenta porque el envío del correo es
 * asíncrono respecto al POST del signup.
 */
async function getActivationCode(email: string): Promise<string> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const searchRes = await fetch(
      `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    );
    const search = await searchRes.json();
    const messageId = search.messages?.[0]?.ID;
    if (messageId) {
      const msgRes = await fetch(`${MAILPIT_URL}/api/v1/message/${messageId}`);
      const msg = await msgRes.json();
      const match = /\b(\d{6})\b/.exec(msg.Text ?? "");
      if (match) return match[1];
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`No llegó el código de activación a ${email}`);
}

/**
 * Flujo completo de registro: llena el formulario de signup (sin contraseña),
 * toma el código de 6 dígitos del inbox local de Mailpit, lo ingresa para
 * activar la cuenta y fija la contraseña. Termina con la sesión ya
 * autenticada en /dashboard.
 */
export async function signUpAndActivate(
  page: Page,
  opts: { clinicName: string; fullName: string; email: string; password?: string },
) {
  const password = opts.password ?? "Password123!";

  await page.goto("/signup");
  await page.fill("#clinicName", opts.clinicName);
  await page.fill("#fullName", opts.fullName);
  await page.fill("#email", opts.email);
  await page.getByRole("button", { name: /crear cuenta/i }).click();
  await expect(page.getByText(/revisa tu correo/i)).toBeVisible();

  const code = await getActivationCode(opts.email);
  await page.fill("#code", code);
  await page.getByRole("button", { name: /confirmar código/i }).click();

  await expect(page).toHaveURL(/\/auth\/set-password/);
  await page.fill("#password", password);
  // La aceptación (Pieza 2) va en este mismo paso: es donde se crea la cuenta.
  await page.getByLabel(/declaro bajo la gravedad del juramento/i).check();
  await page.getByRole("button", { name: /crear cuenta y entrar/i }).click();

  // Este POST hace todo el registro y además renderiza /dashboard (el redirect
  // del server action viaja en la misma respuesta). Con la máquina cargada, el
  // dev server tiene picos: medido con 10 procesos de CPU en paralelo, un POST
  // tardó 16,1 s, de los cuales el action fueron 2,1 s y el render de
  // /dashboard 14 s, aunque para una clínica nueva sus consultas ya van en
  // paralelo y casi no traen filas. Con los 10 s por defecto, en una corrida
  // completa fallaron 2 de las 21 specs que usan este helper. Se da margen solo
  // a esta espera, y se suma al presupuesto del test para no comerse el de los
  // pasos siguientes.
  const dashboardTimeout = 25_000;
  test.info().setTimeout(test.info().timeout + dashboardTimeout);
  // Si aun así falla, el error dice qué mostró el formulario: un error del
  // server action, un error de campo, o el botón aún en "Creando tu cuenta…".
  try {
    await expect(page).toHaveURL(/\/dashboard/, { timeout: dashboardTimeout });
  } catch (error) {
    const messages = await page
      .locator("form .landing-form-error, form .landing-field-error")
      .allTextContents();
    const button = (await page.locator("form button[type=submit]").textContent())?.trim();
    throw new Error(
      `El registro no llegó a /dashboard (URL: ${page.url()}). ` +
        `Errores visibles del formulario: ${messages.length ? messages.join(" | ") : "ninguno"}. ` +
        `Botón: "${button}".`,
      { cause: error },
    );
  }

  await verifyProfessional(opts.email);
}

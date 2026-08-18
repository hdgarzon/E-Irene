import { expect, type Page } from "@playwright/test";
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
  await page.getByRole("button", { name: /guardar y entrar/i }).click();

  // Sin aceptación vigente de la política, el layout de (app) redirige aquí
  // (ver app/(app)/layout.tsx) — cubre por igual a quien se registra que a
  // quien un admin da de alta directo, así que toda cuenta nueva pasa por acá.
  await expect(page).toHaveURL(/\/terminos/);
  await page.getByLabel(/he leído y acepto/i).check();
  await page.getByRole("button", { name: /aceptar y continuar/i }).click();

  await expect(page).toHaveURL(/\/dashboard/);

  await verifyProfessional(opts.email);
}

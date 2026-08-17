import { expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const MAILPIT_URL = "http://127.0.0.1:54324";
const SUPABASE_URL = "http://127.0.0.1:54321";

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
 * Marca al usuario recién creado como profesional verificado, saltándose la
 * cola de revisión manual (migración 0032). No hay flujo de autoservicio para
 * esto por diseño: la aprobación es tarea exclusiva del admin de plataforma
 * con service-role (el trigger `enforce_verification_transition` bloquea
 * incluso a un admin de clínica editando su propia fila). Sin este atajo,
 * cada spec que crea pacientes/citas/consultas tendría que simular además el
 * flujo de carga de documentos + revisión — fuera del alcance de lo que esos
 * specs prueban.
 */
async function verifyProfessional(email: string): Promise<void> {
  const admin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const {
    data: { users },
  } = await admin.auth.admin.listUsers();
  const user = users.find((u) => u.email === email);
  if (!user) throw new Error(`No se encontró el usuario ${email} para verificarlo`);

  const { error } = await admin
    .from("users")
    .update({ verification_status: "verified", verification_decided_at: new Date().toISOString() })
    .eq("id", user.id);
  if (error) throw error;
}

/**
 * Flujo completo de registro: llena el formulario de signup (sin contraseña),
 * toma el código de 6 dígitos del inbox local de Mailpit, lo ingresa para
 * activar la cuenta y fija la contraseña. Acepta la política de privacidad y
 * queda verificado como profesional (ver `verifyProfessional`). Termina con
 * la sesión ya autenticada en /dashboard y con acceso clínico completo.
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

  // Toda cuenta nueva llega sin aceptación vigente de la política de privacidad
  // y el layout de (app) la manda a /terminos (ver app/(app)/layout.tsx). No es
  // un paso opcional del signup ni un bug: es la compuerta de consentimiento por
  // diseño (Ley 1581), obligatoria antes de cualquier acceso a /dashboard.
  await expect(page).toHaveURL(/\/terminos/);
  await page.locator('input[name="accepted"]').check();
  await page.getByRole("button", { name: /aceptar y continuar/i }).click();

  await expect(page).toHaveURL(/\/dashboard/);

  await verifyProfessional(opts.email);
}

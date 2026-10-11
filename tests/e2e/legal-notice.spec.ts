import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { signUpAndActivate } from "./helpers/signup";

const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Política, sección 10; Vinculación, cláusula décima: el aviso de un cambio se
// ve en la plataforma hasta que entra en vigor.
test("aviso de cambios legales visible en la app hasta su vigencia", async ({ page }) => {
  const title = `Actualización de prueba ${Date.now()}`;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { error } = await admin.from("legal_notices").insert({
    title,
    body: "Cambia el plazo de respuesta de las consultas.",
    effective_at: new Date(Date.now() + 40 * 86_400_000).toISOString(),
  });
  expect(error).toBeNull();

  await signUpAndActivate(page, {
    clinicName: "Clínica Aviso",
    fullName: "Dra. Demo",
    email: `aviso_${Date.now()}@e-irene.test`,
  });
  await expect(page.getByText(title)).toBeVisible();
  await expect(page.getByText(/puedes terminar sin penalidad antes de esa fecha/i).first()).toBeVisible();

  // Sin esto, el aviso quedaría visible en toda la app local durante 40 días.
  await admin.from("legal_notices").delete().eq("title", title);
});

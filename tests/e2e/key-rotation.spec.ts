import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { signUpAndActivate } from "./helpers/signup";

const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

test("rotación de clave: el admin de plataforma ve el estado desde Configuración", async ({ page }) => {
  const email = `keyrot_${Date.now()}@e-irene.test`;
  await signUpAndActivate(page, { clinicName: "Clínica Clave", fullName: "Admin Demo", email });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: user } = await admin.from("users").select("id").eq("email", email).single();
  await admin.from("platform_admins").insert({ user_id: user!.id });

  await page.goto("/admin/configuracion");
  await expect(page.getByText("ENCRYPTION_KEY_NEXT", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: /rotación de la clave de cifrado/i }).click();
  await expect(page).toHaveURL(/\/admin\/rotacion-clave$/);
  await expect(page.getByText(/Clave activa:/)).toBeVisible();
  await expect(page.getByText(/sin rotación en curso/)).toBeVisible();
});

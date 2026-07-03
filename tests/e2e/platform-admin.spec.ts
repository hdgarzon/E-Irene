import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { signUpAndActivate } from "./helpers/signup";

const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

test("admin de plataforma: no accesible por defecto, solo tras concederlo directamente en BD", async ({
  page,
}) => {
  const stamp = Date.now();
  const email = `platformadmin_${stamp}@e-irene.test`;
  const clinicName = `Clínica Admin Test ${stamp}`;
  await signUpAndActivate(page, { clinicName, fullName: "Dra. Admin Test", email });

  // Sin ser platform admin: /admin redirige a /dashboard
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/dashboard/);

  // Se concede el rol directamente en la tabla (sin ningún endpoint de la
  // app para hacerlo — la única forma soportada).
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const {
    data: { users },
  } = await admin.auth.admin.listUsers();
  const user = users.find((u) => u.email === email);
  expect(user).toBeTruthy();
  const { error } = await admin.from("platform_admins").insert({ user_id: user!.id });
  expect(error).toBeNull();

  // Ahora sí ve el panel — con datos de negocio, no clínicos
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin/);
  await expect(page.getByRole("heading", { name: "Clínicas registradas" })).toBeVisible();
  await expect(page.getByText(clinicName)).toBeVisible();
});

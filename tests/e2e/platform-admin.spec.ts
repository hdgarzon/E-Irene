import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { signUpAndActivate } from "./helpers/signup";

const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function grantPlatformAdmin(email: string) {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const {
    data: { users },
  } = await admin.auth.admin.listUsers();
  const user = users.find((u) => u.email === email);
  expect(user).toBeTruthy();
  const { error } = await admin.from("platform_admins").insert({ user_id: user!.id });
  expect(error).toBeNull();
}

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

  // Se concede el rol directamente en la tabla (sin ningún endpoint de la app).
  await grantPlatformAdmin(email);

  // Ahora sí ve la consola — con datos de negocio, no clínicos
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin/);
  await expect(page.getByRole("heading", { name: "Resumen de la plataforma" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Uso de plataforma" })).toBeVisible();
  await page.goto("/admin/clinicas");
  await expect(page.getByText(clinicName)).toBeVisible();
});

test("admin de plataforma: suspender una clínica bloquea su acceso y es reversible", async ({
  browser,
}) => {
  const stamp = Date.now();

  // Clínica maestra (será platform admin), en su propio contexto.
  const adminCtx = await browser.newContext();
  const adminPage = await adminCtx.newPage();
  const adminEmail = `master_${stamp}@e-irene.test`;
  await signUpAndActivate(adminPage, {
    clinicName: `Clínica Maestra ${stamp}`,
    fullName: "Dra. Maestra",
    email: adminEmail,
  });
  await grantPlatformAdmin(adminEmail);

  // Clínica objetivo (será suspendida), en un contexto separado para que ambas
  // sesiones queden activas al mismo tiempo.
  const targetCtx = await browser.newContext();
  const targetPage = await targetCtx.newPage();
  const targetClinic = `Clínica Objetivo ${stamp}`;
  await signUpAndActivate(targetPage, {
    clinicName: targetClinic,
    fullName: "Dr. Objetivo",
    email: `objetivo_${stamp}@e-irene.test`,
  });
  await expect(targetPage).toHaveURL(/\/dashboard/);

  // El maestro suspende la clínica objetivo desde su tarjeta.
  await adminPage.goto("/admin/clinicas");
  const card = adminPage.locator("[data-testid=clinic-card]", { hasText: targetClinic });
  await card.getByRole("button", { name: /suspender/i }).click();
  await expect(card.getByText("Suspendida")).toBeVisible();

  // La clínica objetivo queda bloqueada al intentar entrar a la app.
  await targetPage.goto("/dashboard");
  await expect(targetPage).toHaveURL(/\/suspendida/);
  await expect(targetPage.getByRole("heading", { name: "Cuenta suspendida" })).toBeVisible();

  // El maestro la reactiva.
  await adminPage.goto("/admin/clinicas");
  const cardAgain = adminPage.locator("[data-testid=clinic-card]", { hasText: targetClinic });
  await cardAgain.getByRole("button", { name: /reactivar/i }).click();
  await expect(cardAgain.getByRole("button", { name: /suspender/i })).toBeVisible();

  // Vuelve a tener acceso.
  await targetPage.goto("/dashboard");
  await expect(targetPage).toHaveURL(/\/dashboard/);

  // El maestro cambia el plan de la clínica objetivo y persiste tras recargar.
  await adminPage.goto("/admin/clinicas");
  const cardPlan = adminPage.locator("[data-testid=clinic-card]", { hasText: targetClinic });
  await Promise.all([
    adminPage.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/admin/clinicas")),
    cardPlan.locator("select").selectOption("pro"),
  ]);
  await adminPage.goto("/admin/clinicas");
  await expect(
    adminPage.locator("[data-testid=clinic-card]", { hasText: targetClinic }).locator("select"),
  ).toHaveValue("pro");

  await adminCtx.close();
  await targetCtx.close();
});

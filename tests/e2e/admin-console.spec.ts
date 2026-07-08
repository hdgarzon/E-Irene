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
  const { error } = await admin.from("platform_admins").insert({ user_id: user!.id });
  expect(error).toBeNull();
}

test("consola de admin: tabs, gestión de citas/planes y acceso directo (sin PHI)", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const stamp = Date.now();
  const email = `console_${stamp}@e-irene.test`;
  const clinicName = `Clínica Console ${stamp}`;
  const doctorName = `Dra. Console ${stamp}`;
  await signUpAndActivate(page, { clinicName, fullName: doctorName, email });

  // Datos: un paciente y una cita (creados por el admin de la clínica, no por
  // el super-admin, que ya no tiene acceso a pacientes — ver migración 0015).
  await page.goto("/patients/new");
  await page.fill("#fullName", "Paciente Console");
  await page.fill("#phone", "3001112222");
  await page.getByRole("button", { name: /crear paciente/i }).click();
  await expect(page.getByRole("heading", { name: "Paciente Console" })).toBeVisible();

  await page.goto("/appointments/new");
  await page.selectOption("#patientId", { label: "Paciente Console" });
  await page.fill("#scheduledAt", "2030-03-10T09:00");
  await page.getByRole("button", { name: /agendar cita/i }).click();
  await expect(page).toHaveURL(/\/appointments$/);

  // Se concede platform admin.
  await grantPlatformAdmin(email);

  // Resumen (KPIs).
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Resumen de la plataforma" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Uso de plataforma" })).toBeVisible();

  // Clínicas: la clínica y su doctora en el mapa (dentro de su propia tarjeta,
  // para no depender de datos de otras clínicas en la BD local).
  await page.goto("/admin/clinicas");
  const card = page.locator('[data-testid="clinic-card"]', { hasText: clinicName });
  await expect(card).toBeVisible();
  await expect(card.getByText(doctorName)).toBeVisible();

  // Doctores: editar el nombre.
  await page.goto("/admin/doctores");
  const doctorRow = page.locator("tr", { hasText: doctorName });
  await expect(doctorRow).toBeVisible();
  await doctorRow.getByRole("button", { name: /editar/i }).click();
  await page.locator('input[name="fullName"]').fill(`${doctorName} Editada`);
  await page.getByRole("button", { name: /guardar/i }).click();
  await expect(page.getByText(`${doctorName} Editada`)).toBeVisible();

  // La sección /admin/pacientes ya NO existe: el super-admin no gestiona
  // pacientes (cumplimiento Habeas Data). No debe haber enlace en la nav.
  await expect(page.getByRole("link", { name: "Pacientes" })).toHaveCount(0);

  // Citas: la cita aparece y se puede cambiar de estado, PERO sin exponer el
  // nombre del paciente (PHI). Se identifica por la fila de la cita, no por el
  // paciente.
  await page.goto("/admin/citas");
  const apptRow = page.locator("tbody tr").first();
  await expect(apptRow).toBeVisible();
  await expect(page.getByText("Paciente Console")).toHaveCount(0);
  await apptRow.locator("select").selectOption("completed");
  await expect(apptRow.locator("select")).toHaveValue("completed");

  // Planes: editar el precio del plan Free.
  await page.goto("/admin/planes");
  const freeForm = page.locator("form", { hasText: "free" }).first();
  await freeForm.locator('input[name="price"]').fill("$0 / siempre");
  await freeForm.getByRole("button", { name: /guardar/i }).click();
  await expect(freeForm.getByText("Guardado")).toBeVisible();

  // Configuración: referencia de variables.
  await page.goto("/admin/configuracion");
  await expect(page.getByRole("heading", { name: "Configuración" })).toBeVisible();
  await expect(page.getByText("OPENAI_API_KEY")).toBeVisible();

  // Acceso directo: cerrar sesión y volver a entrar → aterriza en /admin.
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", "Password123!");
  await page.getByRole("button", { name: /iniciar sesión/i }).click();
  await expect(page).toHaveURL(/\/admin$/);
});

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

  // Las listas de la consola se paginan en la BD, y la BD local acumula
  // clínicas y cuentas de otras corridas: la entidad recién creada no tiene por
  // qué caer en la primera página. Se busca, como lo haría el admin.

  // Clínicas: sin búsqueda, el encabezado dice el total y qué se muestra.
  await page.goto("/admin/clinicas");
  await expect(page.getByTestId("list-summary")).toContainText(/clínicas? en total · mostrando 1–/);
  await page.getByRole("searchbox", { name: "Buscar clínica" }).fill(clinicName);
  await page.getByRole("button", { name: "Buscar" }).click();
  await expect(page).toHaveURL(/\/admin\/clinicas\?q=/);
  await expect(page.getByTestId("list-summary")).toContainText(
    new RegExp(`^1 de \\d+ clínicas? coincide con "${clinicName}"`),
  );
  // La clínica y su doctora en el mapa, dentro de su propia tarjeta.
  const card = page.locator('[data-testid="clinic-card"]', { hasText: clinicName });
  await expect(card).toBeVisible();
  await expect(card.getByText(doctorName)).toBeVisible();

  // Doctores: buscar y editar el nombre. Las filas de personal son <li> (no
  // <tr>); se acota a la fila del doctor de esta clínica (nombre único por
  // corrida). El input de edición solo existe en la fila que está en modo
  // edición, así que se puede localizar sin ambigüedad tras hacer clic en
  // "Editar". El nombre editado contiene el buscado: sigue en el resultado.
  await page.goto("/admin/doctores");
  await page.getByRole("searchbox", { name: "Buscar profesional" }).fill(doctorName);
  await page.getByRole("button", { name: "Buscar" }).click();
  // El encabezado repite el texto buscado: las aserciones se acotan a la fila.
  await expect(page.getByTestId("list-summary")).toContainText(/^1 de \d+ cuentas? de profesional/);
  const staffRow = page.locator("li", { hasText: doctorName });
  await expect(staffRow).toHaveCount(1);
  await staffRow.getByRole("button", { name: /editar/i }).click();
  await page.locator('input[name="fullName"]').fill(`${doctorName} Editada`);
  await page.getByRole("button", { name: /guardar/i }).click();
  await expect(page.locator("li", { hasText: `${doctorName} Editada` })).toBeVisible();

  // La sección /admin/pacientes ya NO existe: el super-admin no gestiona
  // pacientes (cumplimiento Habeas Data). No debe haber enlace en la nav.
  await expect(page.getByRole("link", { name: "Pacientes" })).toHaveCount(0);

  // Citas: la cita aparece y se puede cambiar de estado, PERO sin exponer el
  // nombre del paciente (PHI). Se busca por clínica y se identifica por la fila
  // de la cita, no por el paciente.
  await page.goto(`/admin/citas?q=${encodeURIComponent(clinicName)}`);
  const apptRow = page.locator("tbody tr", { hasText: clinicName });
  await expect(apptRow).toHaveCount(1);
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

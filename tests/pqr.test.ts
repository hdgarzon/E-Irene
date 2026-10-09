import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { pqrDueDate } from "@/lib/pqr";

// Guarda de entorno: importar esto aborta la corrida si NEXT_PUBLIC_SUPABASE_URL
// no apunta a un stack local. Estas pruebas escriben con service-role.
import "./helpers/supabase-env";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const d = URL && ANON && SERVICE ? describe : describe.skip;

function anon(): SupabaseClient {
  return createClient(URL!, ANON!, { auth: { autoRefreshToken: false, persistSession: false } });
}
function service(): SupabaseClient {
  return createClient(URL!, SERVICE!, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function cuenta(nombre: string) {
  const client = anon();
  const email = `pqr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@e-irene.test`;
  const { data, error } = await client.auth.signUp({ email, password: "Password123!" });
  expect(error).toBeNull();
  await client.rpc("create_clinic_and_admin", { clinic_name: nombre, full_name: "Doctor PQR" });
  return { client, userId: data.user!.id };
}

/** Radica una PQR como lo hace la Server Action pública (service-role). */
async function radicar(extra: Record<string, unknown> = {}) {
  const { data, error } = await service()
    .from("pqr_requests")
    .insert({
      kind: "reclamo",
      full_name: "Paciente Demo",
      email: "paciente@example.com",
      message: "No me llegó la factura del último mes.",
      ...extra,
    })
    .select("id, radicado, created_at, status")
    .single();
  expect(error).toBeNull();
  return data!;
}

describe("plazo de respuesta de una PQR", () => {
  it("son 15 días hábiles desde la radicación, sin festivos", () => {
    expect(pqrDueDate("2026-10-09T15:00:00Z")).toBe("2026-11-03");
  });
});

d("PQR con radicado (migración 0061)", () => {
  let doctor: Awaited<ReturnType<typeof cuenta>>;
  let admin: Awaited<ReturnType<typeof cuenta>>;

  beforeAll(async () => {
    doctor = await cuenta("PQR Doctor");
    admin = await cuenta("PQR Admin");
    const { error } = await service().from("platform_admins").insert({ user_id: admin.userId });
    expect(error).toBeNull();
  }, 30000);

  it("asigna un radicado PQR-AAAA-NNNNNN consecutivo", async () => {
    const a = await radicar();
    const b = await radicar();
    const year = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric" }).format(
      new Date(),
    );
    expect(a.radicado).toMatch(new RegExp(`^PQR-${year}-\\d{6}$`));
    expect(Number(b.radicado.slice(-6))).toBeGreaterThan(Number(a.radicado.slice(-6)));
    expect(a.status).toBe("radicada");
  });

  it("ignora el radicado y la fecha que mande quien inserta", async () => {
    const p = await radicar({ radicado: "PQR-1999-000001", created_at: "1999-01-01T00:00:00Z" });
    expect(p.radicado).not.toBe("PQR-1999-000001");
    expect(new Date(p.created_at).getFullYear()).toBeGreaterThan(2000);
  });

  it("nadie sin sesión ni un profesional cualquiera puede radicar ni leer", async () => {
    const p = await radicar();
    const inserto = await anon()
      .from("pqr_requests")
      .insert({ kind: "queja", full_name: "X", email: "x@example.com", message: "Intento directo" });
    expect(inserto.error).not.toBeNull();

    for (const client of [anon(), doctor.client]) {
      const { data } = await client.from("pqr_requests").select("id").eq("id", p.id);
      expect(data ?? []).toHaveLength(0);
    }
  });

  it("el admin de plataforma la lee y cambia su estado", async () => {
    const p = await radicar();
    const { data } = await admin.client.from("pqr_requests").select("id").eq("id", p.id);
    expect(data).toHaveLength(1);

    const { error } = await admin.client
      .from("pqr_requests")
      .update({ status: "respondida", responded_at: new Date().toISOString() })
      .eq("id", p.id);
    expect(error).toBeNull();
  });

  it("la constancia de presentación no se modifica, ni con service-role", async () => {
    const p = await radicar();
    for (const cambio of [{ radicado: "PQR-2026-999999" }, { message: "Otro texto" }, { created_at: new Date().toISOString() }]) {
      const { error } = await service().from("pqr_requests").update(cambio).eq("id", p.id);
      expect(error?.message).toMatch(/constancia de presentación/);
    }
  });
});

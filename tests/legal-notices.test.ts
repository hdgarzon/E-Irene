import { describe, it, expect, vi, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { earliestEffectiveDate, hasEnoughNotice } from "@/lib/legal-notices";

// Guarda de entorno: importar esto aborta la corrida si NEXT_PUBLIC_SUPABASE_URL
// no apunta a un stack local.
import "./helpers/supabase-env";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const d = URL && ANON && SERVICE ? describe : describe.skip;

function anon(): SupabaseClient {
  return createClient(URL!, ANON!, { auth: { autoRefreshToken: false, persistSession: false } });
}
function svc(): SupabaseClient {
  return createClient(URL!, SERVICE!, { auth: { autoRefreshToken: false, persistSession: false } });
}

describe("antelación de los avisos legales (15 días hábiles)", () => {
  it("lo más pronto es el día siguiente al decimoquinto hábil, sin fines de semana ni festivos", () => {
    // Viernes 9-oct-2026: el 15.º hábil es el martes 3-nov (12-oct y 2-nov festivos).
    const now = new Date("2026-10-09T15:00:00Z");
    expect(earliestEffectiveDate(now)).toBe("2026-11-04");
    expect(hasEnoughNotice("2026-11-04", now)).toBe(true);
    expect(hasEnoughNotice("2026-11-03", now)).toBe(false);
  });
});

async function cuenta(nombre: string) {
  const client = anon();
  const email = `notice_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@e-irene.test`;
  const { data, error } = await client.auth.signUp({ email, password: "Password123!" });
  expect(error).toBeNull();
  await client.rpc("create_clinic_and_admin", { clinic_name: nombre, full_name: "Doctor Demo" });
  return { client, userId: data.user!.id, email };
}

const futuro = () => new Date(Date.now() + 40 * 86_400_000).toISOString();

d("avisos legales (migración 0065)", () => {
  // Los avisos de prueba tienen vigencia futura: sin limpiar, se verían en toda
  // la app local.
  afterAll(async () => {
    await svc().from("legal_notices").delete().in("title", ["Intento", "Cambio de prueba", "Inmutable", "Envío"]);
  });

  it("solo el admin de plataforma publica; cualquier usuario con sesión los lee", async () => {
    const doctor = await cuenta("Aviso Doctor");
    const { error: denied } = await doctor.client
      .from("legal_notices")
      .insert({ title: "Intento", body: "No debería poder", effective_at: futuro() });
    expect(denied).not.toBeNull();

    const admin = await cuenta("Aviso Admin");
    await svc().from("platform_admins").insert({ user_id: admin.userId });
    const { data: created, error } = await admin.client
      .from("legal_notices")
      .insert({ title: "Cambio de prueba", body: "Texto del cambio de prueba.", effective_at: futuro() })
      .select("id")
      .single();
    expect(error).toBeNull();

    const { data: visto } = await doctor.client.from("legal_notices").select("id").eq("id", created!.id);
    expect(visto).toHaveLength(1);
    const { data: sinSesion } = await anon().from("legal_notices").select("id").eq("id", created!.id);
    expect(sinSesion ?? []).toHaveLength(0);
  }, 30000);

  it("el contenido no se edita y la constancia de envío, una vez fijada, tampoco", async () => {
    const { data: n } = await svc()
      .from("legal_notices")
      .insert({ title: "Inmutable", body: "Texto original del aviso.", effective_at: futuro() })
      .select("id")
      .single();
    const { error: edit } = await svc().from("legal_notices").update({ body: "Otro" }).eq("id", n!.id);
    expect(edit?.message).toMatch(/no se modifica/);

    const { error: send } = await svc()
      .from("legal_notices")
      .update({ emailed_at: new Date().toISOString(), emailed_count: 3 })
      .eq("id", n!.id);
    expect(send).toBeNull();
    const { error: again } = await svc().from("legal_notices").update({ emailed_count: 99 }).eq("id", n!.id);
    expect(again?.message).toMatch(/ya enviado/);
  }, 30000);

  it("el envío por correo llega al personal y deja la constancia una sola vez", async () => {
    const destinatario = await cuenta("Aviso Destino");
    const { emailLegalNotice } = await import("@/lib/db/legal-notices");
    const providers = await import("@/lib/email/providers");
    const enviados: string[] = [];
    vi.spyOn(providers, "getEmailProvider").mockReturnValue({
      mode: "log",
      send: async (m) => {
        enviados.push(m.to);
        return { id: "x" };
      },
    });

    const { data: n } = await svc()
      .from("legal_notices")
      .insert({ title: "Envío", body: "Texto del aviso para enviar.", effective_at: futuro() })
      .select("id")
      .single();
    const result = await emailLegalNotice(n!.id);
    expect(result.failed).toBe(0);
    expect(enviados).toContain(destinatario.email);

    const { data: row } = await svc().from("legal_notices").select("emailed_at, emailed_count").eq("id", n!.id).single();
    expect(row!.emailed_at).not.toBeNull();
    expect(row!.emailed_count).toBe(result.sent);
    await expect(emailLegalNotice(n!.id)).rejects.toThrow(/ya se envió/);
    vi.restoreAllMocks();
  }, 60000);
});

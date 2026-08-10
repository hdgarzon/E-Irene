import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { statusForDeliveryMode, isSimulatedMode, sentAtFor } from "@/lib/db/notifications";

/**
 * `notifications` es el registro con el que una clínica acreditaría haber
 * contactado al paciente — por ejemplo, haberle enviado el enlace para firmar
 * su consentimiento. Antes registraba 'sent' aunque el proveedor estuviera en
 * modo log y no hubiera salido nada.
 */
describe("estado de notificación según el modo del proveedor", () => {
  it("modo log NO se registra como enviado", () => {
    expect(statusForDeliveryMode("log")).toBe("simulated");
  });

  it("los proveedores reales sí se registran como enviados", () => {
    expect(statusForDeliveryMode("resend")).toBe("sent");
    expect(statusForDeliveryMode("twilio")).toBe("sent");
  });

  it("un modo desconocido se considera envío real, no simulado", () => {
    // Lo peligroso es marcar como enviado lo que no salió, no al revés: un
    // proveedor nuevo entra como 'sent' y se corrige si hace falta.
    expect(statusForDeliveryMode("proveedor-futuro")).toBe("sent");
  });

  it("isSimulatedMode solo es cierto para el modo log", () => {
    expect(isSimulatedMode("log")).toBe(true);
    expect(isSimulatedMode("resend")).toBe(false);
    expect(isSimulatedMode("twilio")).toBe(false);
  });
});

describe("marca temporal de envío", () => {
  it("solo un envío real lleva sent_at", () => {
    expect(sentAtFor("sent")).not.toBeNull();
  });

  it("una notificación simulada NO lleva sent_at: no hubo envío que fechar", () => {
    expect(sentAtFor("simulated")).toBeNull();
  });

  it("pendiente y fallida tampoco", () => {
    expect(sentAtFor("pending")).toBeNull();
    expect(sentAtFor("failed")).toBeNull();
  });

  it("la cadena de un envío real es una fecha ISO válida", () => {
    expect(Number.isNaN(Date.parse(sentAtFor("sent")!))).toBe(false);
  });
});

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const d = URL && SERVICE ? describe : describe.skip;

function svc() {
  return createClient(URL!, SERVICE!, { auth: { autoRefreshToken: false, persistSession: false } });
}

d("notifications: 'simulated' en la base (migración 0036)", () => {
  async function clinica() {
    const { data } = await svc()
      .from("clinics")
      .insert({ name: "Notif Test", slug: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` })
      .select("id")
      .single();
    return data!.id as string;
  }

  it("acepta el valor 'simulated'", async () => {
    const clinicId = await clinica();
    const { error } = await svc().from("notifications").insert({
      clinic_id: clinicId,
      type: "consent_link_sent",
      status: "simulated",
      payload: { mode: "log" },
    });
    expect(error).toBeNull();
  });

  it("los estados anteriores siguen siendo válidos", async () => {
    const clinicId = await clinica();
    for (const status of ["pending", "sent", "failed"] as const) {
      const { error } = await svc()
        .from("notifications")
        .insert({ clinic_id: clinicId, type: "appointment_reminder", status });
      expect(error).toBeNull();
    }
  });
});

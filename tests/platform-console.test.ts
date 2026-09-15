import { describe, it, expect, vi, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { encrypt } from "@/lib/crypto";
import {
  CLINICS_PAGE_SIZE,
  getClinicMap,
  listAllAppointments,
  listAllStaff,
} from "@/lib/db/platform-console";
import { getPlatformTotals } from "@/lib/db/platform-admin";
import { listVerificationQueue, type PendingVerification } from "@/lib/db/verification";
import {
  LEGACY_VERIFICATION_NOTE_PREFIX,
  isAwaitingReview,
  legacyVerificationState,
} from "@/lib/verification";

// Guarda de entorno: importar esto aborta la corrida si NEXT_PUBLIC_SUPABASE_URL
// no apunta a un stack local. Estas pruebas escriben con service-role y algunas
// purgan datos clínicos: contra producción serían destructivas.
import "./helpers/supabase-env";

/**
 * Listas de la consola del admin de plataforma contra un Supabase local:
 * paginación y conteos en BD (PostgREST corta en 1000 filas sin avisar),
 * búsqueda literal, y que el admin siga sin ver datos de pacientes (migraciones
 * 0015 y 0051). Igual que rls.test.ts, solo corre con el stack local levantado.
 *
 * Las funciones de lib/db usan el cliente de sesión (cookies de Next). Aquí esa
 * sesión es la de un platform admin de prueba: mismo JWT y mismas políticas RLS
 * que en la app.
 *
 * La BD local acumula datos de otras corridas y otros archivos corren en
 * paralelo: cada caso busca por una marca única de esta corrida y compara los
 * totales contra un conteo tomado antes y otro después.
 */
const session = vi.hoisted(() => ({ client: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    if (!session.client) throw new Error("Prueba sin sesión asignada");
    return session.client;
  },
}));

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const d = URL && ANON && SERVICE ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);

// Cada alta pasa por Auth y tarda segundos en el stack local, más si otros
// archivos lo están usando a la vez: el tope por defecto (10 s) no alcanza.
const LENTO = { timeout: 60_000 };

function anon(): SupabaseClient {
  return createClient(URL!, ANON!, { auth: { autoRefreshToken: false, persistSession: false } });
}

function service(): SupabaseClient {
  return createClient(URL!, SERVICE!, { auth: { autoRefreshToken: false, persistSession: false } });
}

interface Cuenta {
  client: SupabaseClient;
  clinicId: string;
  userId: string;
  email: string;
}

/** Clínica nueva con su admin, registrada como en la app. */
async function registrarClinica(clinicName: string, fullName: string): Promise<Cuenta> {
  const client = anon();
  const email = `consola_${RUN}_${Math.random().toString(36).slice(2, 8)}@e-irene.test`;
  const { data: signUp, error } = await client.auth.signUp({ email, password: "Password123!" });
  expect(error).toBeNull();
  const { data: clinicId, error: rpcErr } = await client.rpc("create_clinic_and_admin", {
    clinic_name: clinicName,
    full_name: fullName,
  });
  expect(rpcErr).toBeNull();
  return { client, clinicId: clinicId as string, userId: signUp.user!.id, email };
}

async function pacienteDemo(clinicId: string): Promise<string> {
  const { data, error } = await service()
    .from("patients")
    .insert({ clinic_id: clinicId, full_name_enc: encrypt("Paciente Demo") })
    .select("id")
    .single();
  expect(error).toBeNull();
  return data!.id as string;
}

/** Conteo exacto con service-role; `sinPacientes` lo acota al personal, como la consola. */
async function contar(table: string, { sinPacientes = false } = {}): Promise<number> {
  const query = service().from(table).select("id", { count: "exact", head: true });
  const { count, error } = await (sinPacientes ? query.neq("role", "paciente") : query);
  expect(error).toBeNull();
  return count!;
}

d("consola del admin de plataforma: listas paginadas en BD", () => {
  let admin: Cuenta;

  beforeAll(async () => {
    admin = await registrarClinica(`Clínica Consola ${RUN}`, `Admin Consola ${RUN}`);
    const { error } = await service().from("platform_admins").insert({ user_id: admin.userId });
    expect(error).toBeNull();
    session.client = admin.client;
  }, LENTO.timeout);

  it("las funciones de conteo nuevas se niegan a quien no es platform admin", LENTO, async () => {
    const ajena = await registrarClinica(`Clínica Ajena ${RUN}`, "Doctor Ajeno");

    const totals = await ajena.client.rpc("get_platform_totals");
    expect(totals.error?.message).toMatch(/No autorizado/);
    const stats = await ajena.client.rpc("get_platform_clinic_stats", {
      p_clinic_ids: [ajena.clinicId],
    });
    expect(stats.error?.message).toMatch(/No autorizado/);
    const sinSesion = await anon().rpc("get_platform_totals");
    expect(sinSesion.error).not.toBeNull();
  });

  it("los conteos por clínica tienen tope: una lista sin límite volvería a truncarse", async () => {
    const ids = Array.from({ length: 101 }, () => randomUUID());
    const { error } = await admin.client.rpc("get_platform_clinic_stats", { p_clinic_ids: ids });
    expect(error?.message).toMatch(/Demasiadas clínicas/);
  });

  it("resumen: los totales vienen contados en la BD", async () => {
    const antes = await contar("clinics");
    const totals = await getPlatformTotals();
    const despues = await contar("clinics");

    expect(totals.clinics).toBeGreaterThanOrEqual(antes);
    expect(totals.clinics).toBeLessThanOrEqual(despues);
  });

  it("clínicas: cada página trae solo su rango, sin repetir ni saltar, y la página se acota", LENTO, async () => {
    const marca = `Paginada ${RUN}`;
    const cuantas = CLINICS_PAGE_SIZE + 1;
    // Inserción directa: 21 altas por signup harían lenta la prueba sin cubrir
    // nada más. Van en una sola transacción, con el mismo created_at: el orden
    // estable depende del desempate por id.
    const { error } = await service()
      .from("clinics")
      .insert(
        Array.from({ length: cuantas }, (_, i) => ({
          name: `Clínica ${marca} ${String(i).padStart(2, "0")}`,
          slug: `paginada-${RUN}-${i}`,
        })),
      );
    expect(error).toBeNull();

    const antes = await contar("clinics");
    const primera = await getClinicMap({ query: marca, page: 1 });
    const segunda = await getClinicMap({ query: marca, page: 2 });
    const despues = await contar("clinics");

    expect(primera.matched).toBe(cuantas);
    expect(primera.items).toHaveLength(CLINICS_PAGE_SIZE);
    expect(segunda.items).toHaveLength(1);
    expect(primera.total).toBeGreaterThanOrEqual(antes);
    expect(primera.total).toBeLessThanOrEqual(despues);

    const ids = new Set([...primera.items, ...segunda.items].map((c) => c.clinicId));
    expect(ids.size).toBe(cuantas);

    const masAlla = await getClinicMap({ query: marca, page: 99 });
    expect(masAlla.page).toBe(2);
    expect(masAlla.items.map((c) => c.clinicId)).toEqual(segunda.items.map((c) => c.clinicId));
  });

  it("clínicas: conteos de la página sin traer datos de pacientes ni sus cuentas", LENTO, async () => {
    const clinica = await registrarClinica(`Clínica Mapa ${RUN}`, `Dra. Mapa ${RUN}`);
    await pacienteDemo(clinica.clinicId);

    // Una cuenta con rol paciente en la misma clínica: no debe salir en el mapa
    // ni en la lista de personal.
    const emailPaciente = `paciente.${RUN}@example.com`;
    const { data: creado, error: authErr } = await service().auth.admin.createUser({
      email: emailPaciente,
      password: "Password123!",
      email_confirm: true,
    });
    expect(authErr).toBeNull();
    const { error: userErr } = await service().from("users").insert({
      id: creado.user!.id,
      clinic_id: clinica.clinicId,
      email: emailPaciente,
      full_name: `Paciente Demo ${RUN}`,
      role: "paciente",
    });
    expect(userErr).toBeNull();

    const mapa = await getClinicMap({ query: `Mapa ${RUN}`, page: 1 });
    expect(mapa.matched).toBe(1);
    const [entrada] = mapa.items;
    expect(entrada.clinicId).toBe(clinica.clinicId);
    expect(entrada.patientCount).toBe(1);
    expect(entrada.doctors.map((dr) => dr.email)).toEqual([clinica.email]);
    expect(JSON.stringify(mapa)).not.toContain(emailPaciente);
    expect(JSON.stringify(mapa)).not.toContain("Paciente Demo");

    const personal = await listAllStaff({ query: emailPaciente, page: 1 });
    expect(personal.matched).toBe(0);
    expect(personal.items).toEqual([]);
  });

  it("personal: busca por nombre o correo tomando el texto literal", LENTO, async () => {
    const nombre = `Dr. (Pérez, "Ana") 100%_${RUN}`;
    const cuenta = await registrarClinica(`Clínica Personal ${RUN}`, nombre);

    const antes = await contar("users", { sinPacientes: true });
    const porNombre = await listAllStaff({ query: `(Pérez, "Ana") 100%_${RUN}`, page: 1 });
    const despues = await contar("users", { sinPacientes: true });

    expect(porNombre.matched).toBe(1);
    expect(porNombre.items.map((s) => s.email)).toEqual([cuenta.email]);
    expect(porNombre.total).toBeGreaterThanOrEqual(antes);
    expect(porNombre.total).toBeLessThanOrEqual(despues);

    const porCorreo = await listAllStaff({ query: cuenta.email, page: 1 });
    expect(porCorreo.items.map((s) => s.fullName)).toEqual([nombre]);

    // "%" no es comodín: "Pérez%Ana" no coincide con "Pérez, \"Ana\"".
    const comodin = await listAllStaff({ query: `Pérez%Ana") 100%_${RUN}`, page: 1 });
    expect(comodin.matched).toBe(0);
  });

  it("citas: busca por clínica y no trae notas ni datos del paciente", LENTO, async () => {
    const clinica = await registrarClinica(`Clínica Agenda ${RUN}`, `Dra. Agenda ${RUN}`);
    const patientId = await pacienteDemo(clinica.clinicId);
    const { error } = await service().from("appointments").insert({
      clinic_id: clinica.clinicId,
      patient_id: patientId,
      doctor_id: clinica.userId,
      scheduled_at: "2030-03-10T14:00:00Z",
      notes: "Nota Demo sobre el paciente",
    });
    expect(error).toBeNull();

    const antes = await contar("appointments");
    const citas = await listAllAppointments({ query: `Agenda ${RUN}`, page: 1 });
    const despues = await contar("appointments");

    expect(citas.matched).toBe(1);
    expect(citas.total).toBeGreaterThanOrEqual(antes);
    expect(citas.total).toBeLessThanOrEqual(despues);
    const [cita] = citas.items;
    expect(cita).toMatchObject({ clinicName: `Clínica Agenda ${RUN}`, doctorName: `Dra. Agenda ${RUN}` });
    expect(Object.keys(cita).sort()).toEqual(
      ["clinicName", "doctorName", "durationMin", "id", "scheduledAt", "status"],
    );
    expect(JSON.stringify(citas)).not.toContain("Nota Demo");
    expect(JSON.stringify(citas)).not.toContain("Paciente Demo");
  });

  it("verificaciones: la BD separa la cola igual que el criterio de la app", { timeout: 120_000 }, async () => {
    const marca = `Cola ${RUN}`;
    const notaHeredada = `${LEGACY_VERIFICATION_NOTE_PREFIX}ón obligatoria; pendiente de revisión retroactiva.`;
    const casos = {
      pendiente: { verification_status: "pending_review" },
      heredadaConDocumentos: {
        verification_status: "verified",
        verification_notes: notaHeredada,
        id_document_path: "demo/cedula.jpg",
      },
      heredadaSinDocumentos: { verification_status: "verified", verification_notes: notaHeredada },
      secretariaHeredada: {
        role: "secretaria",
        verification_status: "verified",
        verification_notes: notaHeredada,
        license_document_path: "demo/tarjeta.jpg",
      },
      verificada: { verification_status: "verified", verification_notes: null },
      rechazada: { verification_status: "rejected", verification_notes: "Documento ilegible" },
      sinDocumentos: { verification_status: "pending_documents" },
    } as const;

    await Promise.all(
      Object.entries(casos).map(async ([caso, cambios]) => {
        const cuenta = await registrarClinica(`Clínica ${marca} ${caso}`, `${marca} ${caso}`);
        const { error } = await service().from("users").update(cambios).eq("id", cuenta.userId);
        expect(error, caso).toBeNull();
      }),
    );

    const { pending, reviewed } = await listVerificationQueue({
      query: marca,
      pendingPage: 1,
      reviewedPage: 1,
    });
    const nombres = (items: PendingVerification[]) => items.map((i) => i.fullName).sort();

    expect(nombres(pending.items)).toEqual([`${marca} heredadaConDocumentos`, `${marca} pendiente`]);
    expect(nombres(reviewed.items)).toEqual(
      [
        `${marca} heredadaSinDocumentos`,
        `${marca} rechazada`,
        `${marca} secretariaHeredada`,
        `${marca} verificada`,
      ].sort(),
    );
    expect(pending.matched).toBe(2);
    expect(reviewed.matched).toBe(4);
    expect(pending.total).toBeGreaterThanOrEqual(pending.matched);

    // El filtro de la BD y el predicado de la app (lib/verification.ts) coinciden.
    const accionable = (v: PendingVerification) =>
      isAwaitingReview(v.status) ||
      legacyVerificationState({
        status: v.status,
        role: v.role,
        notes: v.notes,
        hasIdDocument: Boolean(v.idDocumentPath),
        hasLicenseDocument: Boolean(v.licenseDocumentPath),
      }) === "awaiting_review";
    expect(pending.items.every(accionable)).toBe(true);
    expect(reviewed.items.some(accionable)).toBe(false);
  });
});

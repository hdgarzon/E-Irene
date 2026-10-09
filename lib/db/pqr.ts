import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchListPage, ilikeCondition, ADMIN_PAGE_SIZE, type ListPage, type ListParams } from "@/lib/admin-list";
import type { PqrKind, PqrStatus } from "@/lib/pqr";

export interface Pqr {
  id: string;
  radicado: string;
  kind: PqrKind;
  fullName: string;
  email: string;
  phone: string | null;
  message: string;
  status: PqrStatus;
  respondedAt: string | null;
  createdAt: string;
}

interface PqrRow {
  id: string;
  radicado: string;
  kind: string;
  full_name: string;
  email: string;
  phone: string | null;
  message: string;
  status: string;
  responded_at: string | null;
  created_at: string;
}

function mapRow(r: PqrRow): Pqr {
  return {
    id: r.id,
    radicado: r.radicado,
    kind: r.kind as PqrKind,
    fullName: r.full_name,
    email: r.email,
    phone: r.phone,
    message: r.message,
    status: r.status as PqrStatus,
    respondedAt: r.responded_at,
    createdAt: r.created_at,
  };
}

const COLUMNS = "id, radicado, kind, full_name, email, phone, message, status, responded_at, created_at";

/**
 * Radica una PQR. Quien la presenta no tiene cuenta, así que se inserta con
 * service-role: SOLO desde la Server Action pública, después de validar el
 * formulario y limitar por IP. El radicado y la fecha los pone la base.
 */
export async function createPqr(input: {
  kind: PqrKind;
  fullName: string;
  email: string;
  phone: string | null;
  message: string;
  ip: string | null;
  userAgent: string | null;
}): Promise<Pqr> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("pqr_requests")
    .insert({
      kind: input.kind,
      full_name: input.fullName,
      email: input.email,
      phone: input.phone,
      message: input.message,
      ip: input.ip,
      user_agent: input.userAgent,
    })
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return mapRow(data as PqrRow);
}

/** Consola del admin de plataforma (RLS: solo is_platform_admin()). Busca por radicado o correo. */
export async function listPqrs(params: ListParams): Promise<ListPage<Pqr>> {
  const supabase = await createClient();
  const search = `${ilikeCondition("radicado", params.query)},${ilikeCondition("email", params.query)}`;

  return fetchListPage({
    params,
    pageSize: ADMIN_PAGE_SIZE,
    countTotal: () => supabase.from("pqr_requests").select("id", { count: "exact", head: true }),
    countMatched: () =>
      supabase.from("pqr_requests").select("id", { count: "exact", head: true }).or(search),
    fetchRows: (from, to) => {
      let query = supabase.from("pqr_requests").select(COLUMNS);
      if (params.query) query = query.or(search);
      return query.order("created_at", { ascending: false }).order("id").range(from, to);
    },
    map: mapRow,
  });
}

export async function updatePqrStatus(id: string, status: PqrStatus): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("pqr_requests")
    .update({ status, responded_at: status === "respondida" ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) throw error;
}

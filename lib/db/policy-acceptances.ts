import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { POLICY_HASH, POLICY_VERSION } from "@/lib/legal";

/** ¿El usuario ya aceptó la versión vigente de la política? */
export async function hasAcceptedCurrentPolicy(userId: string): Promise<boolean> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("policy_acceptances")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("document_version", POLICY_VERSION);
  return (count ?? 0) > 0;
}

/**
 * Registra la aceptación con la prueba que exige la Ley 1581: qué versión, qué
 * texto exacto (hash), desde dónde y cuándo.
 *
 * La IP y el user-agent se leen aquí, del request real, y no se reciben del
 * cliente: una prueba que el propio interesado puede dictar no prueba nada.
 */
export async function recordAcceptance(params: {
  userId: string;
  clinicId: string;
  marketingOptIn: boolean;
}): Promise<void> {
  const h = await headers();
  const ip =
    (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "").trim() || null;

  const supabase = await createClient();
  const { error } = await supabase.from("policy_acceptances").insert({
    user_id: params.userId,
    clinic_id: params.clinicId,
    document_version: POLICY_VERSION,
    document_hash: POLICY_HASH,
    ip,
    user_agent: h.get("user-agent"),
    marketing_opt_in: params.marketingOptIn,
  });
  if (error) throw error;
}

export interface AcceptanceRecord {
  documentVersion: string;
  documentHash: string;
  marketingOptIn: boolean;
  acceptedAt: string;
}

/** Historial de aceptaciones del usuario, de la más reciente hacia atrás. */
export async function listMyAcceptances(userId: string): Promise<AcceptanceRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("policy_acceptances")
    .select("document_version, document_hash, marketing_opt_in, accepted_at")
    .eq("user_id", userId)
    .order("accepted_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    documentVersion: r.document_version,
    documentHash: r.document_hash,
    marketingOptIn: r.marketing_opt_in,
    acceptedAt: r.accepted_at,
  }));
}

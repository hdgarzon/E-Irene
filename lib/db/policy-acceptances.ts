import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { POLICY_HASH, POLICY_VERSION } from "@/lib/legal";
import { logAudit } from "@/lib/db/audit";

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

/**
 * Registra la aceptación de la versión vigente y la deja en el audit trail, salvo
 * que ya exista: reaceptar la misma versión no aporta prueba nueva y ensuciaría
 * el historial. La usan el registro (/auth/set-password) y la compuerta de
 * /terminos.
 */
export async function acceptCurrentPolicy(params: {
  userId: string;
  clinicId: string;
  marketingOptIn: boolean;
}): Promise<void> {
  if (await hasAcceptedCurrentPolicy(params.userId)) return;
  await recordAcceptance(params);
  await logAudit({
    clinicId: params.clinicId,
    actorId: params.userId,
    action: "policy.accepted",
    entityType: "policy_acceptances",
    entityId: params.userId,
    metadata: { version: POLICY_VERSION },
  });
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

/** Autorización comercial vigente: la de la aceptación más reciente. */
export async function getMarketingOptIn(userId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("policy_acceptances")
    .select("marketing_opt_in")
    .eq("user_id", userId)
    .order("accepted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.marketing_opt_in ?? false;
}

/**
 * Da o retira la autorización de comunicaciones comerciales (Términos de
 * Vinculación, cláusula novena: "revocable en cualquier momento"). Las
 * aceptaciones son inmutables (0035): el cambio se registra como una aceptación
 * nueva de la versión vigente, con su propia IP, user-agent y fecha, y la
 * vigente es siempre la más reciente.
 */
export async function setMarketingOptIn(params: {
  userId: string;
  clinicId: string;
  optIn: boolean;
}): Promise<void> {
  if ((await getMarketingOptIn(params.userId)) === params.optIn) return;
  await recordAcceptance({ userId: params.userId, clinicId: params.clinicId, marketingOptIn: params.optIn });
  await logAudit({
    clinicId: params.clinicId,
    actorId: params.userId,
    action: params.optIn ? "marketing.opt_in" : "marketing.opt_out",
    entityType: "policy_acceptances",
    entityId: params.userId,
    metadata: { version: POLICY_VERSION },
  });
}

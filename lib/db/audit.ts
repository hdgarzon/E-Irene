import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Registra un evento en audit_logs (tabla inmutable). Cumplimiento legal:
 * trazabilidad de acciones sensibles (Resolución 1995/1999, Ley 2015/2020).
 */
export async function logAudit(params: {
  clinicId: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const supabase = await createClient();
  await supabase.from("audit_logs").insert({
    clinic_id: params.clinicId,
    actor_id: params.actorId,
    action: params.action,
    entity_type: params.entityType,
    entity_id: params.entityId ?? null,
    metadata: (params.metadata ?? {}) as never,
  });
}

/**
 * Igual que `logAudit`, pero para acciones sin sesión (flujo de link público
 * del paciente): usa el cliente service-role y no requiere `actorId`.
 */
export async function logAuditPublic(params: {
  clinicId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const admin = createAdminClient();
  await admin.from("audit_logs").insert({
    clinic_id: params.clinicId,
    actor_id: null,
    action: params.action,
    entity_type: params.entityType,
    entity_id: params.entityId ?? null,
    metadata: (params.metadata ?? {}) as never,
  });
}

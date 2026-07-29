import { createAdminClient } from "@/lib/supabase/admin";
import { encrypt } from "@/lib/crypto";
import { logger } from "@/lib/logger";

export type BillingStatus = "sin_configurar" | "activo" | "pendiente" | "vencido" | "suspendido";

/** true si la clínica existe — usado por el webhook para no aceptar referencias con un clinicId inventado. */
export async function clinicExists(clinicId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("clinics").select("id").eq("id", clinicId).maybeSingle();
  if (error) throw error;
  return data !== null;
}

/**
 * Registra un evento de transacción de Wompi. Idempotente por
 * (wompi_transaction_id, status) — ver migración 0027: un reintento de
 * entrega del mismo evento (Wompi reintenta si no respondemos 2xx a tiempo)
 * no debe duplicar el registro. `isNew: false` le indica al caller que el
 * evento ya se procesó antes y no debe repetir efectos secundarios (activar
 * el plan, etc).
 */
export async function recordBillingEvent(input: {
  clinicId: string;
  wompiTransactionId: string;
  wompiEvent: string;
  status: string;
  amountInCents: number;
  rawPayload: unknown;
}): Promise<{ isNew: boolean }> {
  const admin = createAdminClient();
  const { error } = await admin.from("billing_events").insert({
    clinic_id: input.clinicId,
    wompi_transaction_id: input.wompiTransactionId,
    wompi_event: input.wompiEvent,
    status: input.status,
    amount_in_cents: input.amountInCents,
    raw_payload_enc: encrypt(JSON.stringify(input.rawPayload)),
  });
  if (!error) return { isNew: true };
  // 23505 = unique_violation → mismo (transaction_id, status) ya registrado.
  if (error.code === "23505") return { isNew: false };
  throw error;
}

/**
 * Activa la facturación de la clínica tras un pago aprobado. `periodDays`
 * es fijo en 30 por ahora (no hay ciclos mensuales reales de calendario
 * todavía — eso lo resuelve el cron de la Fase 3, que además decide qué
 * pasa si el cobro del mes siguiente falla).
 */
export async function activateBilling(
  clinicId: string,
  paymentSourceId: string | null,
  periodDays = 30,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("clinics")
    .update({
      billing_status: "activo",
      current_period_end: new Date(Date.now() + periodDays * 24 * 60 * 60 * 1000).toISOString(),
      wompi_payment_source_id_enc: paymentSourceId ? encrypt(paymentSourceId) : undefined,
    })
    .eq("id", clinicId);
  if (error) throw error;
  logger.info("billing.activated", { clinicId, periodDays });
}

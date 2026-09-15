"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { acknowledgeRiskAlert } from "@/lib/db/risk-alerts";
import { logAudit } from "@/lib/db/audit";
import { logger } from "@/lib/logger";

/**
 * El doctor (o admin) acusa recibo de una alerta de riesgo — sale de la cola
 * abierta del dashboard. La restricción de quién puede hacerlo vive en la
 * política RLS `risk_alerts_update` (admin/doctor de la misma clínica); aquí
 * solo se exige sesión activa.
 *
 * La auditoría afirma que este usuario atendió la alerta, así que solo se
 * escribe cuando el UPDATE realmente cambió la fila.
 */
export async function acknowledgeRiskAlertAction(alertId: string): Promise<void> {
  const user = await requireUser();
  const result = await acknowledgeRiskAlert(alertId, user.id);

  if (result === "not_allowed") {
    // Desde el dashboard no debería pasar (la cola solo se muestra a
    // admin/doctor): es un id de otra clínica, una alerta inexistente o un
    // rol sin permiso. Se lanza para no darlo por hecho en silencio.
    logger.warn("risk_alert.acknowledge_denied", {
      clinicId: user.clinicId,
      actorId: user.id,
      role: user.role,
      alertId,
    });
    throw new Error("No se pudo acusar recibo de la alerta.");
  }

  // "already_acknowledged" (doble clic, otro doctor se adelantó) no es un
  // acuse de este usuario: quien la atendió primero ya quedó registrado.
  if (result === "acknowledged") {
    await logAudit({
      clinicId: user.clinicId,
      actorId: user.id,
      action: "risk_alert.acknowledged",
      entityType: "risk_alert",
      entityId: alertId,
    });
  }
  revalidatePath("/dashboard");
}

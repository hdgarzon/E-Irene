"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { acknowledgeRiskAlert } from "@/lib/db/risk-alerts";
import { logAudit } from "@/lib/db/audit";

/**
 * El doctor (o admin) acusa recibo de una alerta de riesgo — sale de la cola
 * abierta del dashboard. La restricción de quién puede hacerlo vive en la
 * política RLS `risk_alerts_update` (admin/doctor de la misma clínica); aquí
 * solo se exige sesión activa.
 */
export async function acknowledgeRiskAlertAction(alertId: string): Promise<void> {
  const user = await requireUser();
  await acknowledgeRiskAlert(alertId, user.id);
  await logAudit({
    clinicId: user.clinicId,
    actorId: user.id,
    action: "risk_alert.acknowledged",
    entityType: "risk_alert",
    entityId: alertId,
  });
  revalidatePath("/dashboard");
}

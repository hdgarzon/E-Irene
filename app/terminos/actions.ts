"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { hasAcceptedCurrentPolicy, recordAcceptance } from "@/lib/db/policy-acceptances";
import { logAudit } from "@/lib/db/audit";
import { POLICY_VERSION } from "@/lib/legal";
import { logger } from "@/lib/logger";

export type AcceptState = { error?: string };

const FAILED = "No pudimos registrar tu aceptación. Intenta de nuevo en unos minutos.";

export async function acceptPolicyAction(
  _prev: AcceptState,
  formData: FormData,
): Promise<AcceptState> {
  const user = await requireUser();

  // La casilla contractual es obligatoria; la comercial va aparte y es opcional
  // — agruparlas viciaría el consentimiento comercial.
  if (formData.get("accepted") !== "on") {
    return { error: "Debes aceptar la política para continuar." };
  }

  try {
    // Reaceptar la misma versión no aporta prueba nueva y ensuciaría el
    // historial: si ya está, seguimos de largo.
    if (!(await hasAcceptedCurrentPolicy(user.id))) {
      await recordAcceptance({
        userId: user.id,
        clinicId: user.clinicId,
        marketingOptIn: formData.get("marketing") === "on",
      });

      await logAudit({
        clinicId: user.clinicId,
        actorId: user.id,
        action: "policy.accepted",
        entityType: "policy_acceptances",
        entityId: user.id,
        metadata: { version: POLICY_VERSION },
      });
    }
  } catch (error) {
    logger.error("policy.accept_failed", { userId: user.id, error });
    return { error: FAILED };
  }

  redirect("/dashboard");
}

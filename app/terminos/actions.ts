"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { acceptCurrentPolicy } from "@/lib/db/policy-acceptances";
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
    return { error: "Debes marcar la declaración y la aceptación para continuar." };
  }

  try {
    await acceptCurrentPolicy({
      userId: user.id,
      clinicId: user.clinicId,
      marketingOptIn: formData.get("marketing") === "on",
    });
  } catch (error) {
    logger.error("policy.accept_failed", { userId: user.id, error });
    return { error: FAILED };
  }

  redirect("/dashboard");
}

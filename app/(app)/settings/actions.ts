"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { addMember } from "@/lib/db/team";
import { getClinicOverview } from "@/lib/db/clinic";
import {
  requestSubscriptionCancellation,
  revertSubscriptionCancellation,
} from "@/lib/db/subscription";
import { canAddDoctor, limitLabel, PLANS, type Plan } from "@/lib/plans";
import { logAudit } from "@/lib/db/audit";
import { logger } from "@/lib/logger";
import { createWompiCheckout } from "@/lib/billing/wompi-checkout";
import { appBaseUrl } from "@/lib/app-url";

export type MemberState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
};

const memberSchema = z.object({
  fullName: z.string().min(2, "Ingresa el nombre"),
  email: z.email("Correo inválido"),
  password: z.string().min(8, "Mínimo 8 caracteres"),
  role: z.enum(["doctor", "secretaria", "admin"]),
});

export async function addMemberAction(
  _prev: MemberState,
  formData: FormData,
): Promise<MemberState> {
  const user = await requireRole(["admin"]);
  const parsed = memberSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
    role: formData.get("role"),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) {
      const k = String(i.path[0] ?? "form");
      if (!fieldErrors[k]) fieldErrors[k] = i.message;
    }
    return { fieldErrors };
  }

  const overview = await getClinicOverview();
  const isClinician = parsed.data.role === "doctor" || parsed.data.role === "admin";
  if (isClinician && !canAddDoctor(overview.plan, overview.doctorCount)) {
    return {
      error: `Tu plan ${PLANS[overview.plan].label} permite hasta ${limitLabel(
        PLANS[overview.plan].maxDoctors,
      )} profesionales. Mejora tu plan para agregar más.`,
    };
  }

  try {
    await addMember(user.clinicId, parsed.data);
    await logAudit({
      clinicId: user.clinicId,
      actorId: user.id,
      action: "member.added",
      entityType: "user",
      metadata: { role: parsed.data.role },
    });
  } catch (error) {
    logger.error("member.add_failed", {
      clinicId: user.clinicId,
      actorId: user.id,
      role: parsed.data.role,
      error,
    });
    return { error: "No se pudo crear el miembro. ¿El correo ya está registrado?" };
  }

  revalidatePath("/settings/team");
  return { ok: true };
}

export async function initiatePlanUpgradeAction(plan: Plan): Promise<void> {
  const user = await requireRole(["admin", "doctor"]);
  const overview = await getClinicOverview();
  if (overview.plan === plan) {
    redirect("/settings/plan");
  }

  // Pasar a Free no es un cambio de plan sino cancelar la suscripción, que
  // conserva lo pagado hasta el fin del período (cancelSubscriptionAction). Antes
  // bajaba el plan al instante, perdiendo el resto del período ya cobrado.
  if (PLANS[plan].priceInCents <= 0) {
    redirect("/settings/plan#suscripcion");
  }

  // Sin query params propios: Wompi agrega `?id=<transaction_id>` al volver, y
  // ese id es lo que permite reconciliar el pago aunque el webhook no llegue
  // (ver lib/billing/reconcile.ts). Mandar una URL que ya trae "?" arriesga
  // que el parámetro de Wompi quede pegado y se pierda.
  const redirectUrl = `${appBaseUrl()}/settings/plan`;

  // IMPORTANTE: `redirect()` funciona LANZANDO una excepción (NEXT_REDIRECT),
  // así que no puede ir dentro del `try` — el `catch` la atraparía y trataría
  // un checkout exitoso como un fallo. Eso es exactamente lo que ocurría:
  // el payment link se creaba bien y aun así el usuario terminaba en
  // ?wompi=error. Ver docs de Next.js (redirect): "redirect should be called
  // outside the try block when using try/catch statements".
  let checkoutUrl: string | null = null;
  try {
    const checkout = await createWompiCheckout({
      clinicId: user.clinicId,
      plan,
      redirectUrl,
      userEmail: user.email,
    });
    await logAudit({
      clinicId: user.clinicId,
      actorId: user.id,
      action: "billing.checkout_initiated",
      entityType: "clinic",
      entityId: user.clinicId,
      metadata: { plan, reference: checkout.reference, paymentLinkId: checkout.paymentLinkId },
    });
    checkoutUrl = checkout.checkoutUrl;
  } catch (error) {
    logger.error("billing.checkout_initiate_failed", {
      clinicId: user.clinicId,
      actorId: user.id,
      plan,
      error,
    });
  }

  if (!checkoutUrl) redirect("/settings/plan?wompi=error");
  redirect(checkoutUrl);
}

export type SubscriptionState = { ok?: boolean; error?: string };

/**
 * Cancela la suscripción al final del período pagado (o de inmediato si no hay
 * período vigente). Solo el admin: la función de la base lo exige igual, esto
 * es para no llegar hasta ella. La constancia queda en audit_logs desde la base.
 */
export async function cancelSubscriptionAction(): Promise<SubscriptionState> {
  const user = await requireRole(["admin"]);
  try {
    const result = await requestSubscriptionCancellation();
    logger.info("subscription.cancel_requested", {
      clinicId: user.clinicId,
      actorId: user.id,
      status: result.status,
      effectiveAt: result.effectiveAt,
    });
  } catch (error) {
    logger.error("subscription.cancel_failed", {
      clinicId: user.clinicId,
      actorId: user.id,
      error,
    });
    return { error: "No se pudo cancelar la suscripción. Intenta de nuevo o escríbenos." };
  }
  revalidatePath("/settings/plan");
  revalidatePath("/settings");
  return { ok: true };
}

export async function revertCancellationAction(): Promise<SubscriptionState> {
  const user = await requireRole(["admin"]);
  try {
    const status = await revertSubscriptionCancellation();
    logger.info("subscription.cancel_reverted", {
      clinicId: user.clinicId,
      actorId: user.id,
      status,
    });
    if (status === "too_late") {
      return {
        error: "El período pagado ya terminó: para volver a un plan pago elige uno abajo.",
      };
    }
  } catch (error) {
    logger.error("subscription.revert_failed", {
      clinicId: user.clinicId,
      actorId: user.id,
      error,
    });
    return { error: "No se pudo reactivar la suscripción. Intenta de nuevo o escríbenos." };
  }
  revalidatePath("/settings/plan");
  revalidatePath("/settings");
  return { ok: true };
}

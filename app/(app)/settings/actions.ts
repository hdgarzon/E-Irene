"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { addMember } from "@/lib/db/team";
import { getClinicOverview } from "@/lib/db/clinic";
import {
  cancelScheduledPlanChange,
  requestSubscriptionCancellation,
  revertSubscriptionCancellation,
  schedulePlanDowngrade,
} from "@/lib/db/subscription";
import { hasOpenRenewalCharge } from "@/lib/db/billing";
import { canAddDoctor, limitLabel, PLANS, TRANSCRIPTION_PACK, type Plan } from "@/lib/plans";
import { subscriptionState } from "@/lib/billing/subscription-state";
import { isPaidPlanDowngrade, isPaidPlanUpgrade, quotePlanUpgrade } from "@/lib/billing/proration";
import { transcriptionPackAvailability } from "@/lib/billing/transcription-pack";
import { logAudit } from "@/lib/db/audit";
import { logger } from "@/lib/logger";
import {
  createTranscriptionPackCheckout,
  createUpgradeCheckout,
  createWompiCheckout,
} from "@/lib/billing/wompi-checkout";
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
  const state = subscriptionState(overview.plan, overview.subscription);
  // Volver a pagar el plan actual solo tiene sentido si su renovación no se pudo
  // cobrar: es la salida de la gracia (lib/billing/subscription-state.ts).
  if (overview.plan === plan && state.kind !== "overdue") {
    redirect("/settings/plan");
  }

  // Los planes a convenir (Enterprise) no se venden por la app: se acuerdan por
  // contrato y los asigna la consola.
  const { priceInCents } = PLANS[plan];
  if (priceInCents === null) {
    redirect("/settings/plan");
  }

  // Pasar a Free no es un cambio de plan sino cancelar la suscripción, que
  // conserva lo pagado hasta el fin del período (cancelSubscriptionAction). Antes
  // bajaba el plan al instante, perdiendo el resto del período ya cobrado.
  if (priceInCents <= 0) {
    redirect("/settings/plan#suscripcion");
  }

  // Con un período pagado vigente, cambiar entre planes pagos no vuelve a cobrar
  // un mes completo ni mueve la fecha de renovación: subir cobra la diferencia
  // por lo que queda del ciclo y bajar se programa para la renovación
  // (schedulePlanDowngradeAction). Comprar el plan completo reiniciaba el ciclo y
  // se perdía lo ya pagado.
  const paidPeriodEnd =
    state.kind === "renewing" || state.kind === "canceling" ? state.periodEnd : null;
  if (paidPeriodEnd && isPaidPlanDowngrade(overview.plan, plan)) {
    redirect("/settings/plan");
  }
  const prorated = paidPeriodEnd !== null && isPaidPlanUpgrade(overview.plan, plan);

  // Un cobro de renovación sin desenlace (PSE, Nequi) es del plan actual: si se
  // aprueba después de subir de plan, la renovación no sabría qué aplicar.
  if (prorated && (await hasOpenRenewalCharge(user.clinicId))) {
    redirect("/settings/plan?cambio=renovacion_en_curso");
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
  let quoteUnavailable = false;
  try {
    if (prorated) {
      const quote = quotePlanUpgrade({
        fromPlan: overview.plan,
        toPlan: plan,
        anchor: overview.billingCycleAnchor,
        periodEnd: paidPeriodEnd,
      });
      if (!quote) {
        // El período no coincide con un ciclo del ancla: no se cotiza a ciegas.
        quoteUnavailable = true;
        logger.error("billing.upgrade_quote_unavailable", {
          clinicId: user.clinicId,
          fromPlan: overview.plan,
          toPlan: plan,
          anchor: overview.billingCycleAnchor,
          periodEnd: paidPeriodEnd,
        });
      } else {
        const checkout = await createUpgradeCheckout({
          clinicId: user.clinicId,
          quote,
          redirectUrl,
          userEmail: user.email,
        });
        await logAudit({
          clinicId: user.clinicId,
          actorId: user.id,
          action: "billing.upgrade_checkout_initiated",
          entityType: "clinic",
          entityId: user.clinicId,
          metadata: {
            fromPlan: quote.fromPlan,
            toPlan: quote.toPlan,
            amountInCents: quote.amountInCents,
            periodEnd: quote.periodEnd,
            reference: checkout.reference,
            paymentLinkId: checkout.paymentLinkId,
          },
        });
        checkoutUrl = checkout.checkoutUrl;
      }
    } else {
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
    }
  } catch (error) {
    logger.error("billing.checkout_initiate_failed", {
      clinicId: user.clinicId,
      actorId: user.id,
      plan,
      prorated,
      error,
    });
  }

  if (quoteUnavailable) redirect("/settings/plan?cambio=no_cotizable");
  if (!checkoutUrl) redirect("/settings/plan?wompi=error");
  redirect(checkoutUrl);
}

/**
 * Compra de una bolsa de horas de transcripción (migración 0057): suma horas al
 * límite del plan hasta el fin del ciclo. Mismo camino de pago por link que un
 * plan; la base la otorga una sola vez (grant_transcription_pack).
 */
export async function buyTranscriptionPackAction(): Promise<void> {
  const user = await requireRole(["admin", "doctor"]);
  const overview = await getClinicOverview();
  const state = subscriptionState(overview.plan, overview.subscription);
  const availability = transcriptionPackAvailability({
    plan: overview.plan,
    hasPaidPeriod: state.kind === "renewing" || state.kind === "canceling",
    cycleEnd: overview.cycleEnd,
  });
  if (availability === "cycle_ending") redirect("/settings/plan?bolsa=fin_de_ciclo");
  if (availability !== "available") redirect("/settings/plan?bolsa=no_disponible");

  // Sin query params propios: ver initiatePlanUpgradeAction.
  const redirectUrl = `${appBaseUrl()}/settings/plan`;

  // redirect() lanza: va fuera del try (ver initiatePlanUpgradeAction).
  let checkoutUrl: string | null = null;
  try {
    const checkout = await createTranscriptionPackCheckout({
      clinicId: user.clinicId,
      plan: overview.plan,
      cycleEnd: overview.cycleEnd,
      redirectUrl,
      userEmail: user.email,
    });
    await logAudit({
      clinicId: user.clinicId,
      actorId: user.id,
      action: "billing.transcription_pack_checkout_initiated",
      entityType: "clinic",
      entityId: user.clinicId,
      metadata: {
        plan: overview.plan,
        hours: TRANSCRIPTION_PACK.hours,
        amountInCents: TRANSCRIPTION_PACK.priceInCents,
        cycleEnd: overview.cycleEnd,
        reference: checkout.reference,
        paymentLinkId: checkout.paymentLinkId,
      },
    });
    checkoutUrl = checkout.checkoutUrl;
  } catch (error) {
    logger.error("billing.transcription_pack_checkout_failed", {
      clinicId: user.clinicId,
      actorId: user.id,
      error,
    });
  }

  if (!checkoutUrl) redirect("/settings/plan?wompi=error");
  redirect(checkoutUrl);
}

/**
 * Programa bajar a un plan pago menor desde la próxima renovación: sin cobro hoy
 * y conservando el plan actual hasta el fin del período. Solo el admin; la función
 * de la base lo exige igual y deja la constancia en audit_logs.
 */
export async function schedulePlanDowngradeAction(plan: Plan): Promise<void> {
  const user = await requireRole(["admin"]);
  let notice = "no_programado";
  try {
    const result = await schedulePlanDowngrade(plan);
    logger.info("subscription.downgrade_requested", {
      clinicId: user.clinicId,
      actorId: user.id,
      plan,
      status: result.status,
      effectiveAt: result.effectiveAt,
    });
    if (result.status === "scheduled" || result.status === "already_scheduled") {
      notice = "programado";
    } else if (result.status === "canceling") {
      notice = "cancelacion_pendiente";
    }
  } catch (error) {
    logger.error("subscription.downgrade_failed", {
      clinicId: user.clinicId,
      actorId: user.id,
      plan,
      error,
    });
  }
  revalidatePath("/settings/plan");
  revalidatePath("/settings");
  redirect(`/settings/plan?cambio=${notice}`);
}

export type SubscriptionState = { ok?: boolean; error?: string };

/** Anula el downgrade programado: la renovación vuelve a cobrar el plan actual. */
export async function cancelScheduledPlanChangeAction(): Promise<SubscriptionState> {
  const user = await requireRole(["admin"]);
  try {
    const status = await cancelScheduledPlanChange();
    logger.info("subscription.downgrade_cancel_requested", {
      clinicId: user.clinicId,
      actorId: user.id,
      status,
    });
  } catch (error) {
    logger.error("subscription.downgrade_cancel_failed", {
      clinicId: user.clinicId,
      actorId: user.id,
      error,
    });
    return { error: "No se pudo anular el cambio de plan. Intenta de nuevo o escríbenos." };
  }
  revalidatePath("/settings/plan");
  revalidatePath("/settings");
  return { ok: true };
}

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

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { addMember } from "@/lib/db/team";
import { getClinicOverview, setClinicPlan } from "@/lib/db/clinic";
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

export async function changePlanAction(plan: Plan): Promise<void> {
  const user = await requireRole(["admin"]);
  await setClinicPlan(user.clinicId, plan);
  await logAudit({
    clinicId: user.clinicId,
    actorId: user.id,
    action: "plan.changed",
    entityType: "clinic",
    entityId: user.clinicId,
    metadata: { plan },
  });
  revalidatePath("/settings/plan");
  revalidatePath("/settings");
  revalidatePath("/dashboard");
}

export async function initiatePlanUpgradeAction(plan: Plan): Promise<void> {
  const user = await requireRole(["admin", "doctor"]);
  const overview = await getClinicOverview();
  if (overview.plan === plan) {
    redirect("/settings/plan");
  }

  const amountInCents = PLANS[plan].priceInCents;
  if (amountInCents <= 0) {
    // Plan gratis: se cambia inmediatamente sin pasar por Wompi.
    await setClinicPlan(user.clinicId, plan);
    await logAudit({
      clinicId: user.clinicId,
      actorId: user.id,
      action: "plan.downgraded_to_free",
      entityType: "clinic",
      entityId: user.clinicId,
      metadata: { plan },
    });
    revalidatePath("/settings/plan");
    return;
  }

  const redirectUrl = `${appBaseUrl()}/settings/plan?wompi=return`;

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
    redirect(checkout.checkoutUrl);
  } catch (error) {
    logger.error("billing.checkout_initiate_failed", {
      clinicId: user.clinicId,
      actorId: user.id,
      plan,
      error,
    });
    redirect("/settings/plan?wompi=error");
  }
}

import { createAdminClient } from "@/lib/supabase/admin";
import { getEmailProvider } from "@/lib/email/providers";
import { buildPaymentConfirmationEmail } from "@/lib/email/templates";
import { appBaseUrl } from "@/lib/app-url";
import { formatLongDate, formatTime } from "@/lib/dates";
import { formatCop } from "@/lib/plans";
import { logger } from "@/lib/logger";

/**
 * Confirmación por correo de cada pago o activación (Términos y Condiciones,
 * cláusula duodécima, numeral 5: "indicando el plan, el precio, la fecha y el
 * período cubierto"). Va a los administradores de la clínica, que son quienes
 * pagan.
 *
 * Nunca lanza: el pago ya quedó aplicado y un correo caído no debe hacer que
 * Wompi reintente el webhook ni que el cron lo cuente como fallido. Quien llama
 * solo debe invocarla cuando el pago se aplicó por primera vez, para no enviarla
 * dos veces.
 */
export async function sendPaymentConfirmation(input: {
  clinicId: string;
  concept: string;
  amountInCents: number;
  coverage: string;
  reference: string;
  paidAt?: Date;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const [{ data: clinic, error: clinicError }, { data: admins, error: adminsError }] = await Promise.all([
      admin.from("clinics").select("name").eq("id", input.clinicId).single(),
      admin.from("users").select("email").eq("clinic_id", input.clinicId).eq("role", "admin"),
    ]);
    if (clinicError) throw clinicError;
    if (adminsError) throw adminsError;

    const paidAt = input.paidAt ?? new Date();
    const mailer = getEmailProvider();
    for (const { email } of admins ?? []) {
      await mailer.send(
        buildPaymentConfirmationEmail({
          to: email,
          clinicName: clinic.name,
          concept: input.concept,
          amount: `${formatCop(input.amountInCents)} COP`,
          paidAt: `${formatLongDate(paidAt)}, ${formatTime(paidAt)}`,
          coverage: input.coverage,
          reference: input.reference,
          settingsUrl: `${appBaseUrl()}/settings/plan`,
        }),
      );
    }
  } catch (error) {
    logger.error("billing.payment_confirmation_failed", {
      clinicId: input.clinicId,
      reference: input.reference,
      error,
    });
  }
}

/** Fin del período pagado de la clínica, para el "período cubierto". */
export async function currentPeriodEnd(clinicId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("clinics").select("current_period_end").eq("id", clinicId).single();
  return data?.current_period_end ?? null;
}

const VIDEO_COVERAGE = "No vencen: se conservan hasta su uso, mientras la cuenta exista";

/** Confirmación de una compra por link ya aplicada (plan, upgrade o adicional). */
export async function confirmCheckoutPayment(input: {
  clinicId: string;
  kind: string;
  planLabel: string;
  quantity: number | null;
  amountInCents: number;
  transactionId: string;
}): Promise<void> {
  let concept: string;
  let coverage: string;
  try {
    switch (input.kind) {
      case "plan":
      case "upgrade": {
        const end = await currentPeriodEnd(input.clinicId);
        concept =
          input.kind === "plan"
            ? `Plan ${input.planLabel}, mensual`
            : `Cambio al plan ${input.planLabel}: diferencia proporcional del período en curso`;
        coverage = end ? `hasta el ${formatLongDate(end)}` : "período en curso";
        break;
      }
      case "transcription_pack": {
        const admin = createAdminClient();
        const { data } = await admin
          .from("transcription_packs")
          .select("seconds, valid_until")
          .eq("wompi_transaction_id", input.transactionId)
          .maybeSingle();
        const hours = data ? Math.round(data.seconds / 3600) : null;
        concept = hours ? `${hours} horas adicionales de transcripción` : "Horas adicionales de transcripción";
        coverage = data?.valid_until
          ? `hasta el ${formatLongDate(data.valid_until)}, fin del período de facturación`
          : "hasta el fin del período de facturación en curso";
        break;
      }
      case "video_pack":
        concept =
          input.quantity === 1 ? "1 videollamada" : `${input.quantity ?? ""} videollamadas`.trim();
        coverage = VIDEO_COVERAGE;
        break;
      default:
        concept = "Pago en E-Irene";
        coverage = "—";
    }
  } catch (error) {
    logger.error("billing.payment_confirmation_failed", { clinicId: input.clinicId, error });
    return;
  }

  await sendPaymentConfirmation({
    clinicId: input.clinicId,
    concept,
    amountInCents: input.amountInCents,
    coverage,
    reference: input.transactionId,
  });
}

/** Confirmación de una renovación automática que efectivamente extendió el período. */
export async function confirmRenewal(input: {
  clinicId: string;
  planLabel: string;
  amountInCents: number;
  previousPeriodEnd: string;
  newPeriodEnd: string;
  transactionId: string;
}): Promise<void> {
  await sendPaymentConfirmation({
    clinicId: input.clinicId,
    concept: `Renovación del plan ${input.planLabel}`,
    amountInCents: input.amountInCents,
    coverage: `del ${formatLongDate(input.previousPeriodEnd)} al ${formatLongDate(input.newPeriodEnd)}`,
    reference: input.transactionId,
  });
}

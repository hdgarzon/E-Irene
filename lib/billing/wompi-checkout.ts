import { PLANS, type Plan } from "@/lib/plans";
import { logger } from "@/lib/logger";
import { buildBillingReference } from "./wompi";

const WOMPI_BASE = {
  sandbox: "https://sandbox.wompi.co/v1",
  production: "https://production.wompi.co/v1",
};

export interface WompiCheckoutInput {
  clinicId: string;
  plan: Plan;
  redirectUrl: string;
  userEmail?: string;
}

export interface WompiCheckoutResult {
  paymentLinkId: string;
  reference: string;
  checkoutUrl: string;
  status: string;
}

function getBaseUrl(): string {
  const env = process.env.WOMPI_ENVIRONMENT ?? "sandbox";
  return env === "production" ? WOMPI_BASE.production : WOMPI_BASE.sandbox;
}

function getPrivateKey(): string {
  const key = process.env.WOMPI_PRIVATE_KEY;
  if (!key) throw new Error("WOMPI_PRIVATE_KEY no está configurada");
  return key;
}

/**
 * Inicia un checkout de "mejorar plan" en Wompi creando un Payment Link. El
 * usuario es redirigido a la URL del link para completar el pago. Wompi
 * notifica el resultado vía webhook (transaction.updated) y guardamos el
 * payment_source_id para el cobro recurrente.
 *
 * ⚠️ Wompi no permite crear transacciones directas con redirect_url sin un
 * token de tarjeta previamente tokenizado. El Payment Link es la forma
 * correcta de obtener un checkout redirect sin widget frontend.
 */
export async function createWompiCheckout(input: WompiCheckoutInput): Promise<WompiCheckoutResult> {
  const reference = buildBillingReference(input.clinicId, input.plan);
  const amountInCents = PLANS[input.plan].priceInCents;

  if (amountInCents <= 0) {
    throw new Error(`El plan ${input.plan} no requiere pago`);
  }

  const body = {
    name: `Plan ${PLANS[input.plan].label} · E-Irene`,
    description: `Suscripción mensual al plan ${PLANS[input.plan].label}`,
    // Requeridos por Wompi (POST /v1/payment_links devuelve 422
    // INPUT_VALIDATION_ERROR sin ellos, confirmado contra la respuesta real
    // en producción — no son opcionales pese a lo que dice la doc pública).
    // single_use=true: un link = un cobro, no queremos que el mismo link de
    // "mejorar a Pro" sirva para pagar dos veces. collect_shipping=false:
    // E-Irene es un servicio, no hay nada que enviar.
    single_use: true,
    collect_shipping: false,
    amount_in_cents: amountInCents,
    currency: "COP",
    reference,
    redirect_url: input.redirectUrl,
    customer_email: input.userEmail ?? undefined,
  };

  const res = await fetch(`${getBaseUrl()}/payment_links`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getPrivateKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const responseText = await res.text();
  let responseData: unknown;
  try {
    responseData = JSON.parse(responseText);
  } catch {
    responseData = null;
  }

  if (!res.ok) {
    logger.error("wompi.checkout_failed", {
      clinicId: input.clinicId,
      plan: input.plan,
      status: res.status,
      response: responseText.slice(0, 500),
    });
    throw new Error(`Wompi respondió ${res.status}: ${responseText.slice(0, 200)}`);
  }

  const data = responseData as {
    data?: {
      id?: string;
      status?: string;
      url?: string;
      payment_link_url?: string;
      checkout_url?: string;
    };
  } | null;

  const paymentLinkId = data?.data?.id;
  const status = data?.data?.status ?? "UNKNOWN";
  const checkoutUrl =
    data?.data?.url ?? data?.data?.payment_link_url ?? data?.data?.checkout_url;

  if (!paymentLinkId || !checkoutUrl) {
    logger.error("wompi.checkout_unexpected_response", {
      clinicId: input.clinicId,
      plan: input.plan,
      response: responseText.slice(0, 500),
    });
    throw new Error("La respuesta de Wompi no incluyó el id del link o la URL de pago");
  }

  logger.info("wompi.checkout_created", {
    clinicId: input.clinicId,
    plan: input.plan,
    paymentLinkId,
    reference,
  });

  return { paymentLinkId, reference, checkoutUrl, status };
}

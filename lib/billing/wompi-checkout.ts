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
  transactionId: string;
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
 * Inicia un checkout de "mejorar plan" en Wompi. Crea una transacción con
 * `redirect_url` para que el usuario complete el pago en Wompi. El medio de
 * pago tokenizado (`payment_source_id`) vuelve en el webhook y se reutiliza
 * para el cobro recurrente.
 *
 * ⚠️ La forma exacta del body y de la respuesta de Wompi debe validarse con
 * un sandbox real. Esta implementación sigue la documentación pública:
 * https://docs.wompi.co/en/docs/colombia/transactions/
 */
export async function createWompiCheckout(input: WompiCheckoutInput): Promise<WompiCheckoutResult> {
  const reference = buildBillingReference(input.clinicId, input.plan);
  const amountInCents = PLANS[input.plan].priceInCents;

  if (amountInCents <= 0) {
    throw new Error(`El plan ${input.plan} no requiere pago`);
  }

  const body = {
    amount_in_cents: amountInCents,
    currency: "COP",
    customer_email: input.userEmail ?? null,
    reference,
    payment_method: { type: "CARD" },
    redirect_url: input.redirectUrl,
  };

  const res = await fetch(`${getBaseUrl()}/transactions`, {
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
      redirect_url?: string;
      payment_link_url?: string;
      payment_url?: string;
    };
  } | null;

  const transactionId = data?.data?.id;
  const status = data?.data?.status ?? "UNKNOWN";
  const checkoutUrl =
    data?.data?.redirect_url ?? data?.data?.payment_link_url ?? data?.data?.payment_url;

  if (!transactionId || !checkoutUrl) {
    logger.error("wompi.checkout_unexpected_response", {
      clinicId: input.clinicId,
      plan: input.plan,
      response: responseText.slice(0, 500),
    });
    throw new Error("La respuesta de Wompi no incluyó el id de transacción o la URL de pago");
  }

  logger.info("wompi.checkout_created", {
    clinicId: input.clinicId,
    plan: input.plan,
    transactionId,
    reference,
  });

  return { transactionId, reference, checkoutUrl, status };
}

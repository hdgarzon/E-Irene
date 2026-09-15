import {
  PLANS,
  TRANSCRIPTION_PACK,
  VIDEO_CALL_PRICE_IN_CENTS,
  videoPackPriceInCents,
  type Plan,
  type VideoPackSize,
} from "@/lib/plans";
import { logger } from "@/lib/logger";
import {
  buildBillingReference,
  buildPlanChangeReference,
  buildTranscriptionPackReference,
  buildVideoPackReference,
} from "./wompi";
import { recordCheckout, type CheckoutKind } from "@/lib/db/billing-checkouts";
import type { UpgradeQuote } from "./proration";

const WOMPI_BASE = {
  sandbox: "https://sandbox.wompi.co/v1",
  production: "https://production.wompi.co/v1",
};

/** Checkout público de Wompi. Único para sandbox y producción: el modo lo
 *  determina el prefijo del id del payment link (`test_` = pruebas). */
const WOMPI_CHECKOUT_BASE = "https://checkout.wompi.co/l";

/**
 * Vigencia del link de un upgrade. Es una cotización: la diferencia baja con
 * cada minuto que pasa y deja de valer si cambia el plan o el período. Un link
 * que no vence permitiría pagar mañana el monto de hoy.
 */
export const UPGRADE_LINK_TTL_MS = 30 * 60 * 1000;

/**
 * Vigencia del link de un adicional (bolsa de transcripción). No es una cotización,
 * pero un link abierto sin fecha permitiría pagar meses después al precio de hoy.
 */
export const ADDON_LINK_TTL_MS = 24 * 60 * 60 * 1000;

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

/** `expires_at` como lo documenta Wompi: ISO 8601 en UTC, sin zona ("2040-12-10T14:30:00"). */
export function wompiExpiresAt(date: Date): string {
  return date.toISOString().slice(0, 19);
}

interface PaymentLinkInput {
  clinicId: string;
  kind: CheckoutKind;
  plan: Plan;
  amountInCents: number;
  name: string;
  description: string;
  reference: string;
  redirectUrl: string;
  userEmail?: string;
  expiresAt?: Date;
  details?: Record<string, unknown>;
  quantity?: number | null;
}

/**
 * Crea un Payment Link de Wompi y registra a qué compra corresponde.
 *
 * ⚠️ Wompi no permite crear transacciones directas con redirect_url sin un
 * token de tarjeta previamente tokenizado. El Payment Link es la forma
 * correcta de obtener un checkout redirect sin widget frontend.
 */
async function createPaymentLink(input: PaymentLinkInput): Promise<WompiCheckoutResult> {
  const body = {
    name: input.name,
    description: input.description,
    // Requeridos por Wompi (POST /v1/payment_links devuelve 422
    // INPUT_VALIDATION_ERROR sin ellos, confirmado contra la respuesta real
    // en producción — no son opcionales pese a lo que dice la doc pública).
    // single_use=true: un link = un cobro, el mismo link no sirve para pagar
    // dos veces. collect_shipping=false: E-Irene es un servicio, no hay nada
    // que enviar.
    single_use: true,
    collect_shipping: false,
    amount_in_cents: input.amountInCents,
    currency: "COP",
    reference: input.reference,
    redirect_url: input.redirectUrl,
    customer_email: input.userEmail ?? undefined,
    ...(input.expiresAt ? { expires_at: wompiExpiresAt(input.expiresAt) } : {}),
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
      kind: input.kind,
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
    };
  } | null;

  const paymentLinkId = data?.data?.id;
  const status = data?.data?.status ?? "CREATED";

  if (!paymentLinkId) {
    logger.error("wompi.checkout_unexpected_response", {
      clinicId: input.clinicId,
      kind: input.kind,
      plan: input.plan,
      response: responseText.slice(0, 500),
    });
    throw new Error("La respuesta de Wompi no incluyó el id del payment link");
  }

  // La respuesta de Wompi NO trae la URL de pago: el comercio la construye a
  // partir del id (https://docs.wompi.co/en/docs/colombia/links-de-pago/).
  // El mismo dominio sirve sandbox y producción — lo que determina el modo es
  // el prefijo del id (`test_...`), verificado abriendo un link real de
  // sandbox: muestra "MODO DE PRUEBAS" y el monto correcto.
  const checkoutUrl = `${WOMPI_CHECKOUT_BASE}/${paymentLinkId}`;

  // Se persiste ANTES de devolver la URL: es el único vínculo entre el pago y
  // la clínica, y lo único que dice qué se compró. Wompi descarta nuestra
  // `reference` en los pagos por payment link y devuelve una propia (ver
  // migraciones 0031 y 0056).
  await recordCheckout({
    paymentLinkId,
    clinicId: input.clinicId,
    plan: input.plan,
    amountInCents: input.amountInCents,
    reference: input.reference,
    kind: input.kind,
    quantity: input.quantity ?? null,
    details: input.details,
    expiresAt: input.expiresAt?.toISOString() ?? null,
  });

  logger.info("wompi.checkout_created", {
    clinicId: input.clinicId,
    kind: input.kind,
    plan: input.plan,
    paymentLinkId,
    reference: input.reference,
  });

  return { paymentLinkId, reference: input.reference, checkoutUrl, status };
}

/**
 * Checkout para comprar un plan por su precio completo: suscripción nueva, que
 * empieza un ciclo en el momento del pago. Wompi notifica el resultado vía
 * webhook (transaction.updated) y se guarda el payment_source_id para el cobro
 * recurrente.
 */
export async function createWompiCheckout(input: WompiCheckoutInput): Promise<WompiCheckoutResult> {
  const amountInCents = PLANS[input.plan].priceInCents;

  if (amountInCents === null) {
    throw new Error(`El plan ${input.plan} es a convenir y no se cobra por Wompi`);
  }
  if (amountInCents <= 0) {
    throw new Error(`El plan ${input.plan} no requiere pago`);
  }

  return createPaymentLink({
    clinicId: input.clinicId,
    kind: "plan",
    plan: input.plan,
    amountInCents,
    name: `Plan ${PLANS[input.plan].label} · E-Irene`,
    description: `Suscripción mensual al plan ${PLANS[input.plan].label}`,
    reference: buildBillingReference(input.clinicId, input.plan),
    redirectUrl: input.redirectUrl,
    userEmail: input.userEmail,
  });
}

/**
 * Checkout de la diferencia prorrateada de un upgrade (lib/billing/proration.ts).
 * El link vence en UPGRADE_LINK_TTL_MS y guarda la cotización, que el
 * cumplimiento vuelve a comprobar antes de subir el plan (apply_plan_upgrade).
 */
export async function createUpgradeCheckout(input: {
  clinicId: string;
  quote: UpgradeQuote;
  redirectUrl: string;
  userEmail?: string;
  now?: Date;
}): Promise<WompiCheckoutResult> {
  const { quote } = input;
  const now = input.now ?? new Date();
  const fromLabel = PLANS[quote.fromPlan].label;
  const toLabel = PLANS[quote.toPlan].label;

  return createPaymentLink({
    clinicId: input.clinicId,
    kind: "upgrade",
    plan: quote.toPlan,
    amountInCents: quote.amountInCents,
    name: `Cambio al plan ${toLabel} · E-Irene`,
    description: `Diferencia del plan ${fromLabel} al plan ${toLabel} por lo que queda del ciclo actual`,
    reference: buildPlanChangeReference(input.clinicId, quote.toPlan),
    redirectUrl: input.redirectUrl,
    userEmail: input.userEmail,
    expiresAt: new Date(now.getTime() + UPGRADE_LINK_TTL_MS),
    details: {
      from_plan: quote.fromPlan,
      to_plan: quote.toPlan,
      period_end: quote.periodEnd,
      cycle_start: quote.cycleStart,
      quoted_at: now.toISOString(),
    },
  });
}

/**
 * Checkout de una bolsa de transcripción (migración 0057). Las horas vencen con el
 * ciclo vigente cuando se aprueba el pago; `cycleEnd` queda en el registro como
 * constancia de lo que se ofreció. La base la otorga una sola vez
 * (grant_transcription_pack).
 */
export async function createTranscriptionPackCheckout(input: {
  clinicId: string;
  plan: Plan;
  cycleEnd: string;
  redirectUrl: string;
  userEmail?: string;
  now?: Date;
}): Promise<WompiCheckoutResult> {
  const now = input.now ?? new Date();
  return createPaymentLink({
    clinicId: input.clinicId,
    kind: "transcription_pack",
    plan: input.plan,
    amountInCents: TRANSCRIPTION_PACK.priceInCents,
    name: `${TRANSCRIPTION_PACK.hours} h de transcripción · E-Irene`,
    description: `${TRANSCRIPTION_PACK.hours} horas adicionales de transcripción hasta el fin del ciclo actual`,
    reference: buildTranscriptionPackReference(input.clinicId),
    redirectUrl: input.redirectUrl,
    userEmail: input.userEmail,
    expiresAt: new Date(now.getTime() + ADDON_LINK_TTL_MS),
    quantity: 1,
    details: {
      hours: TRANSCRIPTION_PACK.hours,
      cycle_end: input.cycleEnd,
      quoted_at: now.toISOString(),
    },
  });
}

/**
 * Checkout de un pack de videollamadas (migración 0058): 1, 5 o 10 a $9.000 cada una,
 * sin vencimiento. La base lo otorga una sola vez (grant_video_pack) y vuelve a
 * comprobar cantidad y monto.
 */
export async function createVideoPackCheckout(input: {
  clinicId: string;
  plan: Plan;
  quantity: VideoPackSize;
  redirectUrl: string;
  userEmail?: string;
  now?: Date;
}): Promise<WompiCheckoutResult> {
  const now = input.now ?? new Date();
  const calls = input.quantity === 1 ? "1 videollamada" : `${input.quantity} videollamadas`;
  return createPaymentLink({
    clinicId: input.clinicId,
    kind: "video_pack",
    plan: input.plan,
    amountInCents: videoPackPriceInCents(input.quantity),
    name: `${calls} · E-Irene`,
    description: `Pack de ${calls} para consultas por video, sin vencimiento`,
    reference: buildVideoPackReference(input.clinicId, input.quantity),
    redirectUrl: input.redirectUrl,
    userEmail: input.userEmail,
    expiresAt: new Date(now.getTime() + ADDON_LINK_TTL_MS),
    quantity: input.quantity,
    details: {
      calls: input.quantity,
      unit_price_in_cents: VIDEO_CALL_PRICE_IN_CENTS,
      quoted_at: now.toISOString(),
    },
  });
}

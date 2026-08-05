import { NextResponse } from "next/server";
import { processRecurringCharges } from "@/lib/billing/recurring";
import { logger } from "@/lib/logger";

/**
 * Endpoint de cron para cobros recurrentes. Protegido por CRON_SECRET en el
 * header Authorization — Vercel lo agrega automáticamente en cada invocación
 * (ver https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs).
 * Lo dispara Vercel Cron Jobs diariamente (vercel.json), NO pg_cron.
 *
 * DEBE ser GET: Vercel Cron Jobs siempre invoca por HTTP GET, nunca POST —
 * confirmado contra la documentación oficial. Con POST este endpoint nunca
 * se ejecuta (404/405 silencioso, sin reintento — Vercel no reintenta cron
 * jobs fallidos), que es exactamente lo que estaba pasando antes de este fix.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    logger.error("cron_billing.missing_secret");
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const auth = request.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (token !== expected) {
    logger.warn("cron_billing.unauthorized");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await processRecurringCharges();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    logger.error("cron_billing.failed", { error });
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }
}

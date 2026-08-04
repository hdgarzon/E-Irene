import { NextResponse } from "next/server";
import { processRecurringCharges } from "@/lib/billing/recurring";
import { logger } from "@/lib/logger";

/**
 * Endpoint de cron para cobros recurrentes. Protegido por CRON_SECRET en el
 * header Authorization. Lo dispara pg_cron diariamente.
 */
export async function POST(request: Request): Promise<NextResponse> {
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

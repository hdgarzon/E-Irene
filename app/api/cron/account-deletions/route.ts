import { NextResponse } from "next/server";
import { purgeExpiredAccountIdentities, runDueAccountDeletions } from "@/lib/db/account-deletion";
import { logger } from "@/lib/logger";

/**
 * Ejecuta las eliminaciones de cuenta cuyo plazo de 30 días ya venció, y
 * suprime la identificación de las eliminadas hace más de 2 años (ver
 * lib/db/account-deletion.ts). Corre aquí y no en pg_cron porque los archivos
 * de la clínica se borran por la API de Storage.
 *
 * DEBE ser GET: Vercel Cron Jobs siempre invoca por HTTP GET. Mismo patrón y
 * misma protección por CRON_SECRET que /api/cron/purge-documents.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    logger.error("cron_account_deletions.missing_secret");
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const auth = request.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (token !== expected) {
    logger.warn("cron_account_deletions.unauthorized");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Independientes: que una falle no deja sin correr la otra.
  let deletions = null;
  try {
    deletions = await runDueAccountDeletions();
    logger.info("cron_account_deletions.done", { ...deletions });
  } catch (error) {
    logger.error("cron_account_deletions.failed", { error });
  }

  let identities = null;
  try {
    identities = await purgeExpiredAccountIdentities();
    logger.info("cron_account_identities.done", { ...identities });
  } catch (error) {
    logger.error("cron_account_identities.failed", { error });
  }

  if (!deletions || !identities) {
    return NextResponse.json({ error: "processing_failed", deletions, identities }, { status: 500 });
  }
  if (deletions.failed > 0 || identities.failed > 0) {
    return NextResponse.json({ error: "partial_failure", deletions, identities }, { status: 500 });
  }
  return NextResponse.json({ ok: true, deletions, identities });
}

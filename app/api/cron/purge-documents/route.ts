import { NextResponse } from "next/server";
import {
  purgeExpiredVerificationDocuments,
  purgeOrphanVerificationDocuments,
  type OrphanSweepResult,
  type PurgeResult,
} from "@/lib/db/verification-documents";
import { logger } from "@/lib/logger";

/**
 * Borrado de los documentos de identidad del profesional cuya verificación ya
 * cumplió el plazo de retención (ver lib/db/verification-documents.ts), y de
 * los que ya no referencia ninguna fila: envíos reemplazados o rechazados.
 *
 * Corre aquí y no en pg_cron —a diferencia de la purga de transcripciones—
 * porque hay que pasar por la API de Storage: borrar filas de
 * `storage.objects` desde SQL dejaría los archivos huérfanos.
 *
 * DEBE ser GET: Vercel Cron Jobs siempre invoca por HTTP GET. Mismo patrón y
 * misma protección por CRON_SECRET que /api/cron/billing.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    logger.error("cron_purge_docs.missing_secret");
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const auth = request.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (token !== expected) {
    logger.warn("cron_purge_docs.unauthorized");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let expired: PurgeResult | null = null;
  try {
    expired = await purgeExpiredVerificationDocuments();
    logger.info("cron_purge_docs.done", { ...expired });
  } catch (error) {
    logger.error("cron_purge_docs.failed", { error });
  }

  // Independiente de la purga por plazo: que una falle no deja sin correr la otra.
  let orphans: OrphanSweepResult | null = null;
  try {
    orphans = await purgeOrphanVerificationDocuments();
    logger.info("cron_purge_docs.orphans_done", { ...orphans });
  } catch (error) {
    logger.error("cron_purge_docs.orphans_failed", { error });
  }

  if (!expired || !orphans) {
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, ...expired, orphans });
}

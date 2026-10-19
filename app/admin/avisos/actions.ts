"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/auth";
import { createLegalNotice, emailLegalNotice } from "@/lib/db/legal-notices";
import { earliestEffectiveDate, effectiveAtFromDate, hasEnoughNotice } from "@/lib/legal-notices";
import { formatLongDate } from "@/lib/dates";
import { logger } from "@/lib/logger";

export type NoticeState = { ok?: string; error?: string };

const schema = z.object({
  title: z.string().trim().min(5, "Escribe un título").max(200),
  body: z.string().trim().min(20, "Explica qué cambia (mínimo 20 caracteres)").max(5000),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Elige la fecha de vigencia"),
});

export async function createLegalNoticeAction(_prev: NoticeState, formData: FormData): Promise<NoticeState> {
  const admin = await requirePlatformAdmin();
  const parsed = schema.safeParse({
    title: formData.get("title"),
    body: formData.get("body"),
    effectiveDate: formData.get("effectiveDate"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  // La antelación mínima es una obligación de los documentos, no una sugerencia.
  if (!hasEnoughNotice(parsed.data.effectiveDate)) {
    const earliest = earliestEffectiveDate();
    return {
      error: `La vigencia debe dar al menos 15 días hábiles de aviso: lo más pronto es el ${formatLongDate(`${earliest}T12:00:00-05:00`)}.`,
    };
  }

  try {
    await createLegalNotice({
      title: parsed.data.title,
      body: parsed.data.body,
      effectiveAt: effectiveAtFromDate(parsed.data.effectiveDate),
      createdBy: admin.id,
    });
  } catch (error) {
    logger.error("legal_notice.create_failed", { error });
    return { error: "No se pudo crear el aviso." };
  }
  revalidatePath("/admin/avisos");
  return { ok: "Aviso publicado en la plataforma. Falta enviarlo por correo." };
}

export async function emailLegalNoticeAction(id: string): Promise<void> {
  await requirePlatformAdmin();
  try {
    const result = await emailLegalNotice(id);
    logger.info("legal_notice.emailed", { noticeId: id, ...result });
  } catch (error) {
    logger.error("legal_notice.email_run_failed", { noticeId: id, error });
    throw error;
  }
  revalidatePath("/admin/avisos");
}

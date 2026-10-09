"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/auth";
import { updatePqrStatus } from "@/lib/db/pqr";
import { PQR_STATUSES, type PqrStatus } from "@/lib/pqr";
import { logger } from "@/lib/logger";

export async function setPqrStatusAction(id: string, formData: FormData): Promise<void> {
  await requirePlatformAdmin();
  const status = String(formData.get("status") ?? "");
  if (!PQR_STATUSES.includes(status as PqrStatus)) return;
  try {
    await updatePqrStatus(id, status as PqrStatus);
  } catch (error) {
    logger.error("pqr.status_update_failed", { id, status, error });
    throw error;
  }
  revalidatePath("/admin/pqr");
}

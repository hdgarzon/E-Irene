"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/auth";
import { rotateEncryptedData, type KeyRotationRun } from "@/lib/key-rotation";
import { logger } from "@/lib/logger";

export type RotationState = { run?: KeyRotationRun; error?: string };

/** Una pasada de recifrado de hasta 4 minutos; si queda algo, se vuelve a pulsar. */
export async function runKeyRotationAction(): Promise<RotationState> {
  await requirePlatformAdmin();
  try {
    const run = await rotateEncryptedData({ timeBudgetMs: 240_000 });
    logger.info("key_rotation.pass", { ...run });
    revalidatePath("/admin/rotacion-clave");
    return { run };
  } catch (error) {
    logger.error("key_rotation.pass_failed", { error });
    return { error: "La pasada falló. Revisa los logs; lo ya recifrado queda hecho y se puede reintentar." };
  }
}

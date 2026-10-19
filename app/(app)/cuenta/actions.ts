"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { setMarketingOptIn } from "@/lib/db/policy-acceptances";
import { logger } from "@/lib/logger";

export type MarketingState = { error?: string };

export async function setMarketingOptInAction(optIn: boolean): Promise<MarketingState> {
  const user = await requireUser();
  try {
    await setMarketingOptIn({ userId: user.id, clinicId: user.clinicId, optIn });
  } catch (error) {
    logger.error("marketing.preference_failed", { userId: user.id, optIn, error });
    return { error: "No se pudo guardar tu preferencia. Intenta de nuevo." };
  }
  revalidatePath("/cuenta");
  return {};
}

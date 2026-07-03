"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/auth";
import { setClinicPlan, setClinicSuspended } from "@/lib/db/platform-admin";

const PLANS = ["free", "pro", "clinica", "enterprise"] as const;

export async function setClinicPlanAction(clinicId: string, plan: string): Promise<void> {
  await requirePlatformAdmin();
  if (!PLANS.includes(plan as (typeof PLANS)[number])) return;
  await setClinicPlan(clinicId, plan);
  revalidatePath("/admin");
}

export async function setClinicSuspendedAction(clinicId: string, suspend: boolean): Promise<void> {
  await requirePlatformAdmin();
  await setClinicSuspended(clinicId, suspend);
  revalidatePath("/admin");
}

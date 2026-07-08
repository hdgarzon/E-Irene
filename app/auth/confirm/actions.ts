"use server";

import { redirect } from "next/navigation";
import { type EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export async function confirmAction(formData: FormData) {
  const token_hash = String(formData.get("token_hash") ?? "");
  const type = formData.get("type") as EmailOtpType | null;
  const next = String(formData.get("next") || "/dashboard");

  if (!token_hash || !type) {
    redirect("/auth/auth-code-error");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash });
  if (error) {
    redirect("/auth/auth-code-error");
  }

  redirect(next);
}

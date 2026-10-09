"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { acceptCurrentPolicy } from "@/lib/db/policy-acceptances";
import { logger } from "@/lib/logger";

export type SetPasswordState = { error?: string; fieldErrors?: Record<string, string> };

const setPasswordSchema = z.object({
  clinicName: z.string().min(2, "Nombre de clínica muy corto"),
  fullName: z.string().min(2, "Ingresa tu nombre completo"),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
});

function flattenFieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

export async function setPasswordAction(
  _prev: SetPasswordState,
  formData: FormData,
): Promise<SetPasswordState> {
  const parsed = setPasswordSchema.safeParse({
    clinicName: formData.get("clinicName"),
    fullName: formData.get("fullName"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { fieldErrors: flattenFieldErrors(parsed.error) };
  }
  if (formData.get("accepted") !== "on") {
    return { fieldErrors: { accepted: "Debes marcar la declaración y la aceptación para crear la cuenta." } };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error: passwordError } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (passwordError) return { error: passwordError.message };

  const { error: rpcError } = await supabase.rpc("create_clinic_and_admin", {
    clinic_name: parsed.data.clinicName,
    full_name: parsed.data.fullName,
  });
  // Si ya se bootstrapeó antes (p. ej. enlace reutilizado), no es un error real.
  if (rpcError && !/ya pertenece/i.test(rpcError.message)) {
    return { error: rpcError.message };
  }

  // La prueba de la aceptación se guarda aquí, recién creada la cuenta. Si falla,
  // no se bloquea el registro: la compuerta de /terminos la vuelve a pedir antes
  // de dar acceso a la app (app/(app)/layout.tsx).
  const { data: profile } = await supabase
    .from("users")
    .select("clinic_id")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.clinic_id) {
    try {
      await acceptCurrentPolicy({
        userId: user.id,
        clinicId: profile.clinic_id,
        marketingOptIn: formData.get("marketing") === "on",
      });
    } catch (error) {
      logger.error("policy.accept_at_signup_failed", { userId: user.id, error });
    }
  }

  redirect("/dashboard");
}

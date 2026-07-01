"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

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

  redirect("/dashboard");
}

"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type AuthState = { error?: string; fieldErrors?: Record<string, string> };

const signUpSchema = z.object({
  clinicName: z.string().min(2, "Nombre de clínica muy corto"),
  fullName: z.string().min(2, "Ingresa tu nombre completo"),
  email: z.email("Correo inválido"),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
});

const signInSchema = z.object({
  email: z.email("Correo inválido"),
  password: z.string().min(1, "Ingresa tu contraseña"),
});

function flattenFieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

export async function signUpAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = signUpSchema.safeParse({
    clinicName: formData.get("clinicName"),
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { fieldErrors: flattenFieldErrors(parsed.error) };
  }

  const supabase = await createClient();

  // Creamos el usuario ya confirmado vía admin (no envía correo → evita el
  // rate limit de email y funciona aunque el proyecto exija confirmación).
  const admin = createAdminClient();
  const { error: createError } = await admin.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    email_confirm: true,
  });
  if (createError) {
    const dup = /already|registered|exists/i.test(createError.message);
    return { error: dup ? "Ese correo ya está registrado." : createError.message };
  }

  // Abrimos sesión para fijar las cookies del usuario.
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (signInError) return { error: "No se pudo iniciar sesión tras el registro." };

  // Con la sesión ya activa, crea la clínica + perfil admin de forma atómica.
  const { error: rpcError } = await supabase.rpc("create_clinic_and_admin", {
    clinic_name: parsed.data.clinicName,
    full_name: parsed.data.fullName,
  });
  if (rpcError) return { error: rpcError.message };

  redirect("/dashboard");
}

export async function signInAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { fieldErrors: flattenFieldErrors(parsed.error) };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: "Correo o contraseña incorrectos" };

  const redirectTo = String(formData.get("redirect") || "/dashboard");
  redirect(redirectTo.startsWith("/") ? redirectTo : "/dashboard");
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

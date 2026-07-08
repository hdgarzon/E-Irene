"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isPlatformAdmin } from "@/lib/auth";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

const TOO_MANY = "Demasiados intentos. Espera unos minutos e intenta de nuevo.";

export type AuthState = {
  error?: string;
  fieldErrors?: Record<string, string>;
  success?: boolean;
  email?: string;
};

const signUpSchema = z.object({
  clinicName: z.string().min(2, "Nombre de clínica muy corto"),
  fullName: z.string().min(2, "Ingresa tu nombre completo"),
  email: z.email("Correo inválido"),
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
  });
  if (!parsed.success) {
    return { fieldErrors: flattenFieldErrors(parsed.error) };
  }

  // Cada signup envía un correo (magic link) → limitamos por IP y por email
  // para evitar spam/abuso de envío. Ventana de 1 hora.
  const ip = await getClientIp();
  const email = parsed.data.email.toLowerCase();
  const [ipOk, emailOk] = await Promise.all([
    checkRateLimit(`signup:ip:${ip}`, 5, 3600),
    checkRateLimit(`signup:email:${email}`, 3, 3600),
  ]);
  if (!ipOk || !emailOk) return { error: TOO_MANY };

  const supabase = await createClient();

  // Envía un magic link para confirmar el correo. clinic_name/full_name viajan
  // como metadata del usuario solo para prellenar el paso de "fijar contraseña"
  // tras la activación — no se usan para decisiones de autorización.
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      data: {
        clinic_name: parsed.data.clinicName,
        full_name: parsed.data.fullName,
      },
    },
  });
  if (error) return { error: error.message };

  return { success: true, email: parsed.data.email };
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

  // Anti fuerza bruta: máx. 10 intentos por IP cada 5 min. La clave incluye el
  // correo para no penalizar a distintos usuarios tras la misma IP (NAT), pero
  // el límite por IP sigue frenando el barrido de contraseñas.
  const ip = await getClientIp();
  const withinLimit = await checkRateLimit(
    `signin:${ip}:${parsed.data.email.toLowerCase()}`,
    10,
    300,
  );
  if (!withinLimit) return { error: TOO_MANY };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: "Correo o contraseña incorrectos" };

  // Respeta un destino explícito distinto del default; si no, el platform
  // admin entra directo a su consola y el resto a su dashboard.
  const requested = String(formData.get("redirect") || "");
  if (requested.startsWith("/") && requested !== "/dashboard") {
    redirect(requested);
  }
  redirect((await isPlatformAdmin()) ? "/admin" : "/dashboard");
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

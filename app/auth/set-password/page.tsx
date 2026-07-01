import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SetPasswordForm } from "@/components/auth/set-password-form";

export default async function SetPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: existingProfile } = await supabase
    .from("users")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();
  if (existingProfile) redirect("/dashboard");

  const clinicName = typeof user.user_metadata?.clinic_name === "string"
    ? user.user_metadata.clinic_name
    : "";
  const fullName = typeof user.user_metadata?.full_name === "string"
    ? user.user_metadata.full_name
    : "";

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-xl font-semibold">Cuenta activada</h1>
          <p className="text-sm text-muted-foreground">
            Ya confirmamos tu correo. Elige una contraseña para iniciar sesión.
          </p>
        </div>
        <SetPasswordForm clinicName={clinicName} fullName={fullName} />
      </div>
    </div>
  );
}

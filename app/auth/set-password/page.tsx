import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AuthShell } from "@/components/auth/auth-shell";
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
    <AuthShell>
      <div className="space-y-6 text-center">
        <div className="space-y-1.5">
          <h1
            style={{
              fontFamily: "var(--font-landing-serif)",
              fontWeight: 400,
              fontSize: 30,
              letterSpacing: "-0.5px",
              color: "#12283f",
            }}
          >
            Cuenta activada
          </h1>
          <p style={{ fontFamily: "var(--font-landing-sans)", fontWeight: 300, fontSize: 14, color: "#46617d" }}>
            Ya confirmamos tu correo. Elige una contraseña para iniciar sesión.
          </p>
        </div>
        <SetPasswordForm clinicName={clinicName} fullName={fullName} />
      </div>
    </AuthShell>
  );
}

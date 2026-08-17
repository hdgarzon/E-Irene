"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signUpAction, type AuthState } from "@/app/(auth)/actions";
import { LandingLiquidGlassButton } from "@/components/landing-liquid-glass-button";
import { VerifyCodeForm } from "@/components/auth/verify-code-form";

export function SignupForm() {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    signUpAction,
    {},
  );

  if (state.success && state.email) {
    return (
      <div className="space-y-4 text-center">
        <div className="space-y-1.5">
          <h2 style={{ fontFamily: "var(--font-landing-serif)", fontWeight: 400, fontSize: 20, color: "#12283f" }}>
            Revisa tu correo
          </h2>
          <p style={{ fontFamily: "var(--font-landing-sans)", fontWeight: 300, fontSize: 14, color: "#46617d" }}>
            Enviamos un código de 6 dígitos a <strong style={{ fontWeight: 500 }}>{state.email}</strong>.
            Ingrésalo para confirmar tu cuenta y elegir una contraseña.
          </p>
        </div>
        <VerifyCodeForm email={state.email} />
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4 text-left">
      <div>
        <label htmlFor="clinicName" className="landing-field-label">
          Nombre de la clínica
        </label>
        <input
          id="clinicName"
          name="clinicName"
          required
          placeholder="Consultorio Dra. Irene"
          className="landing-field-input"
        />
        {state.fieldErrors?.clinicName && (
          <p className="landing-field-error">{state.fieldErrors.clinicName}</p>
        )}
      </div>

      <div>
        <label htmlFor="fullName" className="landing-field-label">
          Tu nombre completo
        </label>
        <input
          id="fullName"
          name="fullName"
          required
          placeholder="Irene Pérez"
          className="landing-field-input"
        />
        {state.fieldErrors?.fullName && <p className="landing-field-error">{state.fieldErrors.fullName}</p>}
      </div>

      <div>
        <label htmlFor="email" className="landing-field-label">
          Correo electrónico
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="landing-field-input"
        />
        {state.fieldErrors?.email && <p className="landing-field-error">{state.fieldErrors.email}</p>}
      </div>

      {state.error && <p className="landing-form-error">{state.error}</p>}

      <LandingLiquidGlassButton type="submit" disabled={pending} className="w-full">
        {pending ? "Enviando código…" : "Crear cuenta gratis"}
      </LandingLiquidGlassButton>

      <p style={{ fontFamily: "var(--font-landing-sans)", fontWeight: 300, fontSize: 13, color: "#46617d" }} className="text-center">
        ¿Ya tienes cuenta?{" "}
        <Link href="/login" className="landing-nav-link">
          Iniciar sesión
        </Link>
      </p>
    </form>
  );
}

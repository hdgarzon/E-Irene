"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signInAction, type AuthState } from "@/app/(auth)/actions";
import { LandingLiquidGlassButton } from "@/components/landing-liquid-glass-button";

export function LoginForm({ redirect }: { redirect: string }) {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    signInAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-4 text-left">
      <input type="hidden" name="redirect" value={redirect} />

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

      <div>
        <label htmlFor="password" className="landing-field-label">
          Contraseña
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="landing-field-input"
        />
        {state.fieldErrors?.password && <p className="landing-field-error">{state.fieldErrors.password}</p>}
      </div>

      {state.error && <p className="landing-form-error">{state.error}</p>}

      <LandingLiquidGlassButton type="submit" disabled={pending} className="w-full">
        {pending ? "Ingresando…" : "Iniciar sesión"}
      </LandingLiquidGlassButton>

      <p style={{ fontFamily: "var(--font-landing-sans)", fontWeight: 300, fontSize: 13, color: "#46617d" }} className="text-center">
        ¿No tienes cuenta?{" "}
        <Link href="/signup" className="landing-nav-link">
          Crear cuenta
        </Link>
      </p>
    </form>
  );
}

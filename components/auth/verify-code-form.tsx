"use client";

import { useActionState } from "react";
import { verifyEmailCodeAction, type AuthState } from "@/app/(auth)/actions";
import { LandingLiquidGlassButton } from "@/components/landing-liquid-glass-button";

export function VerifyCodeForm({ email }: { email: string }) {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    verifyEmailCodeAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-4 text-left">
      <input type="hidden" name="email" value={email} />

      <div>
        <label htmlFor="code" className="landing-field-label">
          Código de 6 dígitos
        </label>
        <input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="123456"
          required
          className="landing-field-input"
        />
      </div>

      {state.error && <p className="landing-form-error">{state.error}</p>}

      <LandingLiquidGlassButton type="submit" disabled={pending} className="w-full">
        {pending ? "Verificando…" : "Confirmar código"}
      </LandingLiquidGlassButton>
    </form>
  );
}

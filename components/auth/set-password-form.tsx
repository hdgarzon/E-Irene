"use client";

import { useActionState } from "react";
import { setPasswordAction, type SetPasswordState } from "@/app/auth/set-password/actions";
import { LandingLiquidGlassButton } from "@/components/landing-liquid-glass-button";
import { ProfessionalAcceptanceFields } from "@/components/professional-acceptance-fields";

export function SetPasswordForm({
  clinicName,
  fullName,
}: {
  clinicName: string;
  fullName: string;
}) {
  const [state, formAction, pending] = useActionState<SetPasswordState, FormData>(
    setPasswordAction,
    {},
  );

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
          defaultValue={clinicName}
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
          defaultValue={fullName}
          className="landing-field-input"
        />
        {state.fieldErrors?.fullName && <p className="landing-field-error">{state.fieldErrors.fullName}</p>}
      </div>

      <div>
        <label htmlFor="password" className="landing-field-label">
          Contraseña
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          className="landing-field-input"
        />
        {state.fieldErrors?.password && <p className="landing-field-error">{state.fieldErrors.password}</p>}
        <p style={{ fontFamily: "var(--font-landing-sans)", fontWeight: 300, fontSize: 12, color: "#46617d", opacity: 0.8, marginTop: 6 }}>
          Mínimo 8 caracteres.
        </p>
      </div>

      {/* Pieza 2: casillas bajo el botón de registro. Aquí, y no en /signup,
          porque es donde se crea la cuenta y ya hay sesión para guardar la
          prueba (IP, user-agent, hash) a nombre del profesional. */}
      <ProfessionalAcceptanceFields />
      {state.fieldErrors?.accepted && <p className="landing-field-error">{state.fieldErrors.accepted}</p>}

      {state.error && <p className="landing-form-error">{state.error}</p>}

      <LandingLiquidGlassButton type="submit" disabled={pending} className="w-full">
        {pending ? "Creando tu cuenta…" : "Crear cuenta y entrar"}
      </LandingLiquidGlassButton>
    </form>
  );
}

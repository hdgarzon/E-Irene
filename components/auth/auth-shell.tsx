import Link from "next/link";
import { LandingAmberCascades } from "@/components/landing-amber-cascades";
import { landingFontVariables } from "@/lib/fonts";

/** Shell visual compartido por login, signup y set-password: mismo look que
 * la landing pública. No es un layout.tsx de Next porque set-password vive
 * en /auth/set-password (segmento real, no el route group (auth)) y no
 * puede compartir el layout de login/signup sin cambiar su URL. */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`${landingFontVariables} relative flex min-h-dvh flex-col items-center justify-center px-4 py-10`}
      style={{ background: "#f7fafc" }}
    >
      <div className="pointer-events-none fixed inset-0" style={{ opacity: 0.3 }}>
        <LandingAmberCascades />
      </div>

      <div className="relative z-10 flex w-full flex-col items-center">
        <Link
          href="/"
          className="no-underline"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 18,
            fontWeight: 400,
            letterSpacing: "-0.5px",
            color: "#12283f",
            marginBottom: 32,
          }}
        >
          E-Irene
        </Link>

        <div className="landing-auth-card w-full max-w-sm">{children}</div>

        <p
          style={{
            fontFamily: "var(--font-landing-sans)",
            fontWeight: 300,
            fontSize: 12,
            color: "#46617d",
            opacity: 0.75,
            marginTop: 24,
            maxWidth: 380,
            textAlign: "center",
            lineHeight: 1.6,
          }}
        >
          Datos protegidos bajo la Ley 1581 (Habeas Data). El audio de las sesiones nunca se
          almacena. <Link href="/privacidad" className="landing-nav-link">Aviso de privacidad</Link>.
        </p>
      </div>
    </div>
  );
}

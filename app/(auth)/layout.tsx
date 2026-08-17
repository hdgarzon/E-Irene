import Link from "next/link";
import { EB_Garamond, Inter } from "next/font/google";
import { LandingAmberCascades } from "@/components/landing-amber-cascades";

// Mismas tipografías que la landing pública (app/(marketing)/layout.tsx),
// cargadas aparte porque este es un route group distinto.
const ebGaramond = EB_Garamond({
  variable: "--font-landing-serif",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const inter = Inter({
  variable: "--font-landing-sans",
  subsets: ["latin"],
  weight: ["200", "300", "400", "500"],
});

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`${ebGaramond.variable} ${inter.variable} relative flex min-h-dvh flex-col items-center justify-center px-4 py-10`}
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

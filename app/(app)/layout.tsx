import { redirect } from "next/navigation";
import { EB_Garamond, Inter } from "next/font/google";
import { requireUser } from "@/lib/auth";
import { hasAcceptedCurrentPolicy } from "@/lib/db/policy-acceptances";
import { AppSidebar } from "@/components/app-sidebar";
import { MobileNav } from "@/components/mobile-nav";
import { UserMenu } from "@/components/user-menu";

// Mismas tipografías y pesos que la landing pública (app/(marketing)/layout.tsx)
// y que las pantallas de auth (components/auth/auth-shell.tsx). Se cargan aquí
// porque cada route group necesita las suyas: no se heredan del grupo vecino.
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

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  // Sin aceptación vigente no hay acceso: ante la SIC, la carga de demostrar la
  // autorización recae en el Responsable. La compuerta vive en /terminos, fuera
  // de este grupo de rutas, para no redirigirse a sí misma.
  if (!(await hasAcceptedCurrentPolicy(user.id))) redirect("/terminos");

  return (
    // --font-heading y --font-sans se redefinen AQUÍ, no globalmente: por la
    // cascada de custom properties, cada `font-heading` y cada texto de las
    // páginas internas resuelve a las tipografías de la landing sin tocar un
    // solo componente. Fuera de este contenedor (admin, marketing) nada cambia.
    <div
      className={`${ebGaramond.variable} ${inter.variable} app-shell flex min-h-dvh bg-cloud`}
      style={
        {
          // Explícito, no vía variable: `html` ya aplica font-sans y los
          // descendientes heredan ese valor YA COMPUTADO, así que redefinir
          // --font-sans acá no los alcanzaría. Los títulos los cubre la regla
          // .app-shell de globals.css.
          fontFamily: "var(--font-landing-sans)",
        } as React.CSSProperties
      }
    >
      <AppSidebar role={user.role} clinicName={user.clinicName} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-gray-line bg-card px-4 md:px-6">
          <div className="flex items-center gap-2 md:hidden">
            <MobileNav role={user.role} clinicName={user.clinicName} />
            <span className="font-heading font-semibold text-navy">E-Irene</span>
          </div>
          <div className="flex flex-1 items-center justify-end gap-4">
            <UserMenu user={user} />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}

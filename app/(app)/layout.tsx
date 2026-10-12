import { redirect } from "next/navigation";
import { landingFontVariables } from "@/lib/fonts";
import { requireUser } from "@/lib/auth";
import { hasAcceptedCurrentPolicy } from "@/lib/db/policy-acceptances";
import { AppSidebar } from "@/components/app-sidebar";
import { MobileNav } from "@/components/mobile-nav";
import { UserMenu } from "@/components/user-menu";
import { AppSectionTitle } from "@/components/app-section-title";
import { AccountDeletionBanner } from "@/components/account-deletion-banner";
import { getOpenAccountDeletion } from "@/lib/db/account-deletion";
import { LegalNoticeBanner } from "@/components/legal-notice-banner";
import { listUpcomingLegalNotices } from "@/lib/db/legal-notices";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  // Sin aceptación vigente no hay acceso: ante la SIC, la carga de demostrar la
  // autorización recae en el Responsable. La compuerta vive en /terminos, fuera
  // de este grupo de rutas, para no redirigirse a sí misma.
  if (!(await hasAcceptedCurrentPolicy(user.id))) redirect("/terminos");

  const [deletion, notices] = await Promise.all([
    getOpenAccountDeletion(user.clinicId),
    listUpcomingLegalNotices(),
  ]);

  return (
    // --font-heading y --font-sans se redefinen AQUÍ, no globalmente: por la
    // cascada de custom properties, cada `font-heading` y cada texto de las
    // páginas internas resuelve a las tipografías de la landing sin tocar un
    // solo componente. Fuera de este contenedor (admin, marketing) nada cambia.
    <div
      className={`${landingFontVariables} app-shell flex min-h-dvh bg-cloud`}
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
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b border-gray-line bg-card/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-card/80 md:px-8">
          <div className="flex items-center gap-2 md:hidden">
            <MobileNav role={user.role} clinicName={user.clinicName} />
            <span className="font-display text-lg font-semibold text-navy">E-Irene</span>
          </div>
          <AppSectionTitle />
          <div className="flex flex-1 items-center justify-end gap-4">
            <UserMenu user={user} />
          </div>
        </header>
        {notices.map((notice) => (
          <LegalNoticeBanner key={notice.id} notice={notice} />
        ))}
        {deletion && (
          <AccountDeletionBanner scheduledFor={deletion.scheduledFor} isAdmin={user.role === "admin"} />
        )}
        <main className="flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}

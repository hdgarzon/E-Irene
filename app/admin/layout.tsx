import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { requirePlatformAdmin } from "@/lib/auth";
import { AdminNav } from "@/components/admin-nav";
import { landingFontVariables } from "@/lib/fonts";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requirePlatformAdmin();

  return (
    // Mismo lenguaje visual que la app interna: la clase app-shell aplica las
    // tipografías de la landing a los títulos (ver globals.css) y font-family
    // fija el cuerpo. La consola comparte además los tokens de sidebar.
    <div
      className={`${landingFontVariables} app-shell flex min-h-dvh flex-col bg-cloud md:flex-row`}
      style={{ fontFamily: "var(--font-landing-sans)" }}
    >
      <aside className="flex shrink-0 flex-col bg-sidebar text-sidebar-foreground md:w-60">
        <Link
          href="/admin"
          className="flex h-16 items-center gap-2 border-b border-sidebar-border px-5 font-heading font-semibold text-white"
        >
          <ShieldCheck className="size-5 text-mint" />
          Admin de plataforma
        </Link>
        <div className="flex-1">
          <AdminNav />
        </div>
        <Link
          href="/dashboard"
          className="border-t border-sidebar-border px-5 py-4 text-sm text-sidebar-foreground/70 hover:text-white"
        >
          ← Volver a mi clínica
        </Link>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
}

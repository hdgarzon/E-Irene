"use client";

import { usePathname } from "next/navigation";
import { NAV } from "@/components/app-nav-items";

/** Nombre de la sección actual en el header, para orientarse al navegar. */
export function AppSectionTitle() {
  const pathname = usePathname();
  const item = NAV.find((i) => pathname === i.href || pathname.startsWith(i.href + "/"));
  const label = item?.label ?? (pathname.startsWith("/cuenta") ? "Mi cuenta" : pathname.startsWith("/verificacion") ? "Verificación" : null);
  if (!label) return null;
  const Icon = item?.icon;
  return (
    <p className="hidden items-center gap-2 text-sm font-medium text-muted-foreground md:flex">
      {Icon && <Icon className="size-4" />}
      {label}
    </p>
  );
}

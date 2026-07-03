"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Building2,
  Stethoscope,
  Users,
  CalendarDays,
  CreditCard,
  Settings2,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/admin", label: "Resumen", icon: LayoutDashboard, exact: true },
  { href: "/admin/clinicas", label: "Clínicas", icon: Building2 },
  { href: "/admin/doctores", label: "Doctores", icon: Stethoscope },
  { href: "/admin/pacientes", label: "Pacientes", icon: Users },
  { href: "/admin/citas", label: "Citas", icon: CalendarDays },
  { href: "/admin/planes", label: "Planes", icon: CreditCard },
  { href: "/admin/configuracion", label: "Configuración", icon: Settings2 },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 overflow-x-auto p-3 md:flex-col md:overflow-visible">
      {NAV.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(item.href + "/");
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
              active
                ? "bg-sidebar-primary font-medium text-sidebar-primary-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-white",
            )}
          >
            <Icon className="size-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

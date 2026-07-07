"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Menu, X } from "lucide-react";
import type { UserRole } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { NAV } from "@/components/app-nav-items";

export function MobileNav({ role, clinicName }: { role: UserRole; clinicName: string }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const items = NAV.filter((i) => i.roles.includes(role) && i.enabled);

  // Cierra con Escape y bloquea el scroll del fondo mientras está abierto.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Abrir menú"
        aria-expanded={open}
        className="grid size-10 place-items-center rounded-lg text-navy hover:bg-cloud"
      >
        <Menu className="size-5" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Menú de navegación">
          <div
            className="absolute inset-0 bg-navy/40 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[80%] flex-col bg-sidebar text-sidebar-foreground shadow-xl">
            <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-5">
              <span className="flex items-center gap-2 font-heading text-lg font-bold text-white">
                <span className="grid size-8 place-items-center rounded-lg bg-sidebar-accent">
                  <Activity className="size-4 text-mint" />
                </span>
                E-Irene
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Cerrar menú"
                className="grid size-9 place-items-center rounded-lg text-sidebar-foreground hover:bg-sidebar-accent hover:text-white"
              >
                <X className="size-5" />
              </button>
            </div>

            <nav className="flex-1 space-y-1 overflow-y-auto p-3">
              {items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + "/");
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
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

            <div className="border-t border-sidebar-border p-4">
              <p className="truncate text-xs text-sidebar-foreground/60">Clínica</p>
              <p className="truncate text-sm font-medium text-white">{clinicName}</p>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

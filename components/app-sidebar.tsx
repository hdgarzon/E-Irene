"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity } from "lucide-react";
import type { UserRole } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { NAV } from "@/components/app-nav-items";

export function AppSidebar({ role, clinicName }: { role: UserRole; clinicName: string }) {
  const pathname = usePathname();
  const items = NAV.filter((i) => i.roles.includes(role));

  return (
    <aside className="hidden w-60 shrink-0 bg-sidebar text-sidebar-foreground md:block">
      <div className="sticky top-0 flex h-dvh flex-col">
        <div className="flex h-14 items-center gap-2.5 border-b border-sidebar-border px-5 font-display text-lg font-semibold text-white">
          <span className="grid size-8 place-items-center rounded-lg bg-sidebar-accent">
            <Activity className="size-4 text-mint" />
          </span>
          E-Irene
        </div>

        <nav aria-label="Principal" className="flex-1 space-y-0.5 overflow-y-auto p-3">
          {items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            const Icon = item.icon;
            if (!item.enabled) {
              return (
                <span
                  key={item.href}
                  className="flex cursor-not-allowed items-center justify-between rounded-lg px-3 py-2 text-sm text-sidebar-foreground/50"
                >
                  <span className="flex items-center gap-3">
                    <Icon className="size-4" />
                    {item.label}
                  </span>
                  <Badge variant="secondary" className="bg-sidebar-accent text-[10px] text-sidebar-foreground/80">
                    Pronto
                  </Badge>
                </span>
              );
            }
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors focus-visible:outline-mint",
                  active
                    ? "bg-sidebar-accent font-medium text-white shadow-[inset_3px_0_0_var(--color-mint)]"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-white",
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
      </div>
    </aside>
  );
}

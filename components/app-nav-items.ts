import {
  CalendarDays,
  FileText,
  LayoutDashboard,
  Mic,
  Settings,
  Users,
} from "lucide-react";
import type { UserRole } from "@/lib/auth";

export type NavItem = {
  href: string;
  label: string;
  icon: typeof Users;
  roles: UserRole[];
  enabled: boolean;
};

/** Ítems de navegación de la app, compartidos por el sidebar (desktop) y el
 * drawer (móvil). El filtrado por rol se aplica en cada consumidor. */
export const NAV: NavItem[] = [
  { href: "/dashboard", label: "Inicio", icon: LayoutDashboard, roles: ["admin", "doctor", "secretaria"], enabled: true },
  { href: "/patients", label: "Pacientes", icon: Users, roles: ["admin", "doctor", "secretaria"], enabled: true },
  { href: "/appointments", label: "Agenda", icon: CalendarDays, roles: ["admin", "doctor", "secretaria"], enabled: true },
  { href: "/consultations", label: "Consultas", icon: Mic, roles: ["admin", "doctor"], enabled: true },
  { href: "/reports", label: "Reportes", icon: FileText, roles: ["admin", "doctor"], enabled: true },
  { href: "/settings", label: "Configuración", icon: Settings, roles: ["admin"], enabled: true },
];

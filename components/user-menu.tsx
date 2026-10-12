"use client";

import Link from "next/link";
import { LogOut, UserRound } from "lucide-react";
import { signOutAction } from "@/app/(auth)/actions";
import type { SessionUser } from "@/lib/auth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const ROLE_LABEL: Record<SessionUser["role"], string> = {
  admin: "Administrador",
  doctor: "Profesional",
  secretaria: "Secretaría",
  paciente: "Paciente",
};

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

export function UserMenu({ user }: { user: SessionUser }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2.5 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:rounded-lg md:py-1 md:pr-2 md:pl-1 md:hover:bg-cloud">
        <Avatar className="size-8">
          <AvatarFallback className="bg-brand text-xs font-semibold text-white">{initials(user.fullName)}</AvatarFallback>
        </Avatar>
        <span aria-hidden className="hidden text-left leading-tight md:block">
          <span className="block max-w-44 truncate text-sm font-medium text-navy">{user.fullName}</span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <p className="font-medium">{user.fullName}</p>
            <p className="text-xs font-normal text-muted-foreground">{user.email}</p>
            <p className="mt-1 text-xs font-normal text-brand">{ROLE_LABEL[user.role]}</p>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/cuenta" />}>
          <UserRound className="size-4" />
          Mi cuenta
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <form action={signOutAction}>
          <DropdownMenuItem
            variant="destructive"
            nativeButton
            render={<button type="submit" className="w-full" />}
          >
            <LogOut className="size-4" />
            Cerrar sesión
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

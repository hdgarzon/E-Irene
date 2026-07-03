import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { requirePlatformAdmin } from "@/lib/auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requirePlatformAdmin();

  return (
    <div className="min-h-dvh bg-cloud">
      <header className="flex h-16 items-center justify-between border-b border-gray-line bg-navy px-6">
        <Link href="/admin" className="flex items-center gap-2 font-heading font-semibold text-white">
          <ShieldCheck className="size-5 text-mint" />
          E-Irene · Admin de plataforma
        </Link>
        <Link href="/dashboard" className="text-sm text-white/70 hover:text-white">
          Volver a mi clínica
        </Link>
      </header>
      <main className="mx-auto max-w-5xl p-6">{children}</main>
    </div>
  );
}

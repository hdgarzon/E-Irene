import Link from "next/link";
import { Activity } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-cloud px-4 py-10">
      <Link href="/" className="mb-6 flex items-center gap-2 font-heading text-xl font-bold text-navy">
        <span className="grid size-9 place-items-center rounded-lg bg-navy text-white">
          <Activity className="size-4 text-mint" />
        </span>
        E-Irene
      </Link>
      <div className="w-full max-w-sm rounded-2xl border border-gray-line bg-card p-6 shadow-sm sm:p-8">
        {children}
      </div>
      <p className="mt-6 max-w-sm text-center text-xs text-muted-foreground">
        Datos protegidos bajo la Ley 1581 (Habeas Data). El audio de las sesiones nunca se almacena.
      </p>
    </div>
  );
}

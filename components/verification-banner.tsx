import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import type { VerificationStatus } from "@/lib/verification";
import { VERIFICATION_DESCRIPTIONS } from "@/lib/verification";

/**
 * Aviso persistente mientras la cuenta no esté verificada. Aparece arriba del
 * dashboard porque las rutas clínicas redirigen a /verificacion sin explicación
 * si el profesional llega a ellas por un enlace directo.
 */
export function VerificationBanner({ status }: { status: VerificationStatus }) {
  if (status === "verified") return null;

  return (
    <Link
      href="/verificacion"
      className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 transition-colors hover:bg-amber-100"
    >
      <ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-700" />
      <div className="space-y-0.5">
        <p className="font-medium text-amber-900">Tu cuenta aún no está verificada</p>
        <p className="text-sm text-amber-900/80">{VERIFICATION_DESCRIPTIONS[status]}</p>
      </div>
    </Link>
  );
}

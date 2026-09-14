import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import {
  LEGACY_VERIFICATION_DEADLINE,
  VERIFICATION_DESCRIPTIONS,
  type LegacyVerificationState,
  type VerificationStatus,
} from "@/lib/verification";
import { formatLongDate } from "@/lib/dates";

/**
 * Aviso persistente mientras la cuenta no esté verificada. Aparece arriba del
 * dashboard porque las rutas clínicas redirigen a /verificacion sin explicación
 * si el profesional llega a ellas por un enlace directo.
 *
 * También avisa a las cuentas heredadas (migración 0043): figuran como
 * verificadas, pero se aprobaron sin documentos y los deben aportar antes del
 * plazo. Sin este aviso, su primera noticia sería perder la creación de
 * pacientes y consultas.
 */
export function VerificationBanner({
  status,
  legacy = "none",
}: {
  status: VerificationStatus;
  legacy?: LegacyVerificationState;
}) {
  if (legacy === "needs_documents") {
    return (
      <Link
        href="/verificacion"
        className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 transition-colors hover:bg-amber-100"
      >
        <ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-700" />
        <div className="space-y-0.5">
          <p className="font-medium text-amber-900">
            Confirma tu habilitación profesional antes del{" "}
            {formatLongDate(LEGACY_VERIFICATION_DEADLINE)}
          </p>
          <p className="text-sm text-amber-900/80">
            Tu cuenta se aprobó sin revisar documentos. Sube tu cédula y tu tarjeta profesional para
            seguir creando pacientes y consultas después de esa fecha.
          </p>
        </div>
      </Link>
    );
  }

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

import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import {
  LEGACY_VERIFICATION_DEADLINE,
  VERIFICATION_DESCRIPTIONS,
  daysUntilLegacyDeadline,
  legacyDeadlineUrgency,
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
    // El aviso escala con la fecha porque es el ÚNICO canal: sin
    // RESEND_API_KEY en producción no sale ningún correo, y por eso mismo el
    // plazo ya se prorrogó una vez (migración 0043, "nadie les avisó"). Un
    // aviso que se ve igual a 30 días que a 2 no cumple su función.
    const urgencia = legacyDeadlineUrgency();
    const dias = daysUntilLegacyDeadline();
    const urgente = urgencia !== "lejano";
    const cuando =
      dias < 0
        ? "El plazo ya venció"
        : dias === 0
          ? "El plazo vence hoy"
          : dias === 1
            ? "El plazo vence mañana"
            : `Quedan ${dias} días`;

    return (
      <Link
        href="/verificacion"
        className={
          urgente
            ? "flex items-start gap-3 rounded-2xl border border-destructive/40 bg-destructive/5 p-4 transition-colors hover:bg-destructive/10"
            : "flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 transition-colors hover:bg-amber-100"
        }
      >
        <ShieldAlert
          className={`mt-0.5 size-5 shrink-0 ${urgente ? "text-destructive" : "text-amber-700"}`}
        />
        <div className="space-y-0.5">
          <p className={`font-medium ${urgente ? "text-destructive" : "text-amber-900"}`}>
            {urgente
              ? `${cuando} para confirmar tu habilitación profesional`
              : `Confirma tu habilitación profesional antes del ${formatLongDate(LEGACY_VERIFICATION_DEADLINE)}`}
          </p>
          <p className={`text-sm ${urgente ? "text-foreground/80" : "text-amber-900/80"}`}>
            {urgente
              ? `Sube tu cédula y tu tarjeta profesional antes del ${formatLongDate(LEGACY_VERIFICATION_DEADLINE)}. Sin ellas dejarás de poder crear pacientes y consultas.`
              : "Tu cuenta se aprobó sin revisar documentos. Sube tu cédula y tu tarjeta profesional para seguir creando pacientes y consultas después de esa fecha."}
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

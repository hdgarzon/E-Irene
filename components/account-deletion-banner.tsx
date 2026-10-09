import Link from "next/link";
import { Trash2 } from "lucide-react";
import { formatLongDate } from "@/lib/dates";

/**
 * Aviso de eliminación en curso, en todas las pantallas de la app y para todo
 * el equipo: cualquiera puede tener historias que exportar o motivos para
 * pedirle al admin que desista.
 */
export function AccountDeletionBanner({
  scheduledFor,
  isAdmin,
}: {
  scheduledFor: string;
  isAdmin: boolean;
}) {
  const fecha = formatLongDate(scheduledFor);
  return (
    <div
      role="status"
      className="flex items-start gap-3 border-b border-destructive/30 bg-destructive/5 px-4 py-3 text-sm md:px-6"
    >
      <Trash2 className="mt-0.5 size-4 shrink-0 text-destructive" />
      <p className="text-foreground/90">
        <strong className="text-destructive">La cuenta de la clínica se eliminará el {fecha}</strong>, con
        todos sus pacientes y su información clínica.{" "}
        {isAdmin ? (
          <>
            Exporta los datos o desiste en{" "}
            <Link href="/settings" className="underline hover:text-navy">
              Configuración
            </Link>
            .
          </>
        ) : (
          "Si necesitas conservar algo, pídele al administrador de la clínica que exporte los datos o desista."
        )}
      </p>
    </div>
  );
}

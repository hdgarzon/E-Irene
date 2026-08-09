import { redirect } from "next/navigation";
import { Activity } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { hasAcceptedCurrentPolicy } from "@/lib/db/policy-acceptances";
import { POLICY_TEXT, POLICY_VERSION } from "@/lib/legal";
import { AcceptPolicyForm } from "@/components/accept-policy-form";

/**
 * Compuerta de aceptación. Vive fuera del grupo (app) a propósito: el layout de
 * (app) redirige aquí a quien no haya aceptado, y si esta página estuviera
 * dentro se redirigiría a sí misma en bucle.
 *
 * Cubre por igual a quien se registra, a quien un admin da de alta desde el
 * equipo —que nunca pasa por el flujo de registro— y a las cuentas anteriores a
 * este control. Cuando POLICY_VERSION suba, todos vuelven a pasar por aquí.
 */
export default async function TerminosPage() {
  const user = await requireUser();
  if (await hasAcceptedCurrentPolicy(user.id)) redirect("/dashboard");

  return (
    <div className="min-h-dvh bg-cloud px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex items-center gap-2 font-heading text-xl font-bold text-navy">
          <span className="grid size-9 place-items-center rounded-lg bg-navy text-white">
            <Activity className="size-4 text-mint" />
          </span>
          E-Irene
        </div>

        <div className="rounded-2xl border border-gray-line bg-card p-6 shadow-sm sm:p-8">
          <h1 className="font-heading text-2xl font-bold text-navy">
            Antes de continuar
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Necesitamos tu aceptación del aviso de privacidad para poder darte acceso. Queda
            registrada como prueba, con la fecha y la versión del documento.
          </p>

          <div className="mt-6 max-h-80 overflow-y-auto rounded-lg border border-gray-line bg-cloud p-4">
            <p className="mb-3 text-xs text-muted-foreground">Versión {POLICY_VERSION}</p>
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
              {POLICY_TEXT}
            </div>
          </div>

          <div className="mt-6">
            <AcceptPolicyForm />
          </div>
        </div>
      </div>
    </div>
  );
}

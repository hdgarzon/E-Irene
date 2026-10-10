import { redirect } from "next/navigation";
import { Activity } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { hasAcceptedCurrentPolicy } from "@/lib/db/policy-acceptances";
import { POLICY_VERSION } from "@/lib/legal";
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
            Para darte acceso necesitamos tu declaración de habilitación profesional y tu
            aceptación de los documentos que rigen el servicio. Si ya habías aceptado una versión
            anterior, te la pedimos de nuevo porque los documentos cambiaron. Queda registrada como
            prueba, con la fecha y la versión ({POLICY_VERSION}).
          </p>

          <div className="mt-6">
            <AcceptPolicyForm />
          </div>
        </div>
      </div>
    </div>
  );
}

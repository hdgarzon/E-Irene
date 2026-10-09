import Link from "next/link";
import type { Metadata } from "next";
import { connection } from "next/server";
import { ArrowLeft } from "lucide-react";
import { PqrForm } from "@/components/pqr-form";
import { PQR_RESPONSE_BUSINESS_DAYS } from "@/lib/pqr";
import { DATA_PROTECTION_EMAIL, POLICY_PATH, TERMS_OF_USE_PATH } from "@/lib/legal-documents/urls";

export const metadata: Metadata = {
  title: "Peticiones, quejas y reclamos — E-Irene",
  description: "Radica una petición, queja o reclamo sobre la compra o el uso de E-Irene.",
};

/**
 * Formulario de PQR que citan los Términos de Uso (cláusula duodécima, numeral 3).
 * Público: lo usa cualquier visitante, tenga o no cuenta.
 */
export default async function PqrPage() {
  // Render dinámico por la CSP con nonce (ver app/(marketing)/page.tsx).
  await connection();

  return (
    <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-navy"
      >
        <ArrowLeft className="size-4" />
        Volver al inicio
      </Link>

      <h1 className="mt-6 font-heading text-3xl font-bold text-navy">
        Peticiones, quejas y reclamos
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Para solicitudes sobre la compra o el uso del servicio. Cada solicitud recibe un número de
        radicado con la fecha y hora de presentación, y se responde dentro de los{" "}
        {PQR_RESPONSE_BUSINESS_DAYS} días hábiles siguientes (
        <Link href={TERMS_OF_USE_PATH} className="text-primary hover:underline">
          Términos y Condiciones
        </Link>
        , cláusula duodécima).
      </p>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Si tu solicitud es sobre tus datos personales (conocerlos, corregirlos o suprimirlos),
        escribe a {DATA_PROTECTION_EMAIL}: se tramita conforme a la{" "}
        <Link href={POLICY_PATH} className="text-primary hover:underline">
          Política de Tratamiento de Datos Personales
        </Link>
        .
      </p>

      <div className="mt-8 rounded-2xl border border-gray-line bg-card p-6">
        <PqrForm />
      </div>
    </main>
  );
}

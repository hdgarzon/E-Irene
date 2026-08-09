import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { POLICY_TEXT, POLICY_VERSION } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Aviso de privacidad — E-Irene",
  description:
    "Cómo trata E-Irene los datos personales de profesionales y pacientes, conforme a la Ley 1581 de 2012.",
};

/**
 * Aviso de privacidad público. Es el mismo texto que el profesional acepta en
 * /terminos: se lee de POLICY_TEXT para que no puedan divergir — si divergieran,
 * el hash guardado como prueba no correspondería a lo publicado.
 */
export default function PrivacidadPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-navy"
      >
        <ArrowLeft className="size-4" />
        Volver al inicio
      </Link>

      <h1 className="mt-6 font-heading text-3xl font-bold text-navy">Aviso de privacidad</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Versión {POLICY_VERSION} · Ley 1581 de 2012 y Decreto 1074 de 2015
      </p>

      <div className="mt-8 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
        {POLICY_TEXT}
      </div>

      <div className="mt-10 rounded-2xl border border-gray-line bg-cloud p-5 text-sm text-muted-foreground">
        <p>
          Si eres <strong>paciente</strong>, el responsable de tu información clínica es el
          profesional o la clínica que te atiende, no E-Irene. Para ejercer tus derechos sobre tu
          historia clínica, dirígete a ellos en primer lugar; cualquier solicitud que recibamos
          directamente la trasladaremos y te informaremos a quién corresponde resolverla.
        </p>
      </div>

      <div className="mt-6 text-sm">
        <Link href="/seguridad" className="text-primary hover:underline">
          Controles de seguridad y cumplimiento →
        </Link>
      </div>
    </main>
  );
}

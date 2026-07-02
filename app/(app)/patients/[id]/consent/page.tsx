import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { getPatient } from "@/lib/db/patients";
import { signConsentAction } from "./actions";
import { ConsentForm } from "@/components/consent-form";
import { CONSENT_TEXT, CONSENT_VERSION, isMinorByBirthDate } from "@/lib/consent";

export default async function ConsentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const patient = await getPatient(id);
  if (!patient) notFound();

  const action = signConsentAction.bind(null, id);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href={`/patients/${id}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-navy"
      >
        <ArrowLeft className="size-4" />
        Volver a la ficha
      </Link>

      <div>
        <h1 className="font-heading text-2xl font-bold text-navy">Consentimiento informado</h1>
        <p className="text-sm text-muted-foreground">
          Paciente: {patient.fullName} · Versión {CONSENT_VERSION}
        </p>
      </div>

      <div className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-2xl border border-gray-line bg-card p-5 text-sm leading-relaxed text-foreground/90">
        {CONSENT_TEXT}
      </div>

      <div className="rounded-2xl border border-gray-line bg-card p-6">
        <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="size-4 text-mint" />
          La firma se almacena con hash del documento, IP y fecha como prueba legal (Ley 527).
        </div>
        <ConsentForm
          action={action}
          defaultSignerName={patient.fullName}
          isMinorByBirthDate={isMinorByBirthDate(patient.birthDate)}
        />
      </div>
    </div>
  );
}

import { notFound } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { getPatientLinkByToken } from "@/lib/db/patient-links";
import { getPatientForLink } from "@/lib/db/patients";
import { CONSENT_TEXT, CONSENT_VERSION, isMinorByBirthDate } from "@/lib/consent";
import { questionsFor, RESPONSE_OPTIONS, ASSESSMENT_LABEL, type AssessmentType } from "@/lib/psychometrics";
import { ConsentForm } from "@/components/consent-form";
import { Button } from "@/components/ui/button";
import { submitPublicConsentAction, submitPublicAssessmentAction } from "./actions";

export default async function PatientLinkPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;
  const lookup = await getPatientLinkByToken(token);

  if (lookup.status !== "valid") {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="font-heading text-xl font-bold text-navy">
          {lookup.status === "completed" ? "Este enlace ya fue utilizado" : "Este enlace ya no es válido"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {lookup.status === "completed"
            ? "Ya se registró tu respuesta. Si necesitas hacer cambios, solicita un nuevo enlace a tu clínica."
            : "Este enlace expiró o no existe. Solicita uno nuevo a tu clínica."}
        </p>
      </div>
    );
  }

  const { link } = lookup;
  const patient = await getPatientForLink(link.patientId);
  if (!patient) notFound();

  if (link.purpose === "consent") {
    const action = submitPublicConsentAction.bind(null, token);
    return (
      <div className="mx-auto max-w-2xl space-y-6 px-6 py-10">
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

  const assessmentType = link.assessmentType as AssessmentType;
  const questions = questionsFor(assessmentType);
  const action = submitPublicAssessmentAction.bind(null, token);
  return (
    <div className="mx-auto max-w-2xl space-y-6 px-6 py-10">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy">{ASSESSMENT_LABEL[assessmentType]}</h1>
        <p className="text-sm text-muted-foreground">
          Hola {patient.fullName}. Durante las últimas 2 semanas, ¿con qué frecuencia le han
          molestado los siguientes problemas?
        </p>
      </div>
      {error && (
        <p className="rounded-lg border border-coral/30 bg-coral/5 px-4 py-3 text-sm text-destructive">
          No se pudo guardar tu respuesta. Intenta de nuevo en unos minutos.
        </p>
      )}
      <form action={action} className="space-y-6">
        {questions.map((q, i) => (
          <fieldset key={i} className="rounded-2xl border border-gray-line bg-card p-5">
            <legend className="mb-3 text-sm font-medium text-navy">
              {i + 1}. {q}
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {RESPONSE_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className="flex items-center gap-2 rounded-lg border border-gray-line px-3 py-2 text-sm has-[:checked]:border-purple has-[:checked]:bg-purple/5"
                >
                  <input type="radio" name={`q${i}`} value={opt.value} required className="accent-purple" />
                  {opt.label}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <Button type="submit" size="lg" className="w-full">
          Guardar respuestas
        </Button>
      </form>
    </div>
  );
}

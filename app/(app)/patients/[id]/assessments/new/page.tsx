import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ClipboardCheck } from "lucide-react";
import { getPatient } from "@/lib/db/patients";
import { questionsFor, RESPONSE_OPTIONS, ASSESSMENT_LABEL, type AssessmentType } from "@/lib/psychometrics";
import { createAssessmentAction } from "@/app/(app)/patients/[id]/assessments/actions";
import { Button } from "@/components/ui/button";

export default async function NewAssessmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  const { id } = await params;
  const { type } = await searchParams;
  if (type !== "phq9" && type !== "gad7") redirect(`/patients/${id}`);

  const patient = await getPatient(id);
  if (!patient) notFound();

  const assessmentType = type as AssessmentType;
  const questions = questionsFor(assessmentType);
  const action = createAssessmentAction.bind(null, id, assessmentType);

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
        <h1 className="flex items-center gap-2 font-heading text-2xl font-bold text-navy">
          <ClipboardCheck className="size-6 text-purple" />
          {ASSESSMENT_LABEL[assessmentType]}
        </h1>
        <p className="text-sm text-muted-foreground">
          Aplicar a {patient.fullName}. Durante las últimas 2 semanas, ¿con qué frecuencia le han
          molestado los siguientes problemas?
        </p>
      </div>

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
          Guardar resultado
        </Button>
      </form>
    </div>
  );
}

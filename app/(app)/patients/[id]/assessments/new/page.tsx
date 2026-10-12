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
        className="inline-flex items-center gap-1.5 rounded-md text-sm text-muted-foreground transition-colors hover:text-navy"
      >
        <ArrowLeft className="size-4" />
        Volver a la ficha
      </Link>

      <div>
        <h1 className="flex items-center gap-2 font-display text-[1.75rem] leading-tight font-semibold tracking-tight text-navy">
          <ClipboardCheck className="size-6 text-brand" />
          {ASSESSMENT_LABEL[assessmentType]}
        </h1>
        <p className="text-sm text-muted-foreground">
          Aplicar a {patient.fullName}. Durante las últimas 2 semanas, ¿con qué frecuencia le han
          molestado los siguientes problemas?
        </p>
      </div>

      <form action={action} className="space-y-4">
        {questions.map((q, i) => (
          <fieldset key={i} className="rounded-2xl border border-gray-line bg-card p-4 md:p-5">
            {/* float + w-full: sin esto el navegador monta la leyenda sobre el
                borde del fieldset y la pregunta queda cortada por la línea. */}
            <legend className="float-left mb-3 flex w-full gap-2 text-[0.9375rem] leading-snug font-medium text-navy">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-info-soft text-xs font-semibold text-brand">
                {i + 1}
              </span>
              <span className="pt-0.5">{q}</span>
            </legend>
            <div className="clear-both grid gap-2 sm:grid-cols-2">
              {RESPONSE_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border border-gray-line px-3 py-2 text-sm transition-colors hover:bg-cloud has-[:checked]:border-brand has-[:checked]:bg-info-soft has-[:checked]:font-medium has-[:checked]:text-navy has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
                >
                  <input type="radio" name={`q${i}`} value={opt.value} required className="size-4 accent-brand" />
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

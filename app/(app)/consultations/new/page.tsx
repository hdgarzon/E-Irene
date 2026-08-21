import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Mic, ShieldCheck, Sparkles, TriangleAlert } from "lucide-react";
import { getPatient } from "@/lib/db/patients";
import { getActiveConsent } from "@/lib/db/consents";
import { getClinicOverview } from "@/lib/db/clinic";
import { canStartConsultation, limitLabel, PLANS } from "@/lib/plans";
import { startConsultationAction } from "@/app/(app)/consultations/actions";
import { requireVerifiedProfessional } from "@/lib/auth";
import { isVideoSimulated } from "@/lib/channel-status";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export default async function NewConsultationPage({
  searchParams,
}: {
  searchParams: Promise<{ patientId?: string }>;
}) {
  // Abrir una consulta es un acto clínico: exige habilitación verificada.
  await requireVerifiedProfessional();

  const { patientId } = await searchParams;
  if (!patientId) redirect("/patients");
  const patient = await getPatient(patientId);
  if (!patient) notFound();
  const [consent, overview] = await Promise.all([getActiveConsent(patientId), getClinicOverview()]);
  const limitReached = !canStartConsultation(overview.plan, overview.consultationsThisMonth);

  const start = startConsultationAction.bind(null, patientId);

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Link
          href={`/patients/${patientId}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-navy"
        >
          <ArrowLeft className="size-4" />
          Volver a la ficha
        </Link>
        <Link
          href={`/patients/${patientId}/brief`}
          className="flex items-center gap-1 text-sm font-medium text-brand hover:underline"
        >
          <Sparkles className="size-3.5" />
          Ver brief pre-sesión
        </Link>
      </div>

      <div className="rounded-2xl border border-gray-line bg-card p-8 text-center">
        <div className="mx-auto mb-4 grid size-14 place-items-center rounded-full bg-cloud">
          <Mic className="size-7 text-brand" />
        </div>
        <h1 className="font-heading text-xl font-bold text-navy">
          Iniciar consulta con {patient.fullName}
        </h1>

        {!consent ? (
          <>
            <p className="mx-auto mt-2 flex items-center justify-center gap-1.5 max-w-sm text-sm text-muted-foreground">
              <ShieldCheck className="size-4 text-coral" />
              Este paciente aún no tiene consentimiento firmado.
            </p>
            <Link
              href={`/patients/${patientId}/consent`}
              className={cn(buttonVariants(), "mt-6")}
            >
              Capturar consentimiento
            </Link>
          </>
        ) : limitReached ? (
          <>
            <p className="mx-auto mt-2 flex items-center justify-center gap-1.5 max-w-sm text-sm text-muted-foreground">
              <TriangleAlert className="size-4 text-coral" />
              Alcanzaste el límite de {limitLabel(PLANS[overview.plan].consultationsPerMonth)}{" "}
              consultas de este mes en el plan {PLANS[overview.plan].label}.
            </p>
            <Link href="/settings/plan" className={cn(buttonVariants(), "mt-6")}>
              Mejorar plan
            </Link>
          </>
        ) : (
          <>
            <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
              Se transcribirá la sesión en tiempo real. El audio nunca se almacena; solo el texto,
              cifrado.
            </p>
            {isVideoSimulated() && (
              <p className="mx-auto mt-3 max-w-sm rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                La videollamada no está configurada en esta instalación: las citas por video no
                podrán conectarse. La consulta presencial y la transcripción funcionan con normalidad.
              </p>
            )}
            <form action={start} className="mt-6 space-y-4 text-left">
              <div className="space-y-1.5">
                <Label htmlFor="reason">Motivo de la consulta (opcional)</Label>
                <Textarea
                  id="reason"
                  name="reason"
                  rows={3}
                  placeholder="¿Por qué viene el paciente hoy?"
                />
              </div>
              <Button type="submit" size="lg" className="w-full">
                <Mic className="size-4" />
                Iniciar y grabar
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

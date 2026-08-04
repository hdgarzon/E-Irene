import { Phone } from "lucide-react";
import { getAssessmentByLinkToken } from "@/lib/db/assessments";
import { isPhq9SelfHarmRisk } from "@/lib/psychometrics";

interface ThanksPageProps {
  params: Promise<{ token: string }>;
}

export default async function PatientLinkThanksPage({ params }: ThanksPageProps) {
  const { token } = await params;
  const assessment = await getAssessmentByLinkToken(token);
  const showCrisis =
    assessment != null && isPhq9SelfHarmRisk(assessment.type, assessment.result.answers);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="font-heading text-xl font-bold text-navy">¡Gracias!</h1>
      <p className="text-sm text-muted-foreground">
        Tu información se registró correctamente. Ya puedes cerrar esta ventana.
      </p>

      {showCrisis && (
        <div className="w-full space-y-3 rounded-2xl border border-coral/40 bg-coral/5 p-5 text-left">
          <div className="flex items-center gap-2 text-destructive">
            <Phone className="size-5" />
            <h2 className="font-heading text-sm font-semibold">Líneas de apoyo disponibles</h2>
          </div>
          <p className="text-sm text-foreground/90">
            Si en este momento te sentís en riesgo o necesitás hablar con alguien, podés llamar a la
            Línea 106 de salud mental de Colombia. Es gratuita, confidencial y está disponible las
            24 horas.
          </p>
          <a
            href="tel:106"
            className="inline-flex items-center gap-2 rounded-xl bg-navy px-4 py-2.5 text-sm font-semibold text-white"
          >
            <Phone className="size-4" />
            Llamar al 106
          </a>
          <p className="text-xs text-muted-foreground">
            También podés contactar directamente a tu profesional o clínica. Si es una emergencia,
            acudí a la sala de urgencias más cercana.
          </p>
        </div>
      )}
    </div>
  );
}

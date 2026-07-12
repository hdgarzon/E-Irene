import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Calendar,
  Mail,
  Phone,
  IdCard,
  Mic,
  FileSignature,
  ShieldCheck,
  TrendingUp,
  Siren,
  ClipboardList,
  ClipboardCheck,
  FileDown,
} from "lucide-react";
import { getPatient } from "@/lib/db/patients";
import { getActiveConsent } from "@/lib/db/consents";
import { listConsultationsForPatient } from "@/lib/db/consultations";
import { listAssessmentsForPatient } from "@/lib/db/assessments";
import { getActivePlanForPatient } from "@/lib/db/treatment-plans";
import { ASSESSMENT_LABEL, ASSESSMENT_MAX_SCORE, type AssessmentType } from "@/lib/psychometrics";
import { TreatmentPlanSection } from "@/components/treatment-plan-section";
import { GeneratePatientLinkButton } from "@/components/generate-patient-link-button";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { generateConsentLinkAction, generateAssessmentLinkAction } from "./actions";

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Mail;
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 size-4 text-muted-foreground" />
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm text-navy">{value ?? "—"}</p>
      </div>
    </div>
  );
}

export default async function PatientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const patient = await getPatient(id);
  if (!patient) notFound();
  const [consent, consultations, assessments, treatmentPlan] = await Promise.all([
    getActiveConsent(id),
    listConsultationsForPatient(id),
    listAssessmentsForPatient(id),
    getActivePlanForPatient(id),
  ]);
  const latestByType = (["phq9", "gad7"] as AssessmentType[]).map((type) => ({
    type,
    latest: [...assessments].reverse().find((a) => a.type === type) ?? null,
  }));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href="/patients"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-navy"
      >
        <ArrowLeft className="size-4" />
        Volver a pacientes
      </Link>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-navy">{patient.fullName}</h1>
          <p className="text-sm text-muted-foreground">
            Registrado el {new Date(patient.createdAt).toLocaleDateString("es-CO")}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <a
            href={`/patients/${patient.id}/expediente`}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            <FileDown className="size-4" />
            Exportar expediente
          </a>
          <Link
            href={`/patients/${patient.id}/edit`}
            className="text-sm font-medium text-purple hover:underline"
          >
            Editar
          </Link>
        </div>
      </div>

      <div className="grid gap-4 rounded-2xl border border-gray-line bg-card p-6 sm:grid-cols-2">
        <InfoRow icon={IdCard} label="Documento" value={patient.document} />
        <InfoRow icon={Phone} label="Teléfono" value={patient.phone} />
        <InfoRow icon={Mail} label="Correo" value={patient.email} />
        <InfoRow
          icon={Calendar}
          label="Fecha de nacimiento"
          value={patient.birthDate ? new Date(patient.birthDate).toLocaleDateString("es-CO") : null}
        />
      </div>

      {patient.notes && (
        <div className="rounded-2xl border border-gray-line bg-card p-6">
          <h2 className="mb-2 font-heading font-semibold text-navy">Notas clínicas</h2>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{patient.notes}</p>
        </div>
      )}

      {patient.history && (
        <div className="rounded-2xl border border-gray-line bg-card p-6">
          <h2 className="mb-2 flex items-center gap-2 font-heading font-semibold text-navy">
            <ClipboardList className="size-4 text-purple" />
            Antecedentes básicos
          </h2>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{patient.history}</p>
        </div>
      )}

      {(patient.emergencyContactName || patient.emergencyContactPhone) && (
        <div className="rounded-2xl border border-gray-line bg-card p-6">
          <h2 className="mb-4 flex items-center gap-2 font-heading font-semibold text-navy">
            <Siren className="size-4 text-coral" />
            Contacto de emergencia
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <InfoRow icon={IdCard} label="Nombre" value={patient.emergencyContactName} />
            <InfoRow icon={Phone} label="Teléfono" value={patient.emergencyContactPhone} />
            <InfoRow
              icon={ShieldCheck}
              label="Parentesco / relación"
              value={patient.emergencyContactRelationship}
            />
          </div>
        </div>
      )}

      {/* Escalas psicométricas */}
      <div className="rounded-2xl border border-gray-line bg-card p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 font-heading font-semibold text-navy">
            <ClipboardCheck className="size-4 text-purple" />
            Escalas psicométricas
          </h2>
          {assessments.length > 0 && (
            <Link
              href={`/patients/${id}/progress`}
              className="flex items-center gap-1 text-sm font-medium text-purple hover:underline"
            >
              <TrendingUp className="size-3.5" />
              Ver evolución
            </Link>
          )}
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {latestByType.map(({ type, latest }) => (
            <div key={type} className="rounded-xl border border-gray-line p-4">
              <p className="text-sm font-medium text-navy">{ASSESSMENT_LABEL[type]}</p>
              {latest ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Último: {latest.result.totalScore}/{ASSESSMENT_MAX_SCORE[type]} ·{" "}
                  {latest.result.severity} · {new Date(latest.administeredAt).toLocaleDateString("es-CO")}
                </p>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">Aún no aplicada.</p>
              )}
              <Link
                href={`/patients/${id}/assessments/new?type=${type}`}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-3")}
              >
                Aplicar {ASSESSMENT_LABEL[type].split(" ")[0]}
              </Link>
              <div className="mt-2">
                <GeneratePatientLinkButton
                  action={generateAssessmentLinkAction.bind(null, id, type)}
                  label={`Generar link de ${ASSESSMENT_LABEL[type].split(" ")[0]}`}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <TreatmentPlanSection patientId={id} plan={treatmentPlan} />

      {/* Consentimiento informado */}
      <div className="rounded-2xl border border-gray-line bg-card p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 font-heading font-semibold text-navy">
            <FileSignature className="size-4 text-purple" />
            Consentimiento informado
          </h2>
          {consent ? (
            <Badge className="bg-mint/15 text-[#04342a]">Firmado</Badge>
          ) : (
            <Badge className="bg-coral/15 text-destructive">Pendiente</Badge>
          )}
        </div>
        {consent ? (
          <>
            <p className="mt-3 text-sm text-muted-foreground">
              Firmado por{" "}
              <span className="text-navy">
                {consent.signerName}
                {consent.isMinor && ` (representante legal — ${consent.representativeRelationship})`}
              </span>{" "}
              el {new Date(consent.signedAt).toLocaleDateString("es-CO")} · versión{" "}
              {consent.documentVersion}.
            </p>
            {consent.isMinor && (
              <p className="mt-1 text-xs text-muted-foreground">
                Documento del representante: {consent.representativeDocument}
              </p>
            )}
          </>
        ) : (
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Requerido antes de iniciar una consulta.
            </p>
            <div className="flex items-center gap-3">
              <GeneratePatientLinkButton
                action={generateConsentLinkAction.bind(null, id)}
                label="Generar link de consentimiento"
              />
              <Link
                href={`/patients/${id}/consent`}
                className={cn(buttonVariants({ size: "sm" }))}
              >
                Capturar consentimiento
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* Consultas */}
      <div className="rounded-2xl border border-gray-line bg-card p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 font-heading font-semibold text-navy">
            <Mic className="size-4 text-purple" />
            Consultas
          </h2>
          <div className="flex items-center gap-3">
            {consultations.length > 0 && (
              <Link
                href={`/patients/${id}/progress`}
                className="flex items-center gap-1 text-sm font-medium text-purple hover:underline"
              >
                <TrendingUp className="size-3.5" />
                Ver evolución
              </Link>
            )}
            {consent ? (
              <Link
                href={`/consultations/new?patientId=${id}`}
                className={cn(buttonVariants({ size: "sm" }))}
              >
                Iniciar consulta
              </Link>
            ) : (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ShieldCheck className="size-3.5" />
                Requiere consentimiento
              </span>
            )}
          </div>
        </div>

        {consultations.length > 0 && (
          <ul className="mt-4 divide-y divide-gray-line border-t border-gray-line">
            {consultations.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/consultations/${c.id}`}
                  className="flex items-center justify-between py-3 text-sm hover:text-purple"
                >
                  <span className="text-navy">
                    {new Date(c.startedAt).toLocaleString("es-CO", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </span>
                  <Badge
                    className={
                      c.status === "in_progress"
                        ? "bg-purple/15 text-purple"
                        : "bg-mint/15 text-[#04342a]"
                    }
                  >
                    {c.status === "in_progress"
                      ? "En curso"
                      : c.status === "analyzed"
                        ? "Analizada"
                        : "Finalizada"}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

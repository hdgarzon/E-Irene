import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Pencil,
  UserRound,
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
  Sparkles,
} from "lucide-react";
import { getPatient } from "@/lib/db/patients";
import { getActiveConsent, listConsentsForPatient } from "@/lib/db/consents";
import { RevokeConsentForm } from "@/components/revoke-consent-form";
import { listConsultationsForPatient } from "@/lib/db/consultations";
import { listAssessmentsForPatient } from "@/lib/db/assessments";
import { getActivePlanForPatient } from "@/lib/db/treatment-plans";
import { ASSESSMENT_LABEL, ASSESSMENT_MAX_SCORE, type AssessmentType } from "@/lib/psychometrics";
import { TreatmentPlanSection } from "@/components/treatment-plan-section";
import { GeneratePatientLinkButton } from "@/components/generate-patient-link-button";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
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
    <div className="flex min-w-0 items-start gap-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm break-words text-navy">{value ?? "—"}</p>
      </div>
    </div>
  );
}

export default async function PatientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const patient = await getPatient(id);
  if (!patient) notFound();
  const [consent, consentHistory, consultations, assessments, treatmentPlan] = await Promise.all([
    getActiveConsent(id),
    listConsentsForPatient(id),
    listConsultationsForPatient(id),
    listAssessmentsForPatient(id),
    getActivePlanForPatient(id),
  ]);
  // Si la firma más reciente está revocada, se muestra la revocación en vez de
  // un "pendiente" sin contexto.
  const revoked = !consent && consentHistory[0]?.revokedAt ? consentHistory[0] : null;
  const latestByType = (["phq9", "gad7"] as AssessmentType[]).map((type) => ({
    type,
    latest: [...assessments].reverse().find((a) => a.type === type) ?? null,
  }));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        back={{ href: "/patients", label: "Volver a pacientes" }}
        title={patient.fullName}
        description={<>Registrado el {new Date(patient.createdAt).toLocaleDateString("es-CO")}</>}
        actions={
          <>
            <a
              href={`/patients/${patient.id}/expediente`}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(buttonVariants({ variant: "outline" }))}
            >
              <FileDown className="size-4" />
              Exportar expediente
            </a>
            <Link
              href={`/patients/${patient.id}/edit`}
              className={cn(buttonVariants({ variant: "outline" }))}
            >
              <Pencil className="size-4" />
              Editar
            </Link>
          </>
        }
      />

      {/* Escritorio: lo clínico (consultas, escalas, plan) al centro y la
          información de referencia (datos, emergencia, consentimiento) al lado.
          En móvil la referencia va primero, como en una historia en papel. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <aside className="space-y-6 lg:col-start-2 lg:row-start-1">
          <div className="rounded-2xl border border-gray-line bg-card p-5 md:p-6">
            <h2 className="mb-4 flex items-center gap-2 font-semibold text-navy">
              <UserRound className="size-4 text-brand" />
              Datos del paciente
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
              <InfoRow icon={IdCard} label="Documento" value={patient.document} />
              <InfoRow icon={Phone} label="Teléfono" value={patient.phone} />
              <InfoRow icon={Mail} label="Correo" value={patient.email} />
              <InfoRow
                icon={Calendar}
                label="Fecha de nacimiento"
                value={
                  patient.birthDate ? new Date(patient.birthDate).toLocaleDateString("es-CO") : null
                }
              />
            </div>
          </div>

          {(patient.emergencyContactName || patient.emergencyContactPhone) && (
            <div className="rounded-2xl border border-gray-line bg-card p-5 md:p-6">
              <h2 className="mb-4 flex items-center gap-2 font-semibold text-navy">
                <Siren className="size-4 text-destructive" />
                Contacto de emergencia
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
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

          {/* Consentimiento informado */}
          <div className="rounded-2xl border border-gray-line bg-card p-5 md:p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 font-semibold text-navy">
                <FileSignature className="size-4 text-brand" />
                Consentimiento informado
              </h2>
              {consent ? (
                <StatusBadge tone="success" dot>
                  Firmado
                </StatusBadge>
              ) : revoked ? (
                <StatusBadge tone="danger" dot>
                  Revocado
                </StatusBadge>
              ) : (
                <StatusBadge tone="warning" dot>
                  Pendiente
                </StatusBadge>
              )}
            </div>
            {consent ? (
              <>
                <p className="mt-3 text-sm text-muted-foreground">
                  Firmado por{" "}
                  <span className="text-navy">
                    {consent.signerName}
                    {consent.isMinor &&
                      ` (representante legal — ${consent.representativeRelationship})`}
                  </span>{" "}
                  el {new Date(consent.signedAt).toLocaleDateString("es-CO")} · versión{" "}
                  {consent.documentVersion}.
                </p>
                {consent.isMinor && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Documento del representante: {consent.representativeDocument}
                    {consent.minorAssent !== null &&
                      ` · Asentimiento del menor: ${consent.minorAssent ? "sí" : "no"}`}
                  </p>
                )}
                <div className="mt-2">
                  <RevokeConsentForm patientId={id} />
                </div>
              </>
            ) : (
              <div className="mt-3 space-y-3">
                <p className="text-sm text-muted-foreground">
                  {revoked
                    ? `El paciente revocó su consentimiento el ${new Date(revoked.revokedAt!).toLocaleDateString("es-CO")}${revoked.revocationNote ? ` (${revoked.revocationNote})` : ""}. Para volver a atenderlo por la plataforma debe firmar de nuevo.`
                    : "Requerido antes de iniciar una consulta."}
                </p>
                <div className="flex flex-wrap items-start gap-2">
                  <GeneratePatientLinkButton
                    action={generateConsentLinkAction.bind(null, id)}
                    label="Generar link de consentimiento"
                  />
                  <Link href={`/patients/${id}/consent`} className={cn(buttonVariants())}>
                    Capturar consentimiento
                  </Link>
                </div>
              </div>
            )}
          </div>
        </aside>

        <div className="min-w-0 space-y-6 lg:col-start-1 lg:row-start-1">
          {/* Consultas */}
          <div className="rounded-2xl border border-gray-line bg-card p-5 md:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 font-semibold text-navy">
                <Mic className="size-4 text-brand" />
                Consultas
              </h2>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                {consultations.length > 0 && (
                  <Link
                    href={`/patients/${id}/progress`}
                    className="flex items-center gap-1 rounded-md text-sm font-medium text-brand hover:underline"
                  >
                    <TrendingUp className="size-3.5" />
                    Ver evolución
                  </Link>
                )}
                {consultations.length > 0 && (
                  <Link
                    href={`/patients/${id}/brief`}
                    className="flex items-center gap-1 rounded-md text-sm font-medium text-brand hover:underline"
                  >
                    <Sparkles className="size-3.5" />
                    Brief pre-sesión
                  </Link>
                )}
                {consent ? (
                  <Link
                    href={`/consultations/new?patientId=${id}`}
                    className={cn(buttonVariants())}
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
                      className="flex items-center justify-between gap-3 rounded-md py-3 text-sm hover:text-brand"
                    >
                      <span className="text-navy">
                        {new Date(c.startedAt).toLocaleString("es-CO", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </span>
                      <StatusBadge tone={c.status === "in_progress" ? "info" : "success"}>
                        {c.status === "in_progress"
                          ? "En curso"
                          : c.status === "analyzed"
                            ? "Analizada"
                            : "Finalizada"}
                      </StatusBadge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {/* Escalas psicométricas */}
          <div className="rounded-2xl border border-gray-line bg-card p-5 md:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 font-semibold text-navy">
                <ClipboardCheck className="size-4 text-brand" />
                Escalas psicométricas
              </h2>
              {assessments.length > 0 && (
                <Link
                  href={`/patients/${id}/progress`}
                  className="flex items-center gap-1 rounded-md text-sm font-medium text-brand hover:underline"
                >
                  <TrendingUp className="size-3.5" />
                  Ver evolución
                </Link>
              )}
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {latestByType.map(({ type, latest }) => (
                <div key={type} className="rounded-xl border border-gray-line bg-cloud/40 p-4">
                  <p className="text-sm font-medium text-navy">{ASSESSMENT_LABEL[type]}</p>
                  {latest ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Último: {latest.result.totalScore}/{ASSESSMENT_MAX_SCORE[type]} ·{" "}
                      {latest.result.severity} ·{" "}
                      {new Date(latest.administeredAt).toLocaleDateString("es-CO")}
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-muted-foreground">Aún no aplicada.</p>
                  )}
                  <div className="mt-3 flex flex-wrap items-start gap-2">
                    <Link
                      href={`/patients/${id}/assessments/new?type=${type}`}
                      className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                    >
                      Aplicar {ASSESSMENT_LABEL[type].split(" ")[0]}
                    </Link>
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

          {patient.notes && (
            <div className="rounded-2xl border border-gray-line bg-card p-5 md:p-6">
              <h2 className="mb-2 font-semibold text-navy">Notas clínicas</h2>
              <p className="text-sm whitespace-pre-wrap text-foreground/85">{patient.notes}</p>
            </div>
          )}

          {patient.history && (
            <div className="rounded-2xl border border-gray-line bg-card p-5 md:p-6">
              <h2 className="mb-2 flex items-center gap-2 font-semibold text-navy">
                <ClipboardList className="size-4 text-brand" />
                Antecedentes básicos
              </h2>
              <p className="text-sm whitespace-pre-wrap text-foreground/85">{patient.history}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

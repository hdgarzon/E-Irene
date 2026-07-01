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
} from "lucide-react";
import { getPatient } from "@/lib/db/patients";
import { getActiveConsent } from "@/lib/db/consents";
import { listConsultationsForPatient } from "@/lib/db/consultations";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
  const [consent, consultations] = await Promise.all([
    getActiveConsent(id),
    listConsultationsForPatient(id),
  ]);

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
        <Link
          href={`/patients/${patient.id}/edit`}
          className="text-sm font-medium text-purple hover:underline"
        >
          Editar
        </Link>
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
          <p className="mt-3 text-sm text-muted-foreground">
            Firmado por <span className="text-navy">{consent.signerName}</span> el{" "}
            {new Date(consent.signedAt).toLocaleDateString("es-CO")} · versión{" "}
            {consent.documentVersion}.
          </p>
        ) : (
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Requerido antes de iniciar una consulta.
            </p>
            <Link
              href={`/patients/${id}/consent`}
              className={cn(buttonVariants({ size: "sm" }))}
            >
              Capturar consentimiento
            </Link>
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

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Calendar, Mail, Phone, IdCard, Mic } from "lucide-react";
import { getPatient } from "@/lib/db/patients";
import { Badge } from "@/components/ui/badge";

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

      {/* Placeholder de consultas — se implementa en el Plan 2 */}
      <div className="rounded-2xl border border-dashed border-gray-line bg-card p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-heading font-semibold text-navy">Consultas</h2>
          <Badge variant="secondary">Pronto</Badge>
        </div>
        <div className="mt-4 flex items-center gap-3 text-sm text-muted-foreground">
          <Mic className="size-4 text-purple" />
          La transcripción en vivo y el análisis con IA llegan en la siguiente etapa.
        </div>
      </div>
    </div>
  );
}

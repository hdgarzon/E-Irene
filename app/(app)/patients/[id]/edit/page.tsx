import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getPatient } from "@/lib/db/patients";
import { updatePatientAction } from "@/app/(app)/patients/actions";
import { PatientForm } from "@/components/patient-form";

export default async function EditPatientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const patient = await getPatient(id);
  if (!patient) notFound();

  const action = updatePatientAction.bind(null, id);

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
        <h1 className="font-heading text-2xl font-bold text-navy">Editar paciente</h1>
        <p className="text-sm text-muted-foreground">{patient.fullName}</p>
      </div>

      <div className="rounded-2xl border border-gray-line bg-card p-6">
        <PatientForm action={action} defaultValues={patient} submitLabel="Guardar cambios" />
      </div>
    </div>
  );
}

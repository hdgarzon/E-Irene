import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getAdminPatient } from "@/lib/db/platform-console";
import { AdminPatientForm } from "@/components/admin-patient-form";

export default async function AdminPatientEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const patient = await getAdminPatient(id);
  if (!patient) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href="/admin/pacientes"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-navy"
      >
        <ArrowLeft className="size-4" />
        Volver a pacientes
      </Link>

      <div>
        <h1 className="font-heading text-2xl font-bold text-navy">Editar paciente</h1>
        <p className="text-sm text-muted-foreground">
          {patient.fullName} · {patient.clinicName}
        </p>
      </div>

      <div className="rounded-2xl border border-gray-line bg-card p-6">
        <AdminPatientForm patient={patient} />
      </div>
    </div>
  );
}

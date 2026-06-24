import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createPatientAction } from "@/app/(app)/patients/actions";
import { PatientForm } from "@/components/patient-form";

export default function NewPatientPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href="/patients"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-navy"
      >
        <ArrowLeft className="size-4" />
        Volver a pacientes
      </Link>

      <div>
        <h1 className="font-heading text-2xl font-bold text-navy">Nuevo paciente</h1>
        <p className="text-sm text-muted-foreground">
          Los datos se almacenan cifrados conforme a la Ley 1581 (Habeas Data).
        </p>
      </div>

      <div className="rounded-2xl border border-gray-line bg-card p-6">
        <PatientForm action={createPatientAction} submitLabel="Crear paciente" />
      </div>
    </div>
  );
}

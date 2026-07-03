"use client";

import Link from "next/link";
import { useTransition } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { deletePatientAdminAction } from "@/app/admin/actions";
import type { AdminPatient } from "@/lib/db/platform-console";
import { buttonVariants } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function AdminPatientRow({ patient }: { patient: AdminPatient }) {
  const [pending, startTransition] = useTransition();

  function onDelete() {
    if (
      !confirm(
        `¿Eliminar a ${patient.fullName}? Se borrará TODO su historial (consultas, reportes, citas). Esta acción es irreversible.`,
      )
    )
      return;
    startTransition(() => deletePatientAdminAction(patient.id));
  }

  return (
    <tr className="border-b border-gray-line last:border-0">
      <td className="py-3 pr-3">
        <p className="font-medium text-navy">{patient.fullName}</p>
        <p className="text-xs text-muted-foreground">{patient.document ?? "—"}</p>
      </td>
      <td className="px-3 py-3 text-sm text-muted-foreground">{patient.phone ?? "—"}</td>
      <td className="px-3 py-3 text-sm text-muted-foreground">{patient.clinicName}</td>
      <td className="py-3 pl-3">
        <div className="flex items-center justify-end gap-2">
          <Link
            href={`/admin/pacientes/${patient.id}`}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            <Pencil className="size-3.5" /> Editar
          </Link>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={pending}
            onClick={onDelete}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

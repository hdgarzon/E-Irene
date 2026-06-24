import Link from "next/link";
import { Plus, Users } from "lucide-react";
import { listPatients } from "@/lib/db/patients";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default async function PatientsPage() {
  const patients = await listPatients();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-navy">Pacientes</h1>
          <p className="text-sm text-muted-foreground">
            {patients.length} {patients.length === 1 ? "paciente" : "pacientes"} en tu clínica
          </p>
        </div>
        <Link href="/patients/new" className={cn(buttonVariants())}>
          <Plus className="size-4" />
          Nuevo paciente
        </Link>
      </div>

      {patients.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-line bg-card p-12 text-center">
          <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-cloud">
            <Users className="size-6 text-purple" />
          </div>
          <h3 className="font-heading font-semibold text-navy">Aún no hay pacientes</h3>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Registra a tu primer paciente para empezar a agendar citas y consultas.
          </p>
          <Link href="/patients/new" className={cn(buttonVariants(), "mt-5")}>
            <Plus className="size-4" />
            Registrar paciente
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-line bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Documento</TableHead>
                <TableHead>Teléfono</TableHead>
                <TableHead className="text-right">Registrado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {patients.map((p) => (
                <TableRow key={p.id} className="cursor-default">
                  <TableCell>
                    <Link
                      href={`/patients/${p.id}`}
                      className="font-medium text-navy hover:text-purple hover:underline"
                    >
                      {p.fullName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{p.document ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{p.phone ?? "—"}</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {new Date(p.createdAt).toLocaleDateString("es-CO")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

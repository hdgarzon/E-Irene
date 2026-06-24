import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { listMembers } from "@/lib/db/team";
import { MemberForm } from "@/components/member-form";
import { Badge } from "@/components/ui/badge";

const ROLE_LABEL: Record<string, string> = {
  admin: "Administrador",
  doctor: "Profesional",
  secretaria: "Secretaría",
  paciente: "Paciente",
};

export default async function TeamPage() {
  await requireRole(["admin"]);
  const members = await listMembers();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href="/settings"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-navy"
      >
        <ArrowLeft className="size-4" />
        Configuración
      </Link>

      <div>
        <h1 className="font-heading text-2xl font-bold text-navy">Equipo</h1>
        <p className="text-sm text-muted-foreground">Gestiona los miembros de tu clínica.</p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-line bg-card">
        <ul className="divide-y divide-gray-line">
          {members.map((m) => (
            <li key={m.id} className="flex items-center justify-between p-4">
              <div>
                <p className="font-medium text-navy">{m.fullName}</p>
                <p className="text-sm text-muted-foreground">{m.email}</p>
              </div>
              <Badge variant="secondary">{ROLE_LABEL[m.role] ?? m.role}</Badge>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-2xl border border-gray-line bg-card p-6">
        <h2 className="mb-4 font-heading font-semibold text-navy">Agregar miembro</h2>
        <MemberForm />
      </div>
    </div>
  );
}

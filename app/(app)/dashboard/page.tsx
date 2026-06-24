import Link from "next/link";
import { CalendarDays, Plus, ShieldCheck, Users } from "lucide-react";
import { getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

async function counts() {
  const supabase = await createClient();
  const [patients, appointments] = await Promise.all([
    supabase.from("patients").select("*", { count: "exact", head: true }),
    supabase.from("appointments").select("*", { count: "exact", head: true }),
  ]);
  return {
    patients: patients.count ?? 0,
    appointments: appointments.count ?? 0,
  };
}

export default async function DashboardPage() {
  const user = await getSessionUser();
  const { patients, appointments } = await counts();
  const firstName = user?.fullName.split(" ")[0] ?? "";

  const stats = [
    { label: "Pacientes", value: patients, icon: Users, href: "/patients" },
    { label: "Citas agendadas", value: appointments, icon: CalendarDays, href: "/appointments" },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy">Hola, {firstName} 👋</h1>
        <p className="text-sm text-muted-foreground">
          {user?.clinicName} · Este es el resumen de tu clínica.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {stats.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="rounded-2xl border border-gray-line bg-card p-6 transition-shadow hover:shadow-md"
          >
            <div className="flex items-center justify-between">
              <span className="grid size-11 place-items-center rounded-xl bg-cloud">
                <s.icon className="size-5 text-purple" />
              </span>
              <span className="font-heading text-3xl font-bold text-navy">{s.value}</span>
            </div>
            <p className="mt-3 text-sm font-medium text-muted-foreground">{s.label}</p>
          </Link>
        ))}
      </div>

      <div className="rounded-2xl border border-gray-line bg-card p-6">
        <h2 className="font-heading font-semibold text-navy">Acciones rápidas</h2>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/patients/new" className={cn(buttonVariants())}>
            <Plus className="size-4" />
            Nuevo paciente
          </Link>
          <Link href="/patients" className={cn(buttonVariants({ variant: "outline" }))}>
            <Users className="size-4" />
            Ver pacientes
          </Link>
        </div>
      </div>

      <div className="flex items-start gap-4 rounded-2xl border border-mint/30 bg-soft-mint/20 p-5">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-mint" />
        <div className="text-sm">
          <p className="font-medium text-navy">Tus datos están protegidos</p>
          <p className="text-muted-foreground">
            La información de pacientes se almacena cifrada (AES-256) y aislada por clínica.
            El audio de las sesiones nunca se guarda en el servidor.
          </p>
        </div>
      </div>
    </div>
  );
}

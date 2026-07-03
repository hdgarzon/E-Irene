import { Building2, Users, Mic, FileText, CalendarDays, BrainCircuit, Radio, Send } from "lucide-react";
import {
  getPlatformClinicOverview,
  getPlatformAppointmentStatus,
} from "@/lib/db/platform-admin";

const APPOINTMENT_STATUS_LABEL: Record<string, string> = {
  scheduled: "Agendadas",
  confirmed: "Confirmadas",
  completed: "Completadas",
  cancelled: "Canceladas",
  no_show: "No asistió",
};

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
  delay,
}: {
  icon: typeof Users;
  label: string;
  value: number;
  accent: string;
  delay: number;
}) {
  return (
    <div
      className="animate-in fade-in slide-in-from-bottom-3 rounded-2xl border border-gray-line bg-card p-5 shadow-sm transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-md fill-mode-both"
      style={{ animationDelay: `${delay}ms`, animationDuration: "500ms" }}
    >
      <div className={`mb-3 grid size-9 place-items-center rounded-xl ${accent}`}>
        <Icon className="size-4" />
      </div>
      <p className="font-heading text-3xl font-bold text-navy tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

export default async function AdminResumenPage() {
  const [clinics, appointmentStatus] = await Promise.all([
    getPlatformClinicOverview(),
    getPlatformAppointmentStatus(),
  ]);

  const total = (key: keyof (typeof clinics)[number]) =>
    clinics.reduce((s, c) => s + (c[key] as number), 0);

  const totals = {
    clinics: clinics.length,
    patients: total("patientCount"),
    reports: total("reportCount"),
    consultations: total("consultationCount"),
    appointments: total("appointmentCount"),
    notifications: total("notificationsSent"),
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy">Resumen de la plataforma</h1>
        <p className="text-sm text-muted-foreground">
          Información de negocio agregada — sin acceso a contenido clínico de pacientes.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard icon={Building2} label="Clínicas" value={totals.clinics} accent="bg-purple/15 text-purple" delay={0} />
        <StatCard icon={Users} label="Pacientes" value={totals.patients} accent="bg-mint/20 text-[#04342a]" delay={60} />
        <StatCard icon={FileText} label="Reportes" value={totals.reports} accent="bg-navy/10 text-navy" delay={120} />
        <StatCard icon={Mic} label="Consultas" value={totals.consultations} accent="bg-coral/15 text-destructive" delay={180} />
        <StatCard icon={CalendarDays} label="Citas" value={totals.appointments} accent="bg-purple/15 text-purple" delay={240} />
      </div>

      <section className="space-y-3">
        <h2 className="font-heading font-semibold text-navy">Uso de plataforma</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard icon={BrainCircuit} label="Análisis de IA (OpenAI)" value={totals.reports} accent="bg-purple/15 text-purple" delay={0} />
          <StatCard icon={Radio} label="Transcripciones (Deepgram)" value={totals.consultations} accent="bg-coral/15 text-destructive" delay={60} />
          <StatCard icon={Send} label="Notificaciones enviadas" value={totals.notifications} accent="bg-mint/20 text-[#04342a]" delay={120} />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-heading font-semibold text-navy">Citas por estado</h2>
        {appointmentStatus.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aún no hay citas registradas.</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {appointmentStatus.map((s) => (
              <div key={s.status} className="rounded-xl border border-gray-line bg-card px-4 py-2 text-sm">
                <span className="text-muted-foreground">
                  {APPOINTMENT_STATUS_LABEL[s.status] ?? s.status}:{" "}
                </span>
                <span className="font-semibold text-navy">{s.count}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

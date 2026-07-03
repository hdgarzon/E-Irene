import { Building2, Users, Mic, FileText, CalendarDays, BrainCircuit, Radio, Send } from "lucide-react";
import {
  getPlatformClinicOverview,
  getPlatformAppointmentStatus,
} from "@/lib/db/platform-admin";
import { AdminClinicRow } from "@/components/admin-clinic-row";

const APPOINTMENT_STATUS_LABEL: Record<string, string> = {
  scheduled: "Agendadas",
  confirmed: "Confirmadas",
  completed: "Completadas",
  cancelled: "Canceladas",
  no_show: "No asistió",
};

function KpiCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Users;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-2xl border border-gray-line bg-card p-5">
      <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </div>
      <p className="font-heading text-2xl font-bold text-navy">{value}</p>
    </div>
  );
}

export default async function AdminDashboardPage() {
  const [clinics, appointmentStatus] = await Promise.all([
    getPlatformClinicOverview(),
    getPlatformAppointmentStatus(),
  ]);

  const totalPatients = clinics.reduce((s, c) => s + c.patientCount, 0);
  const totalConsultations = clinics.reduce((s, c) => s + c.consultationCount, 0);
  const totalReports = clinics.reduce((s, c) => s + c.reportCount, 0);
  const totalAppointments = clinics.reduce((s, c) => s + c.appointmentCount, 0);
  const totalNotifications = clinics.reduce((s, c) => s + c.notificationsSent, 0);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy">Panel de plataforma</h1>
        <p className="text-sm text-muted-foreground">
          Vista de negocio — conteos agregados, sin acceso a datos clínicos de pacientes.
        </p>
      </div>

      {/* KPIs globales */}
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <KpiCard icon={Building2} label="Clínicas" value={clinics.length} />
        <KpiCard icon={Users} label="Pacientes" value={totalPatients} />
        <KpiCard icon={FileText} label="Reportes" value={totalReports} />
        <KpiCard icon={Mic} label="Consultas" value={totalConsultations} />
        <KpiCard icon={CalendarDays} label="Citas" value={totalAppointments} />
      </div>

      {/* Uso de plataforma / APIs */}
      <section className="space-y-3">
        <h2 className="font-heading font-semibold text-navy">Uso de plataforma</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-gray-line bg-card p-5">
            <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <BrainCircuit className="size-3.5" /> Análisis de IA (OpenAI)
            </div>
            <p className="font-heading text-2xl font-bold text-navy">{totalReports}</p>
          </div>
          <div className="rounded-2xl border border-gray-line bg-card p-5">
            <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Radio className="size-3.5" /> Transcripciones (Deepgram)
            </div>
            <p className="font-heading text-2xl font-bold text-navy">{totalConsultations}</p>
          </div>
          <div className="rounded-2xl border border-gray-line bg-card p-5">
            <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Send className="size-3.5" /> Notificaciones enviadas
            </div>
            <p className="font-heading text-2xl font-bold text-navy">{totalNotifications}</p>
          </div>
        </div>
      </section>

      {/* Citas por estado */}
      <section className="space-y-3">
        <h2 className="font-heading font-semibold text-navy">Citas por estado</h2>
        {appointmentStatus.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aún no hay citas registradas.</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {appointmentStatus.map((s) => (
              <div
                key={s.status}
                className="rounded-xl border border-gray-line bg-card px-4 py-2 text-sm"
              >
                <span className="text-muted-foreground">
                  {APPOINTMENT_STATUS_LABEL[s.status] ?? s.status}:{" "}
                </span>
                <span className="font-semibold text-navy">{s.count}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Clínicas + gestión */}
      <section className="space-y-3">
        <h2 className="font-heading font-semibold text-navy">
          Clínicas ({clinics.length})
        </h2>
        <div className="rounded-2xl border border-gray-line bg-card p-6">
          {clinics.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aún no hay clínicas registradas.</p>
          ) : (
            <ul className="divide-y divide-gray-line">
              {clinics.map((c) => (
                <AdminClinicRow key={c.clinicId} clinic={c} />
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

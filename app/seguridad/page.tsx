import Link from "next/link";
import {
  Activity,
  Lock,
  Users,
  FileSignature,
  ScrollText,
  Trash2,
  LifeBuoy,
  ShieldAlert,
} from "lucide-react";

const sections = [
  {
    icon: Lock,
    title: "Cifrado de tus datos",
    body: "Toda la información sensible (datos de pacientes, transcripciones, notas clínicas) se cifra con AES-256-GCM antes de guardarse, y viaja siempre por conexiones cifradas (TLS). El audio de las sesiones nunca se almacena — solo el texto transcrito, cifrado.",
  },
  {
    icon: Users,
    title: "Aislamiento por clínica",
    body: "Cada clínica solo puede ver y modificar sus propios datos. Esto se aplica a nivel de base de datos (row-level security), no solo en la interfaz — ni siquiera un error de programación en la aplicación podría exponer datos de una clínica a otra.",
  },
  {
    icon: FileSignature,
    title: "Consentimiento informado digital",
    body: "El consentimiento del paciente se firma digitalmente y queda protegido con un hash del documento, la fecha, IP y dispositivo — evidencia con validez legal según la Ley 527 de 1999.",
  },
  {
    icon: ScrollText,
    title: "Cumplimiento legal colombiano",
    body: "La plataforma implementa controles técnicos alineados con la Ley 1581 de 2012 (Habeas Data, tratamiento de datos sensibles de salud), la Ley 2015 de 2020 y el Decreto 580 de 2024 (historia clínica electrónica) y la Resolución 1995 de 1999 (reserva y trazabilidad de la historia clínica).",
  },
  {
    icon: Trash2,
    title: "Retención y eliminación de datos",
    body: "Las transcripciones completas de las sesiones se eliminan automáticamente 30 días después de finalizada la consulta. El resumen clínico, las notas y el reporte firmado por el profesional permanecen como parte de la historia clínica.",
  },
  {
    icon: LifeBuoy,
    title: "¿Encontraste un problema de seguridad?",
    body: "Escríbenos a seguridad@e-irene.co con el detalle de lo que encontraste. Respondemos y priorizamos cualquier reporte de seguridad de buena fe.",
  },
];

export default function SecurityPage() {
  return (
    <main className="flex-1">
      <header className="sticky top-0 z-10 border-b border-gray-line bg-cloud/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2 font-heading text-lg font-bold text-navy">
            <span className="grid size-8 place-items-center rounded-lg bg-navy text-white">
              <Activity className="size-4 text-mint" />
            </span>
            E-Irene
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="font-heading text-3xl font-bold text-navy">Seguridad y cumplimiento</h1>
        <p className="mt-3 text-muted-foreground">
          Resumen en lenguaje claro de cómo protegemos los datos clínicos en E-Irene.
        </p>

        <div className="mt-5 flex items-start gap-3 rounded-2xl border border-coral/30 bg-coral/5 p-4">
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-destructive" />
          <p className="text-sm text-foreground/90">
            Este resumen <span className="font-semibold text-navy">no reemplaza un contrato ni
            una certificación formal</span> — describe los controles técnicos que la plataforma ya
            implementa hoy.
          </p>
        </div>

        <div className="mt-10 space-y-8">
          {sections.map((s) => (
            <div key={s.title} className="flex gap-4">
              <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-cloud">
                <s.icon className="size-5 text-purple" />
              </div>
              <div>
                <h2 className="font-heading font-semibold text-navy">{s.title}</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-gray-line bg-cloud">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-6 py-8 text-sm text-muted-foreground sm:flex-row">
          <span>© {new Date().getFullYear()} E-Irene. Plataforma clínica de salud mental.</span>
          <Link href="/" className="text-xs hover:text-navy">
            Volver al inicio
          </Link>
        </div>
      </footer>
    </main>
  );
}

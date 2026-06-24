import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Activity,
  Brain,
  FileText,
  Mic,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

const features = [
  {
    icon: Mic,
    title: "Transcripción en vivo",
    desc: "El audio se transcribe en tiempo real y nunca toca tu servidor. Solo guardas texto, cifrado.",
    color: "text-purple",
  },
  {
    icon: Brain,
    title: "Análisis con IA",
    desc: "Sentimiento, palabras clave, patrones lingüísticos y una sugerencia preliminar que el doctor valida.",
    color: "text-mint",
  },
  {
    icon: FileText,
    title: "Reportes clínicos",
    desc: "Reporte PDF de 8 secciones con firma del profesional, listo para la historia clínica.",
    color: "text-purple",
  },
  {
    icon: ShieldCheck,
    title: "Cumplimiento legal",
    desc: "Habeas Data (Ley 1581), consentimiento digital (Ley 527) e historia clínica electrónica.",
    color: "text-mint",
  },
];

export default function Home() {
  return (
    <main className="flex-1">
      {/* Nav */}
      <header className="sticky top-0 z-10 border-b border-gray-line bg-cloud/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2 font-heading text-lg font-bold text-navy">
            <span className="grid size-8 place-items-center rounded-lg bg-navy text-white">
              <Activity className="size-4 text-mint" />
            </span>
            E-Irene
          </Link>
          <nav className="flex items-center gap-3">
            <Link href="/login" className={cn(buttonVariants({ variant: "ghost" }))}>
              Iniciar sesión
            </Link>
            <Link href="/signup" className={cn(buttonVariants())}>
              Crear cuenta
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 py-20 text-center">
        <Badge variant="secondary" className="mb-5 gap-1.5 bg-soft-mint text-[#04342a]">
          <Sparkles className="size-3.5" />
          Salud mental + IA, con cumplimiento legal colombiano
        </Badge>
        <h1 className="mx-auto max-w-3xl font-heading text-4xl font-bold tracking-tight text-navy sm:text-5xl">
          La consulta psicológica,{" "}
          <span className="text-purple">documentada por sí sola</span>
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground">
          E-Irene transcribe tus sesiones en vivo, las analiza con IA y genera el
          reporte clínico — para que dediques tu tiempo al paciente, no al papeleo.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link href="/signup" className={cn(buttonVariants({ size: "lg" }))}>
            Empezar gratis
          </Link>
          <Link href="/login" className={cn(buttonVariants({ size: "lg", variant: "outline" }))}>
            Ya tengo cuenta
          </Link>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          El audio nunca se almacena · Datos cifrados · Plan gratuito sin tarjeta
        </p>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f) => (
            <div
              key={f.title}
              className="rounded-2xl border border-gray-line bg-card p-6 shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="mb-4 grid size-11 place-items-center rounded-xl bg-cloud">
                <f.icon className={`size-5 ${f.color}`} />
              </div>
              <h3 className="font-heading font-semibold text-navy">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-line bg-cloud">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-6 py-8 text-sm text-muted-foreground sm:flex-row">
          <span>© {new Date().getFullYear()} E-Irene. Plataforma clínica de salud mental.</span>
          <span className="text-xs">
            Las sugerencias de IA no constituyen diagnóstico médico.
          </span>
        </div>
      </footer>
    </main>
  );
}

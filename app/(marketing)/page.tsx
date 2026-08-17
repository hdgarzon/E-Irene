import type { Metadata } from "next";
import { connection } from "next/server";
import { LandingNavigation } from "@/components/landing-navigation";
import { LandingHero } from "@/components/landing-hero";
import { LandingCurriculum } from "@/components/landing-curriculum";
import { LandingCinematicVision } from "@/components/landing-cinematic-vision";
import { LandingAlumniArchives } from "@/components/landing-alumni-archives";
import { LandingFooter } from "@/components/landing-footer";

export const metadata: Metadata = {
  title: "E-Irene — Salud mental + IA",
  description:
    "E-Irene transcribe tus sesiones psicológicas en vivo, las analiza con IA y genera el reporte clínico. Cumplimiento legal colombiano: Habeas Data, consentimiento digital e historia clínica electrónica.",
};

export default async function LandingPage() {
  // La CSP (proxy.ts) firma cada <script> con un nonce nuevo por request.
  // Una página estática se prerenderiza una sola vez en build: su nonce queda
  // fijo, y CDN de Vercel la sirve cacheada (x-vercel-cache: HIT) mientras el
  // header CSP sigue generándose fresco en cada request — nonce del <script>
  // ≠ nonce del header, y el navegador bloquea todo el JS de la página.
  // connection() fuerza render dinámico (sin caché) para que ambos coincidan.
  await connection();

  return (
    <div style={{ background: "#f7fafc", minHeight: "100vh", overflowX: "hidden" }}>
      <LandingNavigation />
      <main>
        <LandingHero />
        <LandingCurriculum />
        <LandingCinematicVision />
        <LandingAlumniArchives />
        <LandingFooter />
      </main>
    </div>
  );
}

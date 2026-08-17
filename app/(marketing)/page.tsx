import type { Metadata } from "next";
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

export default function LandingPage() {
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

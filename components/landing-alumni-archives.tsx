"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { researchConfig } from "@/lib/landing-content";

export function LandingAlumniArchives() {
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const items = itemRefs.current.filter(Boolean) as HTMLDivElement[];
    items.forEach((item) => gsap.set(item, { opacity: 0, y: 30 }));

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const idx = items.indexOf(entry.target as HTMLDivElement);
            gsap.to(entry.target, { opacity: 1, y: 0, duration: 0.8, delay: (idx % 4) * 0.1, ease: "power2.out" });
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1 },
    );

    items.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, []);

  return (
    <section id="alumni" style={{ padding: "150px 5vw", background: "#f7fafc", position: "relative", zIndex: 2 }}>
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        <div
          className="mb-6"
          style={{
            fontFamily: "var(--font-landing-sans)",
            fontSize: 12,
            fontWeight: 300,
            letterSpacing: "3px",
            textTransform: "uppercase",
            color: "#46617d",
            opacity: 0.7,
          }}
        >
          {researchConfig.sectionLabel}
        </div>
        <div className="mb-16" style={{ width: "100%", height: 1, background: "rgba(18, 40, 63, 0.12)" }} />

        <div className="grid grid-cols-2 md:grid-cols-4" style={{ gap: 0 }}>
          {researchConfig.projects.map((project, i) => (
            <div
              key={`${project.title}-${i}`}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              className="group cursor-pointer"
              style={{
                borderBottom: "1px solid rgba(18, 40, 63, 0.1)",
                borderRight: (i + 1) % 4 !== 0 ? "1px solid rgba(18, 40, 63, 0.1)" : "none",
                padding: "24px 20px",
              }}
            >
              <div className="relative overflow-hidden mb-4" style={{ aspectRatio: "1/1", borderRadius: 4 }}>
                {/* eslint-disable-next-line @next/next/no-img-element -- hover grayscale/scale filter en JS, ver comentario del archivo hermano */}
                <img
                  src={project.image}
                  alt={project.title}
                  className="w-full h-full object-cover transition-all duration-700"
                  style={{ opacity: 0.55, filter: "grayscale(100%)" }}
                  onMouseEnter={(e) => {
                    const img = e.target as HTMLImageElement;
                    img.style.opacity = "1";
                    img.style.filter = "grayscale(0%)";
                    img.style.transform = "scale(1.04)";
                  }}
                  onMouseLeave={(e) => {
                    const img = e.target as HTMLImageElement;
                    img.style.opacity = "0.55";
                    img.style.filter = "grayscale(100%)";
                    img.style.transform = "scale(1)";
                  }}
                  loading="lazy"
                />
              </div>
              <h4
                style={{
                  fontFamily: "var(--font-landing-serif)",
                  fontWeight: 400,
                  fontSize: 18,
                  color: "#12283f",
                  margin: "0 0 6px 0",
                  lineHeight: 1.3,
                }}
              >
                {project.title}
              </h4>
              <div className="flex items-center justify-between">
                <span style={{ fontFamily: "var(--font-landing-sans)", fontWeight: 300, fontSize: 12, color: "#46617d", opacity: 0.75 }}>
                  {project.discipline}
                </span>
                <span style={{ fontFamily: "var(--font-landing-code)", fontWeight: 400, fontSize: 11, color: "#46617d", opacity: 0.55 }}>
                  {project.year}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

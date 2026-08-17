"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { architectureConfig } from "@/lib/landing-content";

export function LandingCinematicVision() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    const text = textRef.current;
    if (!section || !text) return;

    gsap.set(text, { opacity: 0, y: 40 });

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            gsap.to(text, { opacity: 1, y: 0, duration: 1.2, ease: "power3.out" });
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.3 },
    );

    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      id="cinematic"
      ref={sectionRef}
      style={{ padding: "150px 5vw 80px", background: "#f7fafc", position: "relative", zIndex: 2 }}
    >
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
          {architectureConfig.sectionLabel}
        </div>
        <div className="mb-16" style={{ width: "100%", height: 1, background: "rgba(18, 40, 63, 0.12)" }} />

        <div className="relative">
          <div
            className="relative overflow-hidden"
            style={{
              width: "100%",
              maxWidth: "80vw",
              margin: "0 auto",
              aspectRatio: "21/9",
              borderRadius: 6,
              boxShadow: "0 24px 60px rgba(18, 40, 63, 0.10)",
            }}
          >
            <video
              src={architectureConfig.videoPath}
              autoPlay
              muted
              loop
              playsInline
              className="w-full h-full object-cover"
              style={{ display: "block" }}
            />
          </div>

          <div ref={textRef} className="flex flex-col md:flex-row md:items-center" style={{ marginTop: 160, gap: "60px" }}>
            <h2
              style={{
                fontFamily: "var(--font-landing-serif)",
                fontWeight: 400,
                fontSize: "clamp(32px, 4vw, 64px)",
                lineHeight: 1.15,
                letterSpacing: "-1px",
                color: "#12283f",
                margin: 0,
                flex: "0 0 50%",
                textWrap: "balance",
              }}
            >
              {architectureConfig.title}
            </h2>
            <p
              style={{
                fontFamily: "var(--font-landing-sans)",
                fontWeight: 300,
                fontSize: 17,
                lineHeight: 1.85,
                color: "#46617d",
                margin: 0,
                flex: "1 1 50%",
                textWrap: "pretty",
              }}
            >
              {architectureConfig.description}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

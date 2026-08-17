"use client";

import { useRef, useEffect, useState } from "react";
import { LandingAmberCascades } from "@/components/landing-amber-cascades";
import { LandingLiquidGlassButton } from "@/components/landing-liquid-glass-button";
import { heroConfig } from "@/lib/landing-content";

export function LandingHero() {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [titleWidth, setTitleWidth] = useState<number>(0);

  useEffect(() => {
    const measure = () => {
      if (titleRef.current) setTitleWidth(titleRef.current.offsetWidth);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  return (
    <section id="hero" className="relative w-full overflow-hidden" style={{ height: "100vh" }}>
      <LandingAmberCascades />
      <div
        className="relative z-10 flex flex-col justify-between pointer-events-none"
        style={{ height: "100%", padding: "28vh 5vw 8vh" }}
      >
        <div>
          <h1
            ref={titleRef}
            style={{
              fontFamily: "var(--font-mono)",
              fontWeight: 400,
              fontSize: "clamp(48px, 6vw, 96px)",
              lineHeight: 1.0,
              letterSpacing: "-3px",
              color: "#12283f",
              textShadow: "0 2px 18px rgba(255,255,255,0.9)",
              marginBottom: "clamp(32px, 4vw, 56px)",
              width: "fit-content",
            }}
          >
            {heroConfig.title}
          </h1>
          <p
            style={{
              fontFamily: "var(--font-mono)",
              fontWeight: 200,
              fontSize: "clamp(15px, 1.5vw, 22px)",
              lineHeight: 1.7,
              letterSpacing: "-0.3px",
              color: "#33475b",
              margin: "0 0 12px 0",
              width: titleWidth || "auto",
              maxWidth: "100%",
              textShadow: "0 1px 10px rgba(255,255,255,0.85)",
            }}
          >
            {heroConfig.subtitleLine1}
          </p>
          <p
            style={{
              fontFamily: "var(--font-mono)",
              fontWeight: 200,
              fontSize: "clamp(15px, 1.5vw, 22px)",
              lineHeight: 1.7,
              letterSpacing: "-0.3px",
              color: "#33475b",
              margin: 0,
              width: titleWidth || "auto",
              maxWidth: "100%",
              textShadow: "0 1px 10px rgba(255,255,255,0.85)",
            }}
          >
            {heroConfig.subtitleLine2}
          </p>
        </div>

        <div style={{ display: "flex", justifyContent: "center" }} className="pointer-events-auto">
          <LandingLiquidGlassButton
            onClick={() => document.querySelector("#curriculum")?.scrollIntoView({ behavior: "smooth" })}
          >
            {heroConfig.ctaText}
          </LandingLiquidGlassButton>
        </div>
      </div>
    </section>
  );
}

"use client";

import Link from "next/link";
import { LandingAmberCascades } from "@/components/landing-amber-cascades";
import { siteConfig, capabilityDetailConfig, type CapabilityDetailData } from "@/lib/landing-content";

const SLUGS = Object.keys(capabilityDetailConfig.capabilities);

export function LandingCapabilityDetail({ slug, data }: { slug: string; data: CapabilityDetailData }) {
  const currentIndex = SLUGS.indexOf(slug);
  const prevSlug = currentIndex > 0 ? SLUGS[currentIndex - 1] : null;
  const nextSlug = currentIndex < SLUGS.length - 1 ? SLUGS[currentIndex + 1] : null;

  return (
    <div style={{ background: "#f7fafc", minHeight: "100vh", position: "relative", overflowX: "hidden" }}>
      <div style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100vh", zIndex: 0, opacity: 0.4 }}>
        <LandingAmberCascades />
      </div>

      <nav
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          height: 80,
          padding: "0 5vw",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          backgroundColor: "rgba(247, 250, 252, 0.92)",
          backdropFilter: "blur(8px)",
          borderBottom: "1px solid rgba(18, 40, 63, 0.08)",
        }}
      >
        <Link
          href="/"
          className="no-underline"
          style={{ fontFamily: "var(--font-mono)", fontSize: 18, fontWeight: 400, letterSpacing: "-0.5px", color: "#12283f" }}
        >
          {siteConfig.brandName}
        </Link>
        <Link href="/" className="landing-nav-link">
          {capabilityDetailConfig.backLinkText}
        </Link>
      </nav>

      <div style={{ position: "relative", zIndex: 2 }}>
        <section style={{ padding: "180px 5vw 100px", maxWidth: 860, margin: "0 auto" }}>
          <div
            style={{
              fontFamily: "var(--font-landing-sans)",
              fontSize: 12,
              fontWeight: 300,
              letterSpacing: "3px",
              textTransform: "uppercase",
              color: "#46617d",
              opacity: 0.6,
              marginBottom: 24,
            }}
          >
            {capabilityDetailConfig.sectionLabel}
          </div>
          <h1
            style={{
              fontFamily: "var(--font-landing-serif)",
              fontWeight: 400,
              fontSize: "clamp(40px, 5vw, 72px)",
              lineHeight: 1.1,
              letterSpacing: "-1.5px",
              color: "#12283f",
              margin: "0 0 24px 0",
            }}
          >
            {data.title}
          </h1>
          <p
            style={{
              fontFamily: "var(--font-landing-sans)",
              fontWeight: 300,
              fontSize: 18,
              lineHeight: 1.6,
              color: "#33506e",
              margin: 0,
              maxWidth: 540,
            }}
          >
            {data.subtitle}
          </p>
        </section>

        <div style={{ maxWidth: 860, margin: "0 auto", padding: "0 5vw" }}>
          <div style={{ width: "100%", height: 1, background: "rgba(18, 40, 63, 0.12)" }} />
        </div>

        <article style={{ padding: "80px 5vw", maxWidth: 860, margin: "0 auto" }}>
          {data.paragraphs.map((p, i) => (
            <p
              key={i}
              style={{
                fontFamily: "var(--font-landing-sans)",
                fontWeight: 300,
                fontSize: 16,
                lineHeight: 1.9,
                color: "#33506e",
                marginBottom: i < data.paragraphs.length - 1 ? 32 : 0,
              }}
            >
              {p}
            </p>
          ))}
        </article>

        <div style={{ maxWidth: 860, margin: "0 auto", padding: "0 5vw 120px" }}>
          <div style={{ width: "100%", height: 1, background: "rgba(18, 40, 63, 0.12)", marginBottom: 40 }} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            {prevSlug ? (
              <Link href={`/capability/${prevSlug}`} className="landing-nav-link" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 11, opacity: 0.5, letterSpacing: "2px", textTransform: "uppercase" }}>
                  {capabilityDetailConfig.prevLabel}
                </span>
                <span>{capabilityDetailConfig.capabilities[prevSlug].title}</span>
              </Link>
            ) : (
              <div />
            )}
            {nextSlug ? (
              <Link
                href={`/capability/${nextSlug}`}
                className="landing-nav-link"
                style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, textAlign: "right" }}
              >
                <span style={{ fontSize: 11, opacity: 0.5, letterSpacing: "2px", textTransform: "uppercase" }}>
                  {capabilityDetailConfig.nextLabel}
                </span>
                <span>{capabilityDetailConfig.capabilities[nextSlug].title}</span>
              </Link>
            ) : (
              <div />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

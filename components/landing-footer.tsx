"use client";

import Link from "next/link";
import { footerConfig } from "@/lib/landing-content";

function FooterLink({ label, href }: { label: string; href: string }) {
  const style = { width: "fit-content" as const };

  if (href.startsWith("#")) {
    return (
      <a
        href={href}
        className="landing-nav-link"
        style={style}
        onClick={(e) => {
          e.preventDefault();
          document.querySelector(href)?.scrollIntoView({ behavior: "smooth" });
        }}
      >
        {label}
      </a>
    );
  }

  if (href.startsWith("mailto:") || href.startsWith("http")) {
    return (
      <a href={href} className="landing-nav-link" style={style}>
        {label}
      </a>
    );
  }

  return (
    <Link href={href} className="landing-nav-link" style={style}>
      {label}
    </Link>
  );
}

export function LandingFooter() {
  return (
    <footer
      id="footer"
      style={{
        padding: "150px 5vw 60px",
        background: "#f7fafc",
        position: "relative",
        zIndex: 2,
        borderTop: "1px solid rgba(18, 40, 63, 0.12)",
      }}
    >
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        <h2
          style={{
            fontFamily: "var(--font-landing-serif)",
            fontWeight: 400,
            fontSize: "clamp(40px, 5vw, 80px)",
            lineHeight: 1.1,
            letterSpacing: "-1.44px",
            color: "#12283f",
            marginBottom: 80,
          }}
        >
          {footerConfig.heading}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: 60, marginBottom: 120 }}>
          {footerConfig.columns.map((column) => (
            <div key={column.title} className="flex flex-col" style={{ gap: 16 }}>
              <span
                style={{
                  fontFamily: "var(--font-landing-sans)",
                  fontSize: 12,
                  fontWeight: 300,
                  letterSpacing: "3px",
                  textTransform: "uppercase",
                  color: "#46617d",
                  opacity: 0.5,
                  marginBottom: 8,
                }}
              >
                {column.title}
              </span>
              {column.links.map((link) => (
                <FooterLink key={link.label} label={link.label} href={link.href} />
              ))}
            </div>
          ))}
        </div>

        <div
          className="flex flex-col md:flex-row items-start md:items-center justify-between"
          style={{ paddingTop: 24, borderTop: "1px solid rgba(18, 40, 63, 0.08)", gap: 16 }}
        >
          <span style={{ fontFamily: "var(--font-landing-sans)", fontWeight: 300, fontSize: 12, color: "#46617d", opacity: 0.6 }}>
            {footerConfig.copyright}
          </span>
          <div className="flex items-center" style={{ gap: 24 }}>
            {footerConfig.bottomLinks.map((bottomLink) => (
              <a
                key={bottomLink.label}
                href={bottomLink.href}
                style={{
                  fontFamily: "var(--font-landing-sans)",
                  fontWeight: 300,
                  fontSize: 12,
                  color: "#46617d",
                  opacity: 0.6,
                  textDecoration: "none",
                  transition: "opacity 0.3s",
                }}
                onMouseEnter={(e) => {
                  (e.target as HTMLElement).style.opacity = "1";
                }}
                onMouseLeave={(e) => {
                  (e.target as HTMLElement).style.opacity = "0.6";
                }}
              >
                {bottomLink.label}
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}

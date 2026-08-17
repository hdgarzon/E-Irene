"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { siteConfig, navigationConfig } from "@/lib/landing-content";

export function LandingNavigation() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 80);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    e.preventDefault();
    document.querySelector(href)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between transition-colors duration-500"
      style={{
        height: 80,
        padding: "0 5vw",
        backgroundColor: scrolled ? "rgba(247, 250, 252, 0.92)" : "transparent",
        backdropFilter: scrolled ? "blur(8px)" : "none",
        borderBottom: scrolled ? "1px solid rgba(18, 40, 63, 0.08)" : "none",
      }}
    >
      <a
        href="#hero"
        onClick={(e) => handleClick(e, "#hero")}
        className="no-underline"
        style={{ fontFamily: "var(--font-mono)", fontSize: 18, fontWeight: 400, letterSpacing: "-0.5px", color: "#12283f" }}
      >
        {siteConfig.brandName}
      </a>

      <div className="hidden md:flex items-center" style={{ gap: 40 }}>
        {navigationConfig.links.map((link) => (
          <a key={link.label} href={link.href} onClick={(e) => handleClick(e, link.href)} className="landing-nav-link">
            {link.label}
          </a>
        ))}
      </div>

      <div className="hidden md:flex items-center" style={{ gap: 24 }}>
        <Link href="/login" className="landing-nav-link">
          Iniciar sesión
        </Link>
        <Link href="/signup" className="landing-nav-link">
          Empezar gratis
        </Link>
      </div>
    </nav>
  );
}

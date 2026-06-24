import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Permite acceder al dev server vía 127.0.0.1 (usado por los E2E) sin warning.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;

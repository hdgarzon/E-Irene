import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "E-Irene · Plataforma clínica de salud mental",
    short_name: "E-Irene",
    description:
      "Transcripción en vivo, análisis con IA y reportes clínicos para profesionales de salud mental.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#f6f9fc",
    theme_color: "#0a2540",
    lang: "es",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

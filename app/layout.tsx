import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { SwRegister } from "@/components/sw-register";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "E-Irene · Plataforma clínica de salud mental",
  description:
    "Transcripción en vivo, análisis con IA y reportes clínicos para profesionales de salud mental.",
  appleWebApp: { capable: true, title: "E-Irene", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#0a2540",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster richColors position="top-right" />
        <SwRegister />
      </body>
    </html>
  );
}

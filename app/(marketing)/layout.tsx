import { EB_Garamond, Inter, Fira_Code } from "next/font/google";

// Tipografías propias de la landing pública (no se cargan en el resto de la
// app). GeistMono ya está cargada globalmente como --font-mono y se reutiliza
// aquí en vez de duplicarla.
const ebGaramond = EB_Garamond({
  variable: "--font-landing-serif",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const inter = Inter({
  variable: "--font-landing-sans",
  subsets: ["latin"],
  weight: ["200", "300", "400", "500"],
});

const firaCode = Fira_Code({
  variable: "--font-landing-code",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${ebGaramond.variable} ${inter.variable} ${firaCode.variable}`}>
      {children}
    </div>
  );
}

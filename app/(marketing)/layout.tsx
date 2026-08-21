import { Fira_Code } from "next/font/google";
import { landingFontVariables } from "@/lib/fonts";

// Tipografías propias de la landing pública (no se cargan en el resto de la
// app). GeistMono ya está cargada globalmente como --font-mono y se reutiliza
// aquí en vez de duplicarla.
const firaCode = Fira_Code({
  variable: "--font-landing-code",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${landingFontVariables} ${firaCode.variable}`}>
      {children}
    </div>
  );
}

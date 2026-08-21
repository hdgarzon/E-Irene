import { EB_Garamond, Inter } from "next/font/google";

/**
 * Tipografías del lenguaje visual de E-Irene, en un solo lugar.
 *
 * Las cargaban por separado la landing, las pantallas de auth, la app interna
 * y la consola de admin — cuatro copias de la misma declaración, cada una con
 * su propia lista de pesos. Bastaba con que alguien ajustara una para que las
 * superficies dejaran de coincidir sin que nadie lo notara.
 *
 * Cada route group necesita aplicar las variables en su propio contenedor
 * (no se heredan entre grupos), pero la definición es esta y solo esta.
 */
export const ebGaramond = EB_Garamond({
  variable: "--font-landing-serif",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const inter = Inter({
  variable: "--font-landing-sans",
  subsets: ["latin"],
  weight: ["200", "300", "400", "500"],
});

/** Clases de variables de fuente para el contenedor de un route group. */
export const landingFontVariables = `${ebGaramond.variable} ${inter.variable}`;

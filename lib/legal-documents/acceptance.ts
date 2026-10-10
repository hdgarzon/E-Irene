/**
 * Textos de las casillas del registro del profesional (Pieza 2). Viven aparte
 * —sin node:crypto— porque los muestra un componente de cliente; el hash que
 * los cubre se calcula en lib/legal.ts.
 */

/** Casilla obligatoria. Sin marcar por defecto: premarcada no es autorización. */
export const PROFESSIONAL_ACCEPTANCE_TEXT =
  "Declaro bajo la gravedad del juramento que soy profesional de la salud habilitado para ejercer en Colombia, que no me encuentro suspendido ni inhabilitado y que la información que aporto es auténtica. He leído y acepto el Consentimiento y Términos de Vinculación del Profesional, los Términos y Condiciones de Uso y la Política de Tratamiento de Datos Personales, y autorizo a E-IRENE S.A.S. a tratar mis datos personales para las finalidades allí descritas, incluida la verificación de mi habilitación profesional ante fuentes públicas oficiales, como el ReTHUS.";

/**
 * Casilla separada y opcional. Agruparla con la contractual viciaría el
 * consentimiento comercial (criterio de la SIC sobre autorizaciones específicas).
 */
export const MARKETING_OPT_IN_TEXT =
  "Quiero recibir comunicaciones sobre novedades y funcionalidades de la plataforma.";

/**
 * Direcciones que los documentos legales citan textualmente.
 *
 * Son absolutas a propósito: el texto también se lee en PDF, fuera del sitio,
 * y ahí una ruta relativa no lleva a ningún lado. Cambiar una de estas obliga a
 * subir la versión de los documentos que la citan (cambia su hash).
 */
export const SITE_URL = "https://e-irene.co";

export const POLICY_PATH = "/politica-de-datos";
export const PRIVACY_NOTICE_PATH = "/privacidad";
export const TERMS_OF_USE_PATH = "/terminos-y-condiciones";
export const PROFESSIONAL_TERMS_PATH = "/vinculacion-profesional";

export const POLICY_URL = `${SITE_URL}${POLICY_PATH}`;
export const PLANS_URL = `${SITE_URL}/#planes`;

/** Enlace a la SIC que exige el art. 50 de la Ley 1480 de 2011. */
export const SIC_URL = "https://sedeelectronica.sic.gov.co";

export const DATA_PROTECTION_EMAIL = "protecciondedatos@e-irene.co";
export const COMMERCIAL_EMAIL = "hola@e-irene.co";

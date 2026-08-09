import { createHash } from "node:crypto";

/**
 * Aviso de privacidad y aceptación del profesional.
 *
 * Mismo esquema probatorio que lib/consent.ts (el consentimiento del paciente):
 * versión + hash del texto + IP + user-agent + marca temporal. El hash es lo
 * que permite demostrar QUÉ texto se aceptó, no solo que se aceptó algo.
 *
 * Al cambiar POLICY_TEXT hay que subir POLICY_VERSION: la compuerta de
 * /terminos compara la versión vigente contra la última aceptada y vuelve a
 * pedir aceptación a todo el mundo. Es el mecanismo que exige la sección 10 de
 * la política para cambios sustanciales.
 *
 * Borrador completo en docs/legal/aviso-privacidad-borrador.md — este texto es
 * la versión corta que se muestra en el producto.
 */
export const POLICY_VERSION = "2026-08-v1";

export const POLICY_TEXT = `AVISO DE PRIVACIDAD Y TRATAMIENTO DE DATOS PERSONALES — E-IRENE

1. Responsable. E-Irene S.A.S., domiciliada en Medellín, Colombia, es responsable del tratamiento
de tus datos como profesional usuario de la plataforma. Para ejercer tus derechos puedes
escribirnos al correo de contacto publicado en la política de tratamiento.

2. Qué datos tratamos y para qué. Tratamos tus datos de identificación, contacto, habilitación
profesional, facturación y uso de la plataforma, con el fin de crear y administrar tu cuenta,
verificar que estás habilitado para ejercer, cobrar el servicio, darte soporte y cumplir
obligaciones legales.

3. Verificación de habilitación. Autorizas que verifiquemos la información que aportas contra
fuentes públicas oficiales, incluido el Registro Único Nacional del Talento Humano en Salud
(ReTHUS).

4. Datos de tus pacientes. Respecto de la información clínica que registras en la plataforma, el
Responsable del tratamiento eres tú o la institución que representas; E-Irene actúa como
Encargado y solo trata esos datos siguiendo tus instrucciones. E-Irene NO usa datos de pacientes
para finalidades propias ni para entrenar modelos de inteligencia artificial.

5. Audio de las sesiones. El audio no se graba ni se almacena en ningún momento: se transcribe en
vivo y solo se conserva el texto, cifrado. La transcripción se suprime automáticamente 30 días
después de que valides el reporte de la sesión y, en todo caso, a más tardar a los 90 días.

6. Encargados y transferencia internacional. Nos apoyamos en proveedores de infraestructura,
transcripción, análisis, videollamada, correo, mensajería y pagos, algunos ubicados fuera de
Colombia, lo que implica transferencia internacional de datos. El listado actualizado está en la
política de tratamiento.

7. Tus derechos. Puedes conocer, actualizar y rectificar tus datos; solicitar prueba de esta
autorización; ser informado sobre su uso; revocar la autorización y solicitar la supresión cuando
no exista un deber legal de conservación; acceder gratuitamente a ellos; y presentar quejas ante
la Superintendencia de Industria y Comercio.

8. Historia clínica. La información que integra la historia clínica debe conservarse 15 años desde
la última atención (Resolución 839 de 2017), por lo que no puede suprimirse antes de ese término.

Declaro que he leído este aviso, que acepto la Política de Tratamiento de Datos Personales y los
Términos de Vinculación Profesional, y que autorizo el tratamiento de mis datos personales para
las finalidades aquí descritas.`;

/** SHA-256 hex de un texto (prueba de integridad del documento aceptado). */
export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Hash del documento vigente; se guarda junto a la aceptación como prueba. */
export const POLICY_HASH = sha256(`${POLICY_VERSION}\n${POLICY_TEXT}`);

import type { LegalDocument } from "./types";
import { POLICY_URL, PRIVACY_NOTICE_PATH } from "./urls";

/** 04 · Aviso de Privacidad (Decreto 1074 de 2015, art. 2.2.2.25.3.2). */
export const AVISO_PRIVACIDAD: LegalDocument = {
  slug: PRIVACY_NOTICE_PATH.slice(1),
  title: "Aviso de Privacidad",
  subtitle: "E-IRENE",
  version: "1.0",
  effectiveDate: "6 de octubre de 2026",
  blocks: [
    { type: "h2", text: "¿Quién trata sus datos?" },
    {
      type: "p",
      text: "**E-IRENE S.A.S. (en constitución; ver nota transitoria)**, con domicilio en Calle 80 Sur No. 45-51, apto. 2803, torre 1, Viña de San Remo. Medellín, Antioquia, Colombia.",
    },
    { type: "p", text: "**Correo para el ejercicio de sus derechos:** protecciondedatos@e-irene.co" },
    { type: "p", text: "**Teléfono:** 314 893 5997" },
    {
      type: "p",
      text: "**Nota transitoria:** Mientras E-IRENE S.A.S. no esté constituida e inscrita en el registro mercantil, quien trata sus datos y responde por ellos es **Jorge Arturo Miranda Alzate**, identificado con cédula de ciudadanía No. 1.004.774.475, quien opera la plataforma bajo el nombre comercial \"E-Irene\", con los mismos datos de contacto indicados arriba. Cuando la sociedad quede constituida, lo sustituirá como responsable, sin cambiar las finalidades aquí descritas, y el cambio se informará en el sitio web.",
    },

    { type: "h2", text: "¿Qué datos tratamos y para qué?" },
    {
      type: "p",
      text: "**Si usted es un profesional de la salud o personal de una clínica,** tratamos sus datos de identificación, contacto, habilitación profesional, facturación y uso de la plataforma, con el fin de crear y administrar su cuenta, **verificar que está habilitado para ejercer** consultando fuentes públicas oficiales como el Registro Único Nacional del Talento Humano en Salud (ReTHUS), cobrarle el servicio, darle soporte y cumplir obligaciones legales. En esta relación, E-Irene es el **Responsable** de sus datos.",
    },
    {
      type: "p",
      text: "**Si usted es paciente,** sus datos de salud —incluidas las transcripciones y los reportes de sus sesiones— son tratados por E-Irene **por cuenta del profesional o la clínica que lo atiende**, quien es el **Responsable** de su información y quien recaba su consentimiento mediante el Consentimiento Informado del Paciente. E-Irene actúa como **Encargado**: solo trata sus datos siguiendo las instrucciones de ese profesional, y no los usa para finalidades propias ni para entrenar modelos de inteligencia artificial.",
    },
    {
      type: "p",
      text: "**Si usted visita nuestro sitio web o nos escribe,** tratamos los datos que nos entregue en el formulario (nombre, correo, teléfono, institución y mensaje) para responder su solicitud y, solo si lo autoriza por separado, para enviarle información comercial.",
    },

    { type: "h2", text: "Datos sensibles" },
    {
      type: "p",
      text: "Los datos de salud son **sensibles**. Usted **no está obligado** a autorizar su tratamiento. Cuando se requiera su autorización, se le solicitará de forma **previa, expresa e informada**, y quedará constancia de ella.",
    },

    { type: "h2", text: "Si el titular es un niño, niña o adolescente" },
    {
      type: "p",
      text: "Cuando el paciente sea menor de 18 años, la autorización sigue el régimen de autonomía progresiva de la Resolución 309 de 2025 del Ministerio de Salud: los adolescentes de 14 años o más pueden autorizar por sí mismos; los menores de 14 participan mediante asentimiento evaluado por el profesional, y la autorización la otorga su representante legal. El detalle de este régimen está en el Consentimiento Informado del Paciente.",
    },

    { type: "h2", text: "Sobre el audio de las sesiones" },
    {
      type: "p",
      text: "**El audio de su sesión no se graba ni se almacena en ningún momento.** Se transcribe en vivo y únicamente se conserva el texto, cifrado. La transcripción se **suprime automáticamente** 7 días después de la sesión, se haya validado o no el reporte.",
    },

    { type: "h2", text: "¿Con quién compartimos sus datos?" },
    {
      type: "p",
      text: "Con proveedores de infraestructura tecnológica que actúan como encargados —alojamiento, base de datos, transcripción, análisis, videollamada, correo y mensajería—, obligados contractualmente a la confidencialidad. Los pagos de los profesionales se procesan a través de la pasarela Wompi, que trata esos datos como responsable independiente, conforme a su propia política de privacidad. Algunos proveedores están ubicados fuera de Colombia, lo que implica transferencia internacional de datos. El listado completo y actualizado está en la Política de Tratamiento. No vendemos ni cedemos sus datos a terceros con fines comerciales.",
    },

    { type: "h2", text: "Sus derechos" },
    {
      type: "p",
      text: "Conocer, actualizar y rectificar sus datos; solicitar prueba de la autorización; ser informado sobre su uso; revocar la autorización y solicitar la supresión cuando no exista un deber legal de conservación; acceder gratuitamente a sus datos; y presentar quejas ante la **Superintendencia de Industria y Comercio.**",
    },
    {
      type: "note",
      text: "Si sus datos hacen parte de una historia clínica, la ley obliga a conservarlos por 15 años desde la última atención (Resolución 839 de 2017). En ese caso no podemos suprimirlos, ni siquiera a solicitud suya, y se lo informaremos indicando el fundamento.",
    },
    {
      type: "p",
      text: "**Para ejercerlos:** escriba a **protecciondedatos@e-irene.co**. Responderemos las consultas en un máximo de **10 días hábiles** y los reclamos en un máximo de **15 días hábiles.**",
    },

    { type: "h2", text: "Política completa" },
    {
      type: "p",
      text: `Disponible permanentemente en [${POLICY_URL}](${POLICY_URL}).`,
    },
  ],
};

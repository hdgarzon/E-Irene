import type { LegalDocument } from "./types";
import { PLANS_URL, SIC_URL, TERMS_OF_USE_PATH } from "./urls";

/** 07 · Términos y Condiciones de Uso del sitio (cualquier visitante). */
export const TERMINOS_USO: LegalDocument = {
  slug: TERMS_OF_USE_PATH.slice(1),
  title: "Términos y Condiciones de Uso",
  subtitle:
    "Aplica a cualquier visitante del sitio; los profesionales y pacientes se rigen además por sus documentos específicos.",
  version: "1.0",
  effectiveDate: "6 de octubre de 2026",
  blocks: [
    {
      type: "p",
      text: "Estos Términos y Condiciones de Uso rigen la navegación y el uso del sitio web y de las secciones públicas de la plataforma de **E-IRENE S.A.S.** (\"**E-Irene**\") por **cualquier visitante,** incluida cualquier persona que apenas está conociendo el servicio, sin haberse registrado todavía. Mientras E-IRENE S.A.S. se encuentra en proceso de constitución, el sitio y la plataforma son operados por la persona natural identificada en la cláusula octava. Son distintos de los documentos que rigen la relación con quienes sí se vinculan a la plataforma:",
    },
    {
      type: "ul",
      items: [
        "**Si usted se registra como profesional de la salud** para usar las funcionalidades clínicas, lo rige adicionalmente el **Consentimiento y Términos de Vinculación del Profesional,** que prevalece sobre estos Términos generales en lo que le sea específico.",
        "**Si usted es paciente** atendido a través de la plataforma, lo rige el **Consentimiento Informado del Paciente.**",
        "**El tratamiento de sus datos personales** se rige por la **Política de Tratamiento de Datos Personales** y el **Aviso de Privacidad.**",
      ],
    },
    {
      type: "p",
      text: "Al navegar o usar este sitio, usted acepta estos Términos. Si no está de acuerdo, debe abstenerse de usarlo.",
    },

    { type: "h2", text: "PRIMERA — Qué es E-Irene y qué no es" },
    {
      type: "p",
      text: "E-Irene es una plataforma de software para el registro y gestión de la atención en salud mental —historia clínica electrónica, agendamiento, transcripción automatizada de sesiones y generación asistida de reportes clínicos— dirigida a profesionales de la salud y las instituciones que los emplean.",
    },
    {
      type: "p",
      text: "**E-Irene es un proveedor de tecnología. No presta servicios de salud, no atiende pacientes directamente, y ningún contenido de este sitio —incluidos textos informativos, artículos o material de mercadeo— constituye diagnóstico, tratamiento o asesoría médica, psicológica o legal.** Cualquier decisión clínica corresponde exclusivamente al profesional que atiende al paciente.",
    },

    { type: "h2", text: "SEGUNDA — Registro y cuentas" },
    {
      type: "p",
      text: "El acceso a las funcionalidades clínicas requiere registro como profesional, sujeto a la verificación de habilitación profesional y a la aceptación del Consentimiento y Términos de Vinculación del Profesional. **Los pacientes no crean una cuenta directamente en E-Irene:** acceden a través del profesional o la institución que los atiende.",
    },

    { type: "h2", text: "TERCERA — Uso aceptable" },
    { type: "p", text: "Al usar este sitio o la plataforma, usted se compromete a no:" },
    {
      type: "ul",
      items: [
        "Usarlos para fines ilícitos, fraudulentos o contrarios a estos Términos.",
        "Intentar acceder sin autorización a cuentas, sistemas o datos que no le correspondan.",
        "Interferir con el funcionamiento del sitio o la plataforma, incluida la introducción de virus o código malicioso.",
        "Copiar, modificar, distribuir o explotar comercialmente el contenido del sitio sin autorización expresa.",
        "Usar mecanismos automatizados (scraping, bots) para extraer contenido o datos del sitio.",
      ],
    },

    { type: "h2", text: "CUARTA — Propiedad intelectual del sitio" },
    {
      type: "p",
      text: "El nombre **\"E-Irene\",** el diseño, los textos, los gráficos, el código fuente y demás contenido del sitio y de la plataforma pertenecen a **E-IRENE S.A.S.** o a sus licenciantes, y están protegidos por las normas de propiedad intelectual aplicables. Ninguna disposición de estos Términos le otorga a usted licencia o derecho alguno sobre ellos, salvo el uso del sitio para los fines aquí descritos.",
    },
    {
      type: "p",
      text: "**PARÁGRAFO — Alcance de la sustitución transitoria de la cláusula octava.** La sustitución de **E-IRENE S.A.S.** por la persona natural mencionada en la cláusula octava, mientras la sociedad no esté constituida, tiene un propósito **exclusivamente de responsabilidad frente a terceros** —quién responde por las obligaciones de este sitio frente al público— y **no implica que la propiedad intelectual del sitio, la plataforma o los desarrollos de software le pertenezca individualmente a esa persona.** Mientras la sociedad no esté constituida, esos derechos pertenecen a el o los fundadores que efectivamente los hayan creado, conforme a las normas de derecho de autor, en la proporción y bajo los términos que ellos mismos acuerden, y se transferirán a **E-IRENE S.A.S.** mediante los documentos de cesión que suscriban los fundadores —no por el solo hecho de que uno de los fundadores figure frente al público como representante transicional de la cláusula octava.",
    },

    { type: "h2", text: "QUINTA — Enlaces y contenido de terceros" },
    {
      type: "p",
      text: "El sitio puede contener enlaces a páginas de terceros. **E-IRENE S.A.S.** no controla ni se hace responsable por el contenido, las políticas de privacidad o las prácticas de esos terceros.",
    },

    { type: "h2", text: "SEXTA — Disponibilidad y limitación de responsabilidad" },
    {
      type: "p",
      text: "E-IRENE S.A.S. hace esfuerzos razonables para mantener el sitio disponible y actualizado, pero **no garantiza disponibilidad ininterrumpida ni ausencia total de errores.** El uso del sitio informativo es bajo su propio riesgo. Esta limitación no aplica a las obligaciones específicas asumidas frente a profesionales en el Consentimiento y Términos de Vinculación del Profesional, ni frente a pacientes en el Consentimiento Informado del Paciente, que se rigen por sus propios términos.",
    },

    { type: "h2", text: "SÉPTIMA — Modificaciones" },
    {
      type: "p",
      text: "Estos Términos podrán modificarse en cualquier momento. Los cambios sustanciales se anunciarán en el sitio con la fecha de la nueva versión. El uso continuado del sitio después de publicado el cambio implica su aceptación.",
    },

    { type: "h2", text: "OCTAVA — Mientras la sociedad no esté constituida" },
    {
      type: "p",
      text: "Si a la fecha de su consulta **E-IRENE S.A.S.** aún no se encuentra legalmente constituida e inscrita en el registro mercantil, todas las referencias a **E-IRENE S.A.S.** en estos Términos se entienden hechas a **Jorge Arturo Miranda Alzate,** identificado con cédula de ciudadanía No. 1.004.774.475, quien opera el sitio y la plataforma bajo el nombre comercial \"E-Irene\" y asume personalmente, mientras tanto, las obligaciones aquí previstas. Una vez la sociedad quede constituida e inscrita, esta lo sustituirá automáticamente, y el cambio se anunciará en el sitio conforme a la cláusula séptima, sin que sea necesaria una nueva aceptación de estos Términos por ese solo motivo.",
    },

    { type: "h2", text: "NOVENA — Ley aplicable y solución de conflictos" },
    {
      type: "p",
      text: "Estos Términos se rigen por la **ley colombiana.** Las diferencias se someterán primero a un intento de conciliación ante el Centro de Conciliación y Arbitraje de la **Cámara de Comercio de Medellín para Antioquia** y, de no lograrse acuerdo, se resolverán ante los **jueces competentes del domicilio del usuario,** por las mismas razones expuestas en el Consentimiento y Términos de Vinculación del Profesional: una cláusula arbitral obligatoria frente al público general, que no negocia estos términos, puede resultar abusiva e inoponible, además de más costosa para la parte débil de la relación.",
    },

    { type: "h2", text: "DÉCIMA — Contacto" },
    {
      type: "p",
      text: "Para ejercer sus derechos sobre datos personales o preguntas sobre estos términos, diríjase al correo señalado en la Política de Tratamiento de Datos Personales: protecciondedatos@e-irene.co",
    },

    { type: "h2", text: "UNDÉCIMA — Planes y precios" },
    {
      type: "p",
      text: `Los planes, sus límites y precios vigentes se publican en [${PLANS_URL}](${PLANS_URL}), en pesos colombianos e indicando si incluyen IVA. Las condiciones de suscripción, renovación, cambios de plan, compras adicionales y cancelación están en la cláusula duodécima del Consentimiento y Términos de Vinculación del Profesional, y los cambios de precio para profesionales ya vinculados se comunican conforme a su cláusula décima.`,
    },

    { type: "h2", text: "DUODÉCIMA — Identificación, medios de pago y PQR" },
    {
      type: "ol",
      items: [
        "**Identificación.** E-IRENE S.A.S. —o, mientras la sociedad no esté constituida, la persona natural identificada en la cláusula octava— tiene domicilio en Calle 80 Sur No. 45-51, apto. 2803, torre 1, Viña de San Remo. Medellín, Antioquia, Colombia. El correo de contacto para asuntos comerciales es hola@e-irene.co",
        "**Medios de pago.** Los pagos se procesan a través de la pasarela **Wompi**, que acepta los siguientes medios: **tarjeta de crédito, tarjeta débito y PSE.** E-Irene no almacena los datos de las tarjetas. Todos los precios se cobran en pesos colombianos; si algún medio de pago genera un recargo adicional, este se indicará antes de confirmar la transacción.",
        "**Peticiones, quejas y reclamos (PQR).** Para presentar una petición, queja o reclamo relacionado con la compra o el uso del servicio —distinto del ejercicio de derechos sobre datos personales, que se rige por la Política de Tratamiento de Datos Personales—, escriba a protecciondedatos@e-irene.co o use el formulario de PQR del sitio. Cada PQR recibirá un número de radicado con la fecha y hora de su presentación, conforme al literal g) del artículo 50 de la Ley 1480 de 2011, modificado por el artículo 4 de la Ley 2439 de 2024, y se atenderá dentro de los quince (15) días hábiles siguientes, sin perjuicio del derecho del usuario a acudir directamente a la Superintendencia de Industria y Comercio.",
        `**Enlace a la Superintendencia de Industria y Comercio.** Conforme al artículo 50 de la Ley 1480 de 2011, este sitio incluye un enlace visible y de fácil acceso a la página de la Superintendencia de Industria y Comercio: [${SIC_URL.replace("https://", "")}](${SIC_URL}).`,
        "**Confirmación y factura.** Cada pago o activación de un plan se confirmará al correo registrado, indicando el plan, el precio, la fecha y el período cubierto.",
      ],
    },
  ],
};

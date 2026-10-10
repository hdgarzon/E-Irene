import type { LegalDocument } from "./types";

/**
 * 05 · Consentimiento Informado del Paciente: consentimiento de la atención y
 * autorización de tratamiento de datos sensibles, en un solo documento.
 *
 * Los campos de firma del documento fuente (nombre, documento, firma del
 * representante, asentimiento) no van en el texto: los recoge el formulario y
 * se guardan junto a la firma (tabla consents).
 */
export const CONSENTIMIENTO_PACIENTE: LegalDocument = {
  slug: "consentimiento-paciente",
  title: "Consentimiento Informado del Paciente",
  subtitle: "E-IRENE",
  version: "1.0",
  effectiveDate: "6 de octubre de 2026",
  blocks: [
    {
      type: "p",
      text: "Este documento tiene dos funciones a la vez: (1) el **consentimiento informado** propio de la atención en salud, en el que su profesional le explica en qué consiste la consulta y usted decide si acepta recibirla así; y (2) la **autorización para el tratamiento de sus datos personales**, incluidos sus datos de salud, que son datos sensibles. Lo presenta su profesional o la institución que lo atiende (el \"**Profesional**\"), quien es **responsable** de su historia clínica. La plataforma tecnológica que usa el Profesional se llama **E-IRENE S.A.S.** (\"**E-Irene**\"), que actúa como **encargado**: trata su información siguiendo las instrucciones del Profesional, y no la usa para fines propios.",
    },

    { type: "h2", text: "PRIMERA — Qué es E-Irene y qué no es" },
    {
      type: "p",
      text: "E-Irene es el software que su Profesional utiliza para registrar su atención: agenda la cita, transcribe la sesión y ayuda a redactar el reporte clínico. **E-Irene no presta servicios de salud, no lo atiende a usted directamente y no reemplaza el criterio de su Profesional.** Cualquier decisión clínica —diagnóstico, tratamiento, remisión— la toma exclusivamente su Profesional.",
    },
    {
      type: "p",
      text: "Nota transitoria: mientras la sociedad E-IRENE S.A.S. no esté constituida, la plataforma es operada por **Jorge Arturo Miranda Alzate,** como persona natural, identificado con cédula de ciudadanía No. 1.004.774.475, quien opera la plataforma bajo el nombre comercial \"E-Irene\" y asume frente a usted las mismas obligaciones aquí descritas. Una vez la sociedad quede constituida e inscrita, esta lo sustituirá como Responsable. El detalle de este punto está en la Política de Tratamiento de Datos Personales, sección 1.",
    },

    { type: "h2", text: "SEGUNDA — Cómo funciona su consulta" },
    {
      type: "ol",
      items: [
        "Si su consulta es por videollamada o presencial con transcripción activada, el sistema convierte lo que se habla en **texto, en vivo.**",
        "**El audio de su consulta no se graba ni se almacena en ningún momento,** ni por E-Irene ni por sus proveedores. Solo se transmite en directo para producir el texto, y luego se descarta.",
        "Ese texto queda protegido con cifrado (un método de seguridad llamado AES-256-GCM) mientras se procesa y se guarda.",
        "Un sistema de inteligencia artificial lee el texto y sugiere un **borrador** de reporte para ayudar a su Profesional a redactar más rápido.",
        "**Ese borrador no es su historia clínica ni un diagnóstico.** Su Profesional lo revisa, lo corrige si hace falta, y solo cuando lo valida se convierte en su historia clínica oficial.",
        "Puede pedirle a su Profesional, en cualquier momento de la sesión, que se detenga la transcripción.",
      ],
    },

    { type: "h2", text: "TERCERA — Sobre el apoyo de inteligencia artificial" },
    {
      type: "p",
      text: "Algunas funciones de la plataforma —como resúmenes, análisis de patrones o **indicadores de riesgo**— son **apoyos auxiliares para su Profesional, no diagnósticos.** Estas señales pueden equivocarse: pueden marcar una alerta que no corresponde a un riesgo real, o pueden no marcar una que sí lo es. **No reemplazan el criterio ni el seguimiento de su Profesional,** quien sigue siendo responsable de evaluarlo a usted directamente.",
    },

    { type: "h2", text: "CUARTA — ¿Cuánto tiempo se guarda mi información?" },
    {
      type: "table",
      head: ["Información", "Plazo", "Motivo"],
      rows: [
        ["Audio de la sesión", "No se conserva", "Se descarta apenas se convierte en texto"],
        ["Transcripción de la sesión", "7 días desde la sesión, se haya validado o no el reporte", "Documento de trabajo intermedio"],
        [
          "Historia clínica (reporte validado, notas, evaluaciones)",
          "15 años desde su última atención",
          "Resolución 839 de 2017",
        ],
      ],
    },
    {
      type: "note",
      text: "Una vez cumplidos estos plazos, la transcripción se borra de forma automática e irreversible. Si su Profesional necesita conservar algo de la sesión, debe incorporarlo al reporte antes de que se cumpla el plazo.",
    },
    {
      type: "p",
      text: "**Su historia clínica no se puede eliminar antes de los 15 años,** ni siquiera si usted lo solicita, porque la ley se lo exige a su Profesional. Si usted pide su eliminación, se le informará por qué no es posible y hasta cuándo debe conservarse.",
    },

    { type: "h2", text: "QUINTA — Sus datos de salud son datos sensibles" },
    {
      type: "p",
      text: "Sus datos de salud —el motivo de consulta, la transcripción, el reporte, las evaluaciones— son **datos sensibles** según la Ley 1581 de 2012. **Usted no está obligado a autorizar su tratamiento.** Si no lo autoriza, su Profesional no podrá atenderlo a través de esta plataforma y deberá ofrecerle otro medio para registrar su atención.",
    },

    { type: "h2", text: "SEXTA — Sus datos viajan fuera de Colombia" },
    {
      type: "p",
      text: "Para poder transcribir su sesión y generar el borrador de reporte, E-Irene usa proveedores de tecnología ubicados fuera de Colombia:",
    },
    {
      type: "ul",
      items: [
        "**Deepgram** (transcripción de voz a texto, en vivo).",
        "**OpenAI** (análisis del texto de la sesión).",
        "**Supabase** (almacenamiento cifrado de la información).",
        "**Vercel** (alojamiento de la aplicación).",
        "Cuando su consulta sea por videollamada dentro de la plataforma, **Daily.co** para la transmisión de video.",
        "Cuando su Profesional le envíe recordatorios de citas, **Resend** para el correo electrónico y **Twilio** para WhatsApp, que solo reciben su nombre, contacto y el texto del recordatorio.",
      ],
    },
    {
      type: "p",
      text: "Estos proveedores solo reciben la información necesaria para prestar su función, están obligados por contrato a confidencialidad y seguridad, y **E-Irene tiene desactivada la opción de que usen sus datos para entrenar sus propios modelos de inteligencia artificial.** Al firmar este documento, usted **autoriza expresamente** que su información viaje a estos proveedores para los fines aquí descritos.",
    },
    {
      type: "note",
      text: "E-Irene podrá reemplazar a cualquiera de estos proveedores por otro que cumpla una función equivalente y ofrezca garantías de seguridad y confidencialidad al menos equivalentes. Si esto ocurre, el cambio se informará actualizando la Política de Tratamiento de Datos Personales, sin que sea necesario firmar un nuevo consentimiento por ese solo motivo.",
    },

    { type: "h2", text: "SÉPTIMA — Si su consulta es por videollamada (telemedicina)" },
    {
      type: "p",
      text: "Cuando la atención se preste por videollamada, su Profesional debe explicarle cómo se desarrollará, sus beneficios, riesgos y limitaciones frente a una consulta presencial, y verificar su identidad, conforme a la normativa de telesalud vigente. Usted puede pedir en cualquier momento ser atendido presencialmente en su lugar.",
    },

    { type: "h2", text: "OCTAVA — Si usted es un niño, niña o adolescente" },
    {
      type: "p",
      text: "Esta sección aplica cuando el paciente es menor de 18 años, y sigue los lineamientos de la Resolución 309 de 2025 del Ministerio de Salud sobre autonomía progresiva de niños, niñas y adolescentes.",
    },
    {
      type: "ul",
      items: [
        "**Si usted tiene 14 años o más,** puede leer este documento y dar su propio consentimiento, sin que sea obligatorio que lo acompañe un adulto, al menos para una consulta de bajo riesgo como una sesión psicológica estándar. Usted firma esta autorización directamente.",
        "**Si usted tiene menos de 14 años,** su Profesional conversará con usted, en un lenguaje que pueda entender, sobre en qué consiste la consulta, y le preguntará si está de acuerdo (esto se llama \"asentimiento\"). Su opinión queda anotada en su historia clínica, sin que tenga que firmar nada. Además, su papá, mamá o quien lo represente legalmente debe dar su autorización.",
        "En cualquier caso, su Profesional debe evaluar qué tan bien usted entiende la información, según su edad y su momento de desarrollo, y debe escucharlo antes de decidir cómo proceder.",
      ],
    },
    {
      type: "note",
      text: "Nota para el Profesional: registre en la historia clínica el criterio de valoración de capacidad utilizado (comunicación de la decisión, comprensión, razonamiento y juicio) cuando el paciente sea menor de 14 años, conforme a la Resolución 309 de 2025.",
    },

    { type: "h2", text: "NOVENA — Sus derechos" },
    {
      type: "p",
      text: "Usted puede en cualquier momento: conocer, actualizar y corregir sus datos; pedir una copia de su historia clínica; preguntar cómo se están usando sus datos; y **revocar esta autorización.** Recuerde que revocarla no borra la historia clínica ya generada, porque la ley obliga a conservarla. Para ejercer estos derechos, diríjase en primer lugar a su Profesional, quien es el responsable de sus datos de salud. Si prefiere escribir directamente a E-Irene, puede hacerlo a **protecciondedatos@e-irene.co**, y su solicitud será trasladada al Profesional dentro de los tres (3) días hábiles siguientes.",
    },

    { type: "h2", text: "DÉCIMA — Autorización" },
    {
      type: "p",
      text: "Declaro que he leído y entendido este documento, que pude hacer las preguntas que necesitaba, y que **autorizo, de forma libre, previa, expresa e informada, el tratamiento de mis datos personales, incluidos mis datos de salud, y la transferencia internacional descrita, en los términos aquí explicados.**",
    },
    {
      type: "p",
      text: "Declaro además que entendí que **E-Irene es un proveedor de tecnología, que no presta servicios de salud, no me atiende directamente y no sustituye el criterio de mi Profesional,** y que **cualquier reclamación relacionada con la atención en salud que recibí debe dirigirse a mi Profesional,** quien es el responsable de ella.",
    },
    {
      type: "note",
      text: "Registro de la aceptación: al aceptarse, la plataforma conservará como prueba la versión del documento, su huella criptográfica (SHA-256), identificación de quien acepta, dirección IP, agente de usuario y marca temporal.",
    },
  ],
};

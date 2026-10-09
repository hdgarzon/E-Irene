import type { LegalDocument } from "./types";
import { POLICY_PATH } from "./urls";

/** 01 · Política de Tratamiento de Datos Personales (Ley 1581 de 2012). */
export const POLITICA_DATOS: LegalDocument = {
  slug: POLICY_PATH.slice(1),
  title: "Política de Tratamiento de Datos Personales",
  subtitle: "E-IRENE S.A.S.",
  version: "1.0",
  effectiveDate: "6 de octubre de 2026",
  blocks: [
    { type: "h2", text: "1. Identificación del Responsable" },
    {
      type: "table",
      head: ["Campo", "Dato"],
      rows: [
        ["Razón social y NIT", "E-IRENE S.A.S. (en constitución; ver nota transitoria)"],
        [
          "Domicilio",
          "Calle 80 Sur No. 45-51, apto. 2803, torre 1, Viña de San Remo. Medellín, Antioquia, Colombia",
        ],
        ["Correo para ejercicio de derechos", "protecciondedatos@e-irene.co"],
        ["Teléfono", "314 893 5997"],
        ["Área responsable", "Área de Protección de Datos"],
      ],
    },
    {
      type: "p",
      text: "**NOTA TRANSITORIA —** A la fecha de esta versión, **E-IRENE S.A.S.** aún no está legalmente constituida ni inscrita en el registro mercantil. Mientras eso ocurre, quien realmente ejerce como Responsable del Tratamiento —y responde personalmente por ello ante los titulares y ante la Superintendencia de Industria y Comercio— es **Jorge Arturo Miranda Alzate**, identificado con cédula de ciudadanía No. 1.004.774.475, quien opera la plataforma bajo el nombre comercial \"E-Irene\". Una vez la sociedad quede constituida e inscrita, esta lo sustituirá como Responsable, y el cambio se informará a los titulares mediante la actualización de esta política (sección 10) a través de publicación en la página web, sin necesidad de una nueva autorización, porque no cambian ni las finalidades ni el alcance del tratamiento —solo quién responde por él.",
    },

    { type: "h2", text: "2. Alcance: la doble condición de E-Irene" },
    { type: "h3", text: "2.1 E-Irene como Responsable" },
    {
      type: "p",
      text: "Respecto de los datos de profesionales de la salud, personal administrativo de las clínicas, usuarios del sitio web y contactos comerciales. Sobre estos datos, E-Irene decide las finalidades y los medios, y esta política los rige íntegramente.",
    },
    { type: "h3", text: "2.2 E-Irene como Encargado" },
    {
      type: "p",
      text: "Respecto de los datos de **pacientes** —incluidas las historias clínicas, transcripciones y reportes— que los profesionales y las clínicas incorporan a la plataforma. En estos casos el Responsable es la clínica o el profesional tratante, quien determina las finalidades y obtiene el consentimiento del paciente. E-Irene los trata únicamente conforme a las instrucciones del Responsable y en los términos del acuerdo de encargo incorporado en el Consentimiento y Términos de Vinculación del Profesional.",
    },
    {
      type: "note",
      text: "Si usted es paciente: para ejercer sus derechos sobre su historia clínica, diríjase en primer lugar al profesional o la clínica que lo atiende, que es el Responsable de sus datos. E-Irene atenderá y trasladará cualquier solicitud que reciba directamente, e informará al titular a quién corresponde resolverla, dentro de los términos legales.",
    },

    { type: "h2", text: "3. Datos tratados y finalidades" },
    { type: "h3", text: "3.1 Datos de profesionales y personal de clínicas (E-Irene como Responsable)" },
    {
      type: "table",
      head: ["Categoría", "Datos", "Finalidad", "Base"],
      rows: [
        ["Identificación", "Nombre, documento, correo, teléfono", "Crear y administrar la cuenta", "Ejecución del contrato"],
        [
          "Habilitación profesional",
          "Tarjeta profesional, registro en ReTHUS, título",
          "Verificar que quien accede a historias clínicas es un profesional habilitado",
          "Obligación legal e interés legítimo en la seguridad del servicio",
        ],
        [
          "Facturación",
          "Plan, historial de pagos, datos de la transacción",
          "Cobrar el servicio y cumplir obligaciones tributarias",
          "Ejecución del contrato y obligación legal",
        ],
        [
          "Uso y seguridad",
          "Registros de acceso, IP, agente de usuario, trazas de auditoría",
          "Seguridad, trazabilidad legal, soporte, prevención del fraude",
          "Interés legítimo y obligación legal",
        ],
        [
          "Comunicaciones",
          "Correo, preferencias",
          "Avisos operativos y, previa autorización separada, comunicaciones comerciales",
          "Consentimiento para lo comercial",
        ],
      ],
    },
    {
      type: "p",
      text: "La verificación de habilitación profesional implica consultar datos de identificación contra fuentes públicas oficiales, incluido el Registro Único Nacional del Talento Humano en Salud (ReTHUS). El Profesional autoriza esta consulta al registrarse, mediante la casilla de aceptación en la que se le informa expresamente esta finalidad.",
    },
    { type: "h3", text: "3.1 bis Datos de visitantes del sitio web y contactos comerciales (E-Irene como Responsable)" },
    {
      type: "p",
      text: "Cuando una persona escribe a E-Irene o diligencia un formulario del sitio web (contacto, solicitud de demostración o similar), E-Irene trata su nombre, correo, teléfono, institución y el contenido de su mensaje, con el fin de responder su solicitud y, solo si lo autoriza en casilla separada, enviarle información comercial. La base es la autorización otorgada al enviar el formulario.",
    },
    {
      type: "p",
      text: "El sitio web utiliza cookies técnicas, necesarias para su funcionamiento y para la seguridad de la sesión. Si E-Irene incorpora cookies de analítica o publicitarias, lo informará mediante un aviso en el sitio y solo las activará después de que el visitante las acepte.",
    },
    { type: "h3", text: "3.2 Datos de pacientes (E-Irene como Encargado)" },
    {
      type: "table",
      head: ["Categoría", "Datos", "Naturaleza"],
      rows: [
        ["Identificación", "Nombre, documento, fecha de nacimiento, sexo, contacto", "Personal"],
        ["Contacto de emergencia", "Nombre y teléfono de un tercero", "Personal de tercero"],
        [
          "Salud",
          "Motivo de consulta, transcripción, reportes clínicos, notas SOAP, planes de tratamiento, evaluaciones psicométricas, indicadores de riesgo",
          "Sensible (art. 5, Ley 1581 de 2012)",
        ],
        [
          "Consentimiento",
          "Firma, huella criptográfica del documento, IP, agente de usuario, fecha y hora",
          "Personal",
        ],
      ],
    },
    {
      type: "p",
      text: "**Finalidad única:** prestar al Responsable el servicio de historia clínica electrónica, transcripción y generación asistida de reportes.",
    },
    {
      type: "p",
      text: "**E-Irene no utiliza datos de pacientes para finalidades propias.** En particular, no los emplea para entrenar modelos de inteligencia artificial, ni propios ni de terceros, ni los comercializa, ni los cede a terceros distintos de los encargados listados en la sección 4.",
    },
    { type: "h3", text: "3.3 Datos sensibles: advertencia legal" },
    {
      type: "p",
      text: "Los datos de salud son sensibles. En consecuencia: ningún titular está obligado a autorizar su tratamiento; la autorización debe ser explícita, previa e informada, y se recaba mediante el Consentimiento Informado del Paciente antes de la primera sesión; se conserva prueba de la autorización (versión, huella SHA-256, firma, IP, agente de usuario y marca temporal); y tratándose de niños, niñas o adolescentes, se aplica el régimen de autonomía progresiva de la Resolución 309 de 2025 del Ministerio de Salud —desarrollado en el Consentimiento Informado del Paciente—, según el cual los adolescentes de 14 años o más pueden autorizar por sí mismos, y los menores de 14 participan mediante asentimiento evaluado por el Profesional, con el consentimiento sustituto del representante legal.",
    },

    { type: "h2", text: "4. Encargados y transferencias internacionales" },
    {
      type: "p",
      text: "E-Irene se apoya en proveedores de infraestructura y servicios que actúan como encargados. **La mayoría están ubicados fuera de Colombia,** por lo que existe transferencia internacional de datos, incluidos datos sensibles de salud, respecto de esos proveedores.",
    },
    {
      type: "table",
      head: ["Proveedor", "Función", "Datos que trata", "Ubicación"],
      rows: [
        ["Supabase", "Base de datos, autenticación, almacenamiento", "Todos los datos de la plataforma, cifrados", "EE. UU."],
        ["Vercel", "Alojamiento y ejecución de la aplicación", "Datos en tránsito; registros de acceso", "EE. UU."],
        ["Deepgram", "Transcripción de voz a texto", "Audio de la sesión en tiempo real", "EE. UU."],
        ["OpenAI", "Análisis asistido del texto", "Transcripción en texto", "EE. UU."],
        ["Daily.co", "Videollamada", "Video y audio en tránsito, sin almacenamiento", "EE. UU."],
        ["Resend", "Correo transaccional", "Correo y nombre del destinatario", "EE. UU."],
        ["Twilio", "Mensajería WhatsApp (planes superiores)", "Teléfono y contenido del recordatorio", "EE. UU."],
      ],
    },
    { type: "h3", text: "4.1 Garantías aplicables" },
    {
      type: "p",
      text: "Colombia exige que la transferencia internacional se dirija a países con nivel adecuado de protección o que se adopten garantías equivalentes. **E-Irene se obliga a, y se encuentra en proceso de formalizar con cada proveedor listado:**",
    },
    {
      type: "ol",
      items: [
        "Suscribir un acuerdo de tratamiento de datos (DPA) o equivalente que le imponga confidencialidad, medidas de seguridad y prohibición de uso para fines propios.",
        "Exigir certificaciones de seguridad vigentes (SOC 2 Tipo II o equivalente).",
        "Configurar los servicios de modo que el contenido de las consultas no se utilice para entrenar modelos de los proveedores.",
        "Mantener un registro actualizado de encargados y notificar los cambios conforme a la sección 10.",
      ],
    },
    { type: "h3", text: "4.1 bis Pasarela de pagos (Wompi) — no es un encargado" },
    {
      type: "p",
      text: "A diferencia de los proveedores anteriores, la pasarela de pagos (**Wompi**) no trata los datos de facturación del Profesional por instrucción de E-Irene: su propia Política de Tratamiento de Datos Personales la define, para los datos que procesa, como **Responsable del tratamiento** —no como Encargado—, y enumera sus propias obligaciones frente a los titulares como tal (garantizar el ejercicio de sus derechos, conservar la prueba de la autorización, entre otras). Esto es coherente con su naturaleza de agregador de pagos regulado, con obligaciones propias de conocimiento del cliente y prevención de fraude que no dependen de las instrucciones de los comercios afiliados.",
    },
    {
      type: "p",
      text: "En consecuencia: (i) la relación con Wompi respecto de los datos de facturación del Profesional es una **transferencia entre dos Responsables,** no una transmisión a un Encargado, por lo que no le aplican las garantías del numeral 4.1 (DPA, certificación SOC 2) diseñadas para encargados que operan bajo instrucción; (ii) E-Irene se limita a compartir con Wompi los datos estrictamente necesarios para procesar el pago, e informa al Profesional que, una vez esos datos llegan a Wompi, su tratamiento se rige por la política de privacidad propia de Wompi, disponible en su sitio web; y (iii) al ser Wompi una entidad colombiana, esta transferencia no constituye transferencia internacional de datos.",
    },
    { type: "h3", text: "4.2 Tratamiento del audio" },
    {
      type: "ul",
      items: [
        "El audio no se graba ni se almacena en ningún momento, ni por E-Irene ni por sus proveedores. El navegador del profesional lo transmite en directo al proveedor de transcripción y solo regresa texto.",
        "E-Irene tiene desactivada la participación en el programa de mejora de modelos del proveedor de transcripción. Con esa configuración, el proveedor retiene los datos únicamente durante el tiempo necesario para procesar la petición.",
        "En videollamada, el proveedor de video transmite sin conservar copia.",
      ],
    },

    { type: "h2", text: "5. Plazos de conservación" },
    {
      type: "table",
      head: ["Dato", "Plazo", "Fundamento"],
      rows: [
        ["Audio de la sesión", "No se conserva", "Minimización"],
        [
          "Transcripción de la sesión",
          "7 días desde la sesión, se haya validado o no el reporte",
          "Documento de trabajo intermedio; minimización",
        ],
        [
          "Reporte clínico, notas y evaluaciones",
          "15 años desde la última atención (5 en archivo de gestión + 10 en archivo central)",
          "Resolución 839 de 2017",
        ],
        ["Consentimientos", "Igual que la historia clínica", "Prueba de la autorización"],
        ["Registros de auditoría", "10 años", "Trazabilidad y defensa jurídica"],
        [
          "Datos de facturación",
          "10 años",
          "Código de Comercio, arts. 28 y 60 (deber de conservación de libros y papeles del comerciante)",
        ],
        ["Cuenta del profesional", "Mientras esté vigente la relación, más 2 años", "Ejecución del contrato y términos de prescripción"],
      ],
    },
    {
      type: "p",
      text: "**La supresión de la transcripción es automática y verificable:** se ejecuta mediante un proceso programado diario y cada ejecución queda registrada en el log de auditoría inmutable, con fecha y número de registros suprimidos.",
    },
    {
      type: "note",
      text: "Nota sobre los datos de salud: el derecho de supresión no es absoluto cuando existe un deber legal de conservación. Los reportes clínicos que integran la historia clínica no pueden suprimirse antes de los términos de la Resolución 839 de 2017, ni siquiera a solicitud del titular. Ante una solicitud de supresión, E-Irene lo informará indicando el fundamento.",
    },

    { type: "h2", text: "6. Derechos de los titulares" },
    {
      type: "ol",
      items: [
        "Conocer, actualizar y rectificar sus datos.",
        "Solicitar prueba de la autorización, salvo cuando la ley no la exija.",
        "Ser informado sobre el uso dado a sus datos.",
        "Presentar quejas ante la Superintendencia de Industria y Comercio.",
        "Revocar la autorización y solicitar la supresión, cuando no exista deber legal o contractual de conservación.",
        "Acceder gratuitamente a sus datos.",
      ],
    },

    { type: "h2", text: "7. Procedimiento para consultas y reclamos" },
    { type: "p", text: "**Canal: protecciondedatos@e-irene.co**" },
    { type: "h3", text: "7.1 Consultas" },
    {
      type: "p",
      text: "Se resuelven en un término máximo de diez (10) días hábiles. De no ser posible, se informará al interesado la razón y la fecha de respuesta, que no superará los cinco (5) días hábiles siguientes al vencimiento del primer plazo.",
    },
    { type: "h3", text: "7.2 Reclamos" },
    {
      type: "p",
      text: "La solicitud debe contener identificación del titular, descripción de los hechos, dirección de contacto y los documentos que se quieran hacer valer. Si está incompleta, se requerirá al interesado dentro de los cinco (5) días siguientes; transcurridos dos (2) meses sin respuesta, se entenderá desistida. El reclamo se resuelve en un término máximo de quince (15) días hábiles, prorrogable por ocho (8) días hábiles más, previa comunicación de las razones. Mientras el reclamo esté en trámite, el dato quedará marcado con la leyenda \"reclamo en trámite\".",
    },
    { type: "h3", text: "7.3 Requisito de procedibilidad" },
    {
      type: "p",
      text: "El titular deberá agotar este trámite antes de acudir a la Superintendencia de Industria y Comercio.",
    },
    { type: "h3", text: "7.4 Solicitudes de pacientes" },
    {
      type: "p",
      text: "Cuando la solicitud provenga de un paciente y se refiera a datos en los que E-Irene actúa como Encargado, se trasladará al Responsable —el profesional o la clínica— dentro de los tres (3) días hábiles siguientes, informando de ello al titular. E-Irene apoyará al Responsable con los medios técnicos necesarios para atenderla.",
    },

    { type: "h2", text: "8. Medidas de seguridad" },
    {
      type: "ul",
      items: [
        "Cifrado en reposo: AES-256-GCM a nivel de aplicación sobre datos de identificación y datos clínicos.",
        "Cifrado en tránsito: TLS en todas las comunicaciones.",
        "Aislamiento entre clínicas: políticas de seguridad a nivel de fila (RLS) en la base de datos.",
        "Control de acceso por rol: administrador, profesional, personal administrativo y paciente, con permisos diferenciados.",
        "Registro de auditoría inmutable: las trazas no admiten modificación ni borrado, ni siquiera por administradores.",
        "Minimización: el audio no se persiste; la transcripción se suprime automáticamente.",
        "Trazabilidad del consentimiento: huella SHA-256 del documento firmado, IP, agente de usuario y marca temporal.",
      ],
    },

    { type: "h2", text: "9. Incidentes de seguridad" },
    {
      type: "p",
      text: "La legislación colombiana no fija un plazo único y exacto para notificar incidentes. Para dar certeza operativa, E-Irene adopta como estándar propio:",
    },
    {
      type: "ol",
      items: [
        "Contener y evaluar el alcance del incidente tan pronto se detecte.",
        "Informar a la Superintendencia de Industria y Comercio sin dilación injustificada y, en todo caso, dentro de los quince (15) días hábiles siguientes a su detección, conforme al deber general de reporte de la Ley 1581 de 2012.",
        "Notificar sin dilación injustificada a los Responsables afectados —clínicas y profesionales— para que estos, a su vez, informen a los titulares.",
        "Documentar el incidente y las medidas correctivas adoptadas.",
      ],
    },

    { type: "h2", text: "10. Vigencia y modificaciones" },
    {
      type: "p",
      text: "Esta política rige desde su publicación y permanecerá vigente mientras E-Irene desarrolle su objeto social. Las bases de datos se conservarán por los plazos de la sección 5. Los cambios sustanciales —en particular los que afecten finalidades, plazos de conservación o el listado de encargados— se comunicarán con quince (15) días de antelación mediante aviso en la plataforma. Si el cambio implica una finalidad nueva y distinta, se solicitará nueva autorización.",
    },
  ],
};

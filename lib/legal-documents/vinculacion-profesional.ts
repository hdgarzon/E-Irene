import type { LegalDocument } from "./types";
import { PLANS_URL, PROFESSIONAL_TERMS_PATH } from "./urls";

/**
 * 06 · Consentimiento y Términos de Vinculación del Profesional: licencia de uso,
 * declaración de habilitación y acuerdo de encargo (art. 25, Ley 1581 de 2012).
 *
 * El bloque "ACEPTACIÓN" del documento fuente no va aquí: es el texto de la
 * casilla y vive en PROFESSIONAL_ACCEPTANCE_TEXT (lib/legal.ts).
 */
export const VINCULACION_PROFESIONAL: LegalDocument = {
  slug: PROFESSIONAL_TERMS_PATH.slice(1),
  title: "Consentimiento y Términos de Vinculación del Profesional",
  subtitle: "E-IRENE S.A.S.",
  version: "1.0",
  effectiveDate: "6 de octubre de 2026",
  blocks: [
    {
      type: "p",
      text: "Este documento cumple tres funciones a la vez: (1) contrato de licencia de uso de la plataforma; (2) declaración de habilitación profesional, el control que impide que una persona no habilitada acceda a historias clínicas; y (3) acuerdo de encargo del tratamiento de datos (art. 25, Ley 1581 de 2012), en tanto E-Irene trata datos de pacientes por cuenta del Profesional, que es el Responsable de esos datos.",
    },

    { type: "h2", text: "PRIMERA — Partes y objeto" },
    {
      type: "p",
      text: "Este documento regula la relación entre E-IRENE S.A.S., sociedad en constitución con domicilio en Medellín (en adelante, E-Irene), y la persona natural o jurídica que se registra en la plataforma (en adelante, el Profesional). Cuando el Profesional actúe a nombre de una institución prestadora de servicios de salud, las obligaciones de este documento vinculan tanto a quien se registra como a la institución representada, sin que se requiera un formato contractual separado para instituciones: basta con que quien se registre cuente con facultades de representación suficientes, conforme a la declaración de la cláusula segunda, numeral 4.",
    },
    {
      type: "p",
      text: "E-Irene concede al Profesional una licencia de uso, no exclusiva, intransferible y revocable, sobre una plataforma de software para el registro y gestión de la atención en salud mental, que incluye historia clínica electrónica, agendamiento, transcripción automatizada de sesiones y generación asistida de reportes clínicos.",
    },
    {
      type: "p",
      text: "**E-Irene es un proveedor de software. No presta servicios de salud, no atiende pacientes y no sustituye el criterio del Profesional.**",
    },
    {
      type: "p",
      text: "**PARÁGRAFO —** Si a la fecha de aceptación de este documento **E-IRENE S.A.S.** aún no se encuentra legalmente constituida e inscrita en el registro mercantil, todas las referencias a **E-IRENE S.A.S.** en este documento se entienden hechas a **Jorge Arturo Miranda Alzate,** identificado con cédula de ciudadanía No. 1.004.774.475, quien asume personalmente, mientras tanto, todas las obligaciones y responsabilidades aquí previstas. **El Profesional acepta desde ahora, sin necesidad de firmar un nuevo documento,** que una vez la sociedad quede constituida e inscrita, esta se subrogará en su posición contractual, asumiendo sus derechos y obligaciones. E-Irene informará al Profesional esa subrogación por correo electrónico y mediante aviso en la plataforma, conforme al artículo décimo.",
    },

    { type: "h2", text: "SEGUNDA — Declaraciones del Profesional" },
    { type: "p", text: "El Profesional declara, **bajo la gravedad del juramento**, que:" },
    {
      type: "ol",
      items: [
        "Es **profesional de la salud debidamente habilitado** para ejercer en Colombia, cuenta con título válido y con **inscripción vigente en el Registro Único Nacional del Talento Humano en Salud (ReTHUS)** cuando su profesión lo exija.",
        "**No se encuentra suspendido ni inhabilitado** para el ejercicio profesional por autoridad judicial, administrativa o tribunal ético-disciplinario.",
        "La información y los documentos que aporte para la verificación son **auténticos y vigentes.**",
        "Cuando actúe a nombre de una institución prestadora de servicios de salud, **cuenta con facultades suficientes** para obligarla y esta se encuentra habilitada conforme a la normativa vigente.",
        "Conoce y cumple sus deberes de **secreto profesional** y de manejo de la historia clínica (Ley 23 de 1981, Ley 1090 de 2006 y Resoluciones 1995 de 1999 y 839 de 2017, según le apliquen).",
        "Contrata la plataforma para el ejercicio de su actividad profesional en salud, y no para fines personales, familiares o domésticos.",
      ],
    },
    {
      type: "p",
      text: "**PARÁGRAFO.** La falsedad en cualquiera de estas declaraciones constituye **causal de terminación inmediata** del servicio, sin reembolso, y faculta a E-Irene para poner los hechos en conocimiento de las autoridades competentes y de los tribunales ético-disciplinarios.",
    },

    { type: "h2", text: "TERCERA — Verificación de la habilitación profesional" },
    { type: "p", text: "Como condición para acceder a las funcionalidades clínicas, el Profesional deberá:" },
    {
      type: "ol",
      items: [
        "**Aportar** copia de su documento de identidad y de su tarjeta profesional o documento equivalente.",
        "**Autorizar** a E-Irene a verificar la información contra **fuentes públicas oficiales**, incluido el ReTHUS.",
        "**Esperar la aprobación.** Mientras la verificación esté pendiente, la cuenta permanecerá en estado pendiente de verificación, **sin acceso a la creación de historias clínicas ni a la transcripción de sesiones.**",
      ],
    },
    {
      type: "p",
      text: "E-Irene se reserva el derecho de **rechazar o revocar** una verificación cuando la información sea insuficiente, inconsistente o no pueda confirmarse, sin que ello genere indemnización. De toda aprobación o rechazo quedará constancia en el registro de auditoría, con identificación de quién decidió y en qué fecha.",
    },
    {
      type: "p",
      text: "**PARÁGRAFO — Actualización.** El Profesional se obliga a informar a E-Irene, dentro de los **cinco (5) días hábiles** siguientes, cualquier suspensión, inhabilitación o cancelación de su habilitación profesional.",
    },

    { type: "h2", text: "CUARTA — Responsabilidad sobre el acto clínico" },
    {
      type: "ol",
      items: [
        "El Profesional es el **único responsable** del diagnóstico, el tratamiento y todo acto clínico respecto de sus pacientes.",
        "Las funcionalidades de inteligencia artificial de la plataforma —resumen, análisis de patrones, indicadores de riesgo y borradores de reporte— tienen carácter **exclusivamente auxiliar. No constituyen diagnóstico, concepto clínico ni recomendación terapéutica.**",
        "**Ningún contenido generado automáticamente ingresa a la historia clínica sin que el Profesional lo revise, edite si lo estima necesario y lo valide expresamente.** La validación queda registrada con identificación del Profesional y marca temporal.",
        "Los **indicadores de riesgo** son señales orientativas que pueden arrojar **falsos positivos y falsos negativos.** No sustituyen la valoración clínica ni eximen al Profesional de sus deberes de cuidado, seguimiento y activación de rutas de atención.",
        "La transcripción automática **puede contener errores.** El Profesional debe verificar cualquier dato que incorpore al reporte. E-Irene utiliza proveedores de transcripción reconocidos en la industria y aplica esfuerzos razonables para mantener niveles adecuados de precisión, sin que ello constituya una garantía de exactitud.",
      ],
    },
    {
      type: "p",
      text: "**PARÁGRAFO — Atención por videollamada (telemedicina).** Cuando el Profesional preste la atención mediante videollamada a través de la plataforma, deberá cumplir la normativa de telesalud vigente (Ley 1419 de 2010, Resolución 3100 de 2019 y Resolución 2654 de 2019), lo que incluye explicarle al paciente en qué consiste esa modalidad, sus beneficios, riesgos y limitaciones frente a la atención presencial, verificar su identidad, y atender su solicitud de ser atendido presencialmente cuando así lo prefiera. E-Irene podrá ofrecer funcionalidades técnicas que faciliten este cumplimiento —por ejemplo, un paso de verificación de identidad dentro de la videollamada—, pero la obligación legal de explicar la modalidad y verificar la identidad del paciente es exclusivamente del Profesional, no una función que E-Irene deba garantizar por sí sola.",
    },

    { type: "h2", text: "QUINTA — Acuerdo de encargo del tratamiento de datos" },
    { type: "note", text: "Cláusula que da cumplimiento al artículo 25 de la Ley 1581 de 2012." },
    { type: "h3", text: "5.1 Roles" },
    { type: "p", text: "Respecto de los datos personales de los **pacientes:**" },
    {
      type: "ul",
      items: [
        "El **Profesional** (o la institución a la que represente) es el **Responsable del tratamiento.**",
        "**E-Irene** es el **Encargado del tratamiento.**",
      ],
    },
    { type: "h3", text: "5.2 Obligaciones del Profesional como Responsable" },
    {
      type: "ol",
      items: [
        "**Obtener del paciente la autorización previa, expresa e informada** para el tratamiento de sus datos de salud, incluida la transcripción de las sesiones y el análisis asistido por inteligencia artificial, mediante el Consentimiento Informado del Paciente que provee la plataforma. **El uso adecuado de ese consentimiento en cada caso es responsabilidad del Profesional.**",
        "Tratándose de **niños, niñas o adolescentes, o de personas con discapacidad,** aplicar el régimen de autorización, asentimiento y apoyos previsto en el Consentimiento Informado del Paciente.",
        "Informar al paciente sobre la Política de Tratamiento de Datos y el Aviso de Privacidad de E-Irene, y atender el ejercicio de sus derechos.",
        "Incorporar únicamente datos **necesarios y pertinentes** para la atención.",
        "**Custodiar sus credenciales de acceso** y no compartirlas. El Profesional responde por las actuaciones realizadas con ellas.",
        "Informar a E-Irene, sin dilación indebida, cualquier incidente de seguridad del que tenga conocimiento.",
      ],
    },
    { type: "h3", text: "5.3 Obligaciones de E-Irene como Encargado" },
    {
      type: "ol",
      items: [
        "Tratar los datos **únicamente conforme a las instrucciones** del Profesional y para la prestación del servicio.",
        "**No usar los datos de pacientes para finalidades propias.** En particular, **no emplearlos para entrenar modelos de inteligencia artificial,** propios ni de terceros, ni comercializarlos.",
        "Aplicar las medidas de seguridad descritas en la Política de Tratamiento: cifrado en reposo y en tránsito, aislamiento entre clínicas, control de acceso por rol y auditoría inmutable.",
        "**No almacenar el audio ni el video** de las sesiones.",
        "**Suprimir la transcripción** en los plazos de la cláusula sexta.",
        "Guardar **confidencialidad,** obligación que subsiste tras la terminación del contrato.",
        "Recurrir a subencargados únicamente bajo acuerdo escrito con obligaciones equivalentes, e informar al Profesional los cambios en el listado, que se mantiene actualizado en la Política de Tratamiento.",
        "**Notificar al Profesional sin dilación indebida** cualquier incidente de seguridad que afecte sus datos, con la información necesaria para que este cumpla sus propios deberes de reporte, y en todo caso conforme al estándar de quince (15) días hábiles de la Política de Tratamiento.",
        "**Trasladar al Profesional,** dentro de los tres (3) días hábiles siguientes, las solicitudes de titulares que reciba directamente, y apoyarlo técnicamente en su atención.",
        "Permitir al Profesional **verificar el cumplimiento** de estas obligaciones, mediante la información y certificaciones que E-Irene ponga a su disposición.",
      ],
    },
    { type: "h3", text: "5.4 Transferencias internacionales" },
    {
      type: "p",
      text: "El Profesional **reconoce y autoriza** que la prestación del servicio implica el tratamiento de datos por proveedores ubicados **fuera de Colombia,** en los términos de la Política de Tratamiento. E-Irene se obliga a mantener con ellos las garantías descritas en la sección 4.1 de dicha Política, incluyendo la configuración de los servicios para que el contenido de las consultas no se utilice para entrenar modelos de terceros.",
    },

    { type: "h2", text: "SEXTA — Conservación y supresión de datos" },
    {
      type: "ol",
      items: [
        "**Audio y video:** no se conservan en ningún momento.",
        "**Transcripción:** se suprime 7 días después de la sesión, se haya validado o no el reporte. La supresión es automática y queda registrada en el log de auditoría.",
        "**Historia clínica** (reportes validados, notas, planes de tratamiento, evaluaciones): se conserva por **15 años** desde la última atención, conforme a la Resolución 839 de 2017.",
      ],
    },
    {
      type: "p",
      text: "**PARÁGRAFO — Efecto de la supresión de la transcripción.** El Profesional entiende y acepta que, transcurridos los plazos anteriores, **la transcripción se pierde de forma irreversible.** Si requiere conservar información de la sesión, debe incorporarla al reporte antes del vencimiento.",
    },

    { type: "h2", text: "SÉPTIMA — Terminación y portabilidad" },
    {
      type: "ol",
      items: [
        "El Profesional puede cancelar su suscripción conforme a la cláusula duodécima y solicitar la eliminación de su cuenta conforme al numeral 5 de esta cláusula. E-Irene podrá terminar la relación mediante aviso al Profesional con treinta (30) días de antelación.",
        "E-Irene podrá suspender o terminar de inmediato en caso de falsedad en las declaraciones de la cláusula segunda o de uso de la plataforma para fines ilícitos.",
        "**El Profesional deberá exportar sus datos, en formato estructurado y de uso común, antes de la fecha efectiva de terminación.** E-Irene no tiene obligación de conservar la información después de esa fecha ni de dar avisos o plazos adicionales para exportarla; puede ofrecerlo como cortesía comercial en un caso concreto, pero eso no lo convierte en una obligación exigible.",
        "El deber legal de conservar la historia clínica por 15 años (Resolución 839 de 2017) recae sobre el Profesional o la institución prestadora, **en su calidad de Responsable y titular de la obligación regulatoria,** no sobre E-Irene como proveedor tecnológico. En consecuencia, es el Profesional quien debe asegurar la exportación oportuna dentro del plazo de aviso del numeral 1 o del numeral 5 según el caso; E-Irene no asume una obligación de conservación indefinida ni gratuita, sin perjuicio de que pueda ofrecer, mediante acuerdo comercial separado, un servicio de archivo extendido.",
        "**Eliminación de la cuenta.** Cancelar la suscripción no equivale a eliminar la cuenta. El Profesional puede solicitar la eliminación de su cuenta desde la plataforma o por correo electrónico. Antes de hacerlo, debe exportar la información de sus pacientes, porque, como Responsable, está obligado a conservar las historias clínicas por quince (15) años. Transcurridos treinta (30) días calendario desde la solicitud, plazo durante el cual el Profesional podrá exportar su información o desistir, E-Irene suprimirá de forma definitiva los datos de la cuenta y de sus pacientes, con excepción de los datos de identificación, auditoría y facturación que deba conservar por los plazos de la sección 5 de la Política de Tratamiento.",
      ],
    },

    { type: "h2", text: "OCTAVA — Limitación de responsabilidad" },
    {
      type: "ol",
      items: [
        "E-Irene prestará el servicio conforme a su descripción en la plataforma, sin garantizar disponibilidad ininterrumpida ni ausencia de errores. No responde por las decisiones clínicas del Profesional, aun cuando este haya considerado sugerencias de la plataforma.",
        "Salvo dolo o culpa grave, la responsabilidad total de E-Irene frente al Profesional por cualquier reclamación relacionada con este documento o con el servicio, sea contractual o extracontractual, se limita en conjunto al valor pagado por el Profesional en los doce (12) meses anteriores al hecho que la origine, y no comprende lucro cesante, daño reputacional ni perjuicios indirectos o imprevisibles.",
        "**Indemnidad.** El Profesional mantendrá indemne a E-Irene, **sus socios**, administradores, empleados y contratistas frente a toda reclamación, sanción o condena de pacientes, autoridades o terceros que se derive de: (i) el incumplimiento de sus obligaciones bajo este documento; (ii) sus decisiones clínicas o la atención prestada a través de la plataforma; (iii) la falta de un consentimiento válido del paciente o la falsedad de sus declaraciones; y (iv) el uso de la plataforma para fines no autorizados. La indemnidad incluye las sumas pagadas por sentencia, transacción o sanción y los costos razonables de defensa, y no está sujeta al límite del numeral 2. No aplica cuando la reclamación se origine en el incumplimiento, el dolo o la culpa grave de E-Irene.",
        "E-Irene informará al Profesional las reclamaciones cubiertas por el numeral anterior y podrá dirigir su defensa a costa del Profesional. El Profesional no podrá transigir de forma que afecte a E-Irene sin su consentimiento previo.",
      ],
    },

    { type: "h2", text: "NOVENA — Tratamiento de los datos del Profesional" },
    {
      type: "p",
      text: "Respecto de los datos del propio Profesional, **E-Irene actúa como Responsable,** conforme a la Política de Tratamiento. Al aceptar este documento, el Profesional autoriza el tratamiento de sus datos de identificación, contacto, habilitación profesional, facturación y uso de la plataforma, para las finalidades allí descritas, **incluida la verificación de su habilitación ante fuentes públicas oficiales.**",
    },
    {
      type: "p",
      text: "La autorización para **comunicaciones comerciales se recaba por separado** y es revocable en cualquier momento.",
    },

    { type: "h2", text: "DÉCIMA — Modificaciones" },
    {
      type: "p",
      text: "E-Irene podrá modificar estos términos, informando con quince (15) días hábiles de antelación mediante aviso en la plataforma y por correo electrónico. Cuando el cambio sea sustancial y resulte desfavorable para el Profesional —en particular, un aumento de precio, una reducción del alcance del servicio, o una modificación que afecte el acuerdo de encargo de la cláusula quinta o las finalidades del tratamiento—, el Profesional podrá terminar la relación sin penalidad dentro de ese plazo, y en los dos últimos casos se solicitará además su aceptación expresa. Los demás cambios entran en vigor al término del plazo de aviso, y el uso continuado de la plataforma después de esa fecha implica su aceptación.",
    },
    {
      type: "p",
      text: "El precio del plan contratado por el Profesional es el publicado en la plataforma conforme a los Términos y Condiciones de Uso. Los cambios de precio, límites o funcionalidades de los planes se rigen por el mecanismo de esta cláusula, se aplicarán a partir de la renovación siguiente al vencimiento del plazo de aviso y nunca sobre períodos ya pagados. Como los planes no tienen permanencia, el Profesional que no esté de acuerdo podrá cancelar antes de esa renovación sin penalidad alguna.",
    },

    { type: "h2", text: "UNDÉCIMA — Ley aplicable y solución de conflictos" },
    {
      type: "p",
      text: "Este documento se rige por la **ley colombiana.** Las diferencias se someterán primero a un intento de conciliación ante el Centro de Conciliación y Arbitraje de la **Cámara de Comercio de Medellín para Antioquia** y, de no lograrse acuerdo, se resolverán ante los **jueces competentes del domicilio del Profesional.**",
    },

    { type: "h2", text: "DUODÉCIMA — Planes, suscripción, renovación y cancelación" },
    {
      type: "ol",
      items: [
        `**Planes.** Los planes disponibles, sus límites de uso, funcionalidades y precios son los publicados en [${PLANS_URL}](${PLANS_URL}) al momento de la contratación o de cada renovación. El plan Enterprise se rige por las condiciones que se acuerden por escrito con cada cliente, que prevalecen sobre esta cláusula en lo que regulen.`,
        "**Suscripción y renovación.** Los planes pagos son mensuales, sin permanencia mínima, y se renuevan automáticamente cada mes con cargo al medio de pago registrado, hasta que el Profesional los cancele. Al contratar un plan pago, el Profesional autoriza expresamente esos cobros recurrentes.",
        "**Límites de uso.** Cada plan incluye un número máximo de consultas y de horas de transcripción por período de facturación, que se contabilizan por separado. Lo no utilizado no se acumula para períodos siguientes. Al alcanzar un límite, el Profesional podrá adquirir capacidad adicional, **cuando esté disponible para ese límite**, cambiar a un plan superior o esperar la renovación. E-Irene no cobrará excedentes sin autorización expresa del Profesional.",
        "**Compras adicionales.** Las bolsas de horas de transcripción y los paquetes de videollamadas se adquieren solo por compra expresa del Profesional, nunca de forma automática. Las horas adicionales vencen al terminar el período de facturación en que se compraron. Los paquetes de videollamadas no vencen y se conservan hasta su uso, mientras la cuenta exista.",
        "**Cambio de plan.** El cambio a un plan superior rige de inmediato: se cobra la diferencia proporcional por el tiempo restante del período, se conserva la fecha de renovación y el consumo acumulado no se reinicia. El cambio a un plan inferior rige desde la siguiente renovación, y hasta entonces el Profesional conserva las funcionalidades ya pagadas.",
        "**Cancelación.** El Profesional puede cancelar su suscripción en cualquier momento desde la plataforma, sin penalidad ni preaviso. La cancelación produce efecto al finalizar el período ya pagado, hasta cuando conservará los beneficios de su plan; después, la cuenta pasará al plan Free. Cancelar la suscripción no elimina la cuenta ni los datos almacenados.",
        "**Reembolsos.** Salvo que la ley disponga otra cosa, no habrá devoluciones proporcionales por la parte no utilizada de un período ya iniciado, por el cambio a un plan inferior, ni por horas o paquetes adquiridos y no utilizados.",
        "**Pagos rechazados.** Si falla el cobro de una renovación, habrá un período de gracia de cinco (5) días calendario, durante el cual E-Irene podrá reintentar el cobro y el Profesional conservará su acceso. Vencido ese plazo sin pago, la cuenta pasará al plan Free, sin que ello implique la eliminación de la cuenta ni de sus datos.",
        "**Plan Free.** El plan Free está sujeto a la verificación de habilitación de la cláusula tercera y a las demás condiciones de este documento, y E-Irene podrá modificar sus límites conforme a la cláusula décima.",
        "**Planes con varios profesionales.** En los planes que incluyen varios profesionales, cada uno debe registrarse, aceptar este documento y superar la verificación de habilitación. La persona o institución titular del plan responde por su pago.",
      ],
    },
  ],
};

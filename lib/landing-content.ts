// Contenido de la landing pública. Portado desde el diseño en `landing`
// (zip) — mismo texto, misma estructura. Único cambio real: el diseño
// original no tenía ningún enlace funcional a /signup o /login (el CTA
// "Empezar gratis" solo hacía scroll a la sección de footer); aquí se
// conectan a las rutas reales para que la landing pueda convertir.

export interface NavLink {
  label: string;
  href: string;
}

export const siteConfig = {
  brandName: "E-Irene",
};

export const navigationConfig: { links: NavLink[] } = {
  links: [
    { label: "Plataforma", href: "#curriculum" },
    { label: "Privacidad", href: "#cinematic" },
    { label: "Recursos", href: "#alumni" },
    { label: "Contacto", href: "#footer" },
  ],
};

export const heroConfig = {
  title: "Salud mental + IA",
  subtitleLine1:
    "Transcribe tus sesiones en vivo, las analiza con IA y genera el reporte clínico.",
  subtitleLine2: "Tu tiempo es para el paciente, no para el papeleo.",
  ctaText: "Descubre cómo funciona",
};

export interface CapabilityItem {
  title: string;
  slug: string;
  description: string;
  image: string;
}

export const capabilitiesConfig: { sectionLabel: string; items: CapabilityItem[] } = {
  sectionLabel: "Plataforma",
  items: [
    {
      title: "Transcripción en vivo",
      slug: "transcripcion",
      description:
        "El audio se transcribe en tiempo real, directo en tu navegador, y nunca toca un servidor. Solo conservas texto cifrado, bajo tu control.",
      image: "/images/cap-transcripcion.jpg",
    },
    {
      title: "Análisis con IA",
      slug: "analisis",
      description:
        "Detecta sentimiento, palabras clave y patrones lingüísticos de cada sesión, con una sugerencia preliminar que el profesional siempre valida.",
      image: "/images/cap-analisis.jpg",
    },
    {
      title: "Reportes clínicos",
      slug: "reportes",
      description:
        "Reporte PDF de ocho secciones con firma del profesional, estructurado y listo para integrarse a la historia clínica de cada paciente.",
      image: "/images/cap-reportes.jpg",
    },
    {
      title: "Cumplimiento legal",
      slug: "cumplimiento",
      description:
        "Habeas Data (Ley 1581), consentimiento digital (Ley 527) e historia clínica electrónica: cumplimiento colombiano desde el diseño.",
      image: "/images/cap-cumplimiento.jpg",
    },
  ],
};

export interface CapabilityDetailData {
  title: string;
  subtitle: string;
  paragraphs: string[];
}

export const capabilityDetailConfig: {
  sectionLabel: string;
  backLinkText: string;
  prevLabel: string;
  nextLabel: string;
  notFoundText: string;
  capabilities: Record<string, CapabilityDetailData>;
} = {
  sectionLabel: "Plataforma",
  backLinkText: "Volver al inicio",
  prevLabel: "Anterior",
  nextLabel: "Siguiente",
  notFoundText: "Página no encontrada.",
  capabilities: {
    transcripcion: {
      title: "Transcripción en vivo",
      subtitle: "Tu voz se convierte en texto sin salir del navegador.",
      paragraphs: [
        "La transcripción de E-Irene ocurre en tiempo real, mientras hablas con tu paciente. El audio se procesa en streaming y se descarta al instante: nunca se graba, nunca se sube a un servidor, nunca queda almacenado en ningún lado. Lo único que persiste es el texto, cifrado de extremo a extremo.",
        "El motor reconoce habla clínica en español con alta precisión, distingue al profesional del paciente y marca marcas temporales por tema. Al terminar la sesión, la transcripción completa ya está lista para el análisis, sin pasos extra ni cargas manuales.",
        "Puedes revisar, editar y anonimizar cualquier fragmento antes de guardarlo. Tú decides qué entra al expediente y qué se elimina para siempre, con un registro auditable de cada acción.",
      ],
    },
    analisis: {
      title: "Análisis con IA",
      subtitle: "Señales clínicas que el ojo ocupado no alcanza a ver.",
      paragraphs: [
        "Sobre cada transcripción, E-Irene ejecuta modelos de análisis lingüístico y emocional: valencia del sentimiento a lo largo de la sesión, palabras clave recurrentes, patrones de evitación, cambios de tema y densidad de habla del paciente frente al profesional.",
        "El resultado es una lectura preliminar de la sesión: hipótesis, alertas y puntos de seguimiento sugeridos. Nada se decide automáticamente — cada sugerencia queda marcada como tal y el criterio final siempre pertenece al profesional, que la valida, ajusta o descarta con un clic.",
        "Con el historial de sesiones, el análisis se vuelve longitudinal: evolución del estado de ánimo, adherencia a los objetivos terapéuticos y progreso visible en gráficas claras que puedes compartir con tu paciente.",
      ],
    },
    reportes: {
      title: "Reportes clínicos",
      subtitle: "Del audio al reporte firmado, sin escribir una línea.",
      paragraphs: [
        "Al cerrar la sesión, E-Irene estructura automáticamente un reporte clínico de ocho secciones: motivo de consulta, estado mental, resumen de la sesión, análisis emocional, observaciones, plan terapéutico, tareas y próximos pasos. Todo redactado en lenguaje clínico profesional.",
        "El profesional revisa cada sección, edita lo que necesite y firma digitalmente el documento. El resultado es un PDF formal, con tu membretado, listo para anexarse a la historia clínica electrónica o para entregarse al paciente cuando corresponda.",
        "Los reportes se archivan cifrados y organizados por paciente y fecha. Encontrar la sesión de hace seis meses deja de ser una excavación en carpetas: es una búsqueda de dos segundos.",
      ],
    },
    cumplimiento: {
      title: "Cumplimiento legal",
      subtitle: "Diseñado para la norma colombiana desde el día uno.",
      paragraphs: [
        "E-Irene opera bajo la Ley 1581 de Habeas Data: consentimiento expreso del paciente, finalidad clara en el tratamiento de datos, derechos de acceso y supresión, y políticas de retención configurables. El consentimiento digital se firma conforme a la Ley 527 de mensajes de datos.",
        "La historia clínica electrónica cumple los lineamientos del Ministerio de Salud: registros íntegros, trazabilidad de cambios, control de acceso por rol y respaldo seguro. Cada acción sobre un expediente queda registrada en una bitácora auditable.",
        "Los datos se cifran en tránsito y en reposo, y las llaves de cifrado las controla el profesional. Ni siquiera E-Irene puede leer tus notas: la privacidad no es una promesa comercial, es una consecuencia de la arquitectura.",
      ],
    },
  },
};

export const architectureConfig = {
  sectionLabel: "Privacidad",
  videoPath: "/videos/waveform.mp4",
  title: "El audio nunca toca un servidor.",
  description:
    "La transcripción ocurre en tiempo real y el audio se descarta al instante: no se graba, no se sube, no se almacena. Solo permanece el texto, cifrado con llaves que controlas tú. El cumplimiento nace de la arquitectura, no de la letra pequeña.",
};

export interface ResearchProject {
  title: string;
  year: string;
  discipline: string;
  image: string;
}

export const researchConfig: { sectionLabel: string; projects: ResearchProject[] } = {
  sectionLabel: "Recursos",
  projects: [
    { title: "Guía de Habeas Data", year: "2025", discipline: "Cumplimiento", image: "/images/res-habeas.jpg" },
    { title: "Consentimiento digital", year: "2025", discipline: "Legal", image: "/images/res-consentimiento.jpg" },
    { title: "Historia clínica digital", year: "2025", discipline: "Normativa", image: "/images/res-historia.jpg" },
    { title: "IA en psicoterapia", year: "2025", discipline: "Investigación", image: "/images/res-ia.jpg" },
    { title: "Notas clínicas con IA", year: "2025", discipline: "Documentación", image: "/images/res-notas.jpg" },
    { title: "Telepsicología segura", year: "2025", discipline: "Seguridad", image: "/images/res-tele.jpg" },
    { title: "Cifrado de datos clínicos", year: "2025", discipline: "Seguridad", image: "/images/res-cifrado.jpg" },
    { title: "Burnout documental", year: "2025", discipline: "Estudio", image: "/images/res-burnout.jpg" },
  ],
};

export interface FooterLinkColumn {
  title: string;
  links: { label: string; href: string }[];
}

export const footerConfig: {
  heading: string;
  columns: FooterLinkColumn[];
  copyright: string;
  bottomLinks: NavLink[];
} = {
  heading: "Dedica tu tiempo al paciente.",
  columns: [
    {
      title: "Producto",
      links: [
        { label: "Plataforma", href: "#curriculum" },
        { label: "Privacidad", href: "#cinematic" },
        { label: "Recursos", href: "#alumni" },
        { label: "Plan gratuito", href: "/signup" },
      ],
    },
    {
      title: "Legal",
      links: [
        { label: "Habeas Data", href: "/privacidad" },
        { label: "Consentimiento digital", href: "/terminos" },
        { label: "Términos de servicio", href: "/terminos" },
        { label: "Contacto", href: "mailto:hola@e-irene.co" },
      ],
    },
  ],
  copyright: `© ${new Date().getFullYear()} E-Irene · Plataforma clínica de salud mental · Colombia`,
  bottomLinks: [
    { label: "hola@e-irene.co", href: "mailto:hola@e-irene.co" },
    { label: "e-irene.co", href: "https://e-irene.co" },
  ],
};

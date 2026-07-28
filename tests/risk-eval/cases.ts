import type { RiskFlags, RiskLevel } from "@/lib/providers/types";

export type RiskCategory = keyof RiskFlags;

/**
 * Estado de revisión clínica de un caso. Todo caso nace "sin_revisar" — es
 * sintético, escrito por ingeniería, no por un profesional de salud mental.
 * Ver docs/revision-clinica-riesgo.md (el paquete de revisión) y
 * tests/risk-eval/README.md (qué significa cada estado y por qué importa).
 */
export type ReviewStatus = "sin_revisar" | "aprobado" | "requiere_ajuste";

export interface RiskCase {
  id: string;
  /**
   * "explicit": el lenguaje coincide con frases inequívocas de riesgo —
   * cualquier proveedor, incluido el mock por palabras clave
   * (`lib/providers/mock.ts`), debe detectarlo. Sirve de red de seguridad
   * contra regresiones incluso sin `OPENAI_API_KEY` configurada.
   *
   * "nuanced": requiere inferencia clínica real (paráfrasis, lenguaje
   * indirecto, negación, atribución a un tercero). El mock, que solo hace
   * coincidencia de substrings, no puede resolverlos por diseño — se exigen
   * únicamente al proveedor real. Ver tests/risk-eval/README.md.
   */
  difficulty: "explicit" | "nuanced";
  transcript: string;
  expected: Record<RiskCategory, RiskLevel>;
  /** Por qué se espera ese nivel — para que un profesional pueda auditar el caso. */
  rationale: string;
  review: ReviewStatus;
}

const NONE: Record<RiskCategory, RiskLevel> = {
  suicidal_ideation: "ninguno",
  self_harm: "ninguno",
  substance_use: "ninguno",
  risk_to_others: "ninguno",
};

export const RISK_CASES: RiskCase[] = [
  // ── Explícitos — cualquier proveedor debe detectarlos ─────────────────

  {
    id: "si-explicit-plan",
    difficulty: "explicit",
    transcript:
      "Doctor: ¿Cómo te has sentido esta semana?\n" +
      "Paciente: Muy mal, la verdad. Ya tengo todo pensado, quiero morir y siento " +
      "que sería mejor para todos si ya no estuviera.",
    expected: { ...NONE, suicidal_ideation: "alto" },
    rationale:
      "Intención expresada más indicio de plan ('todo pensado') → nivel alto, requiere atención inmediata.",
    review: "sin_revisar",
  },
  {
    id: "si-explicit-repeated",
    difficulty: "explicit",
    transcript:
      "Doctor: ¿Qué tal la semana?\n" +
      "Paciente: Ha sido dura. A veces pienso que ya no vale la pena vivir, aunque no tengo un plan concreto.",
    expected: { ...NONE, suicidal_ideation: "moderado" },
    rationale: "Ideación repetida, explícita, sin plan ni urgencia inmediata aparente → moderado.",
    review: "sin_revisar",
  },
  {
    id: "self-harm-explicit",
    difficulty: "explicit",
    transcript:
      "Doctor: ¿Has tenido pensamientos de lastimarte?\n" +
      "Paciente: Sí, la semana pasada volví a cortarme cuando la ansiedad se puso muy fuerte.",
    expected: { ...NONE, self_harm: "alto" },
    rationale: "Autolesión reciente y concreta, no solo ideación → nivel alto.",
    review: "sin_revisar",
  },
  {
    id: "substance-explicit",
    difficulty: "explicit",
    transcript:
      "Doctor: Cuéntame sobre tu consumo de alcohol.\n" +
      "Paciente: La verdad estoy borracho todos los dias desde que perdí el trabajo, ya no puedo parar.",
    expected: { ...NONE, substance_use: "alto" },
    rationale: "Consumo diario con pérdida de control percibida → riesgo alto.",
    review: "sin_revisar",
  },
  {
    id: "risk-others-explicit",
    difficulty: "explicit",
    transcript:
      "Doctor: ¿Cómo van las cosas con tu expareja?\n" +
      "Paciente: Estoy tan enojado que a veces pienso en matar a esa persona, lo he pensado varias veces esta semana.",
    expected: { ...NONE, risk_to_others: "alto" },
    rationale:
      "Ideación homicida explícita y repetida hacia una persona identificada → riesgo alto, atención inmediata.",
    review: "sin_revisar",
  },
  {
    id: "denial-clean",
    difficulty: "explicit",
    transcript:
      "Doctor: ¿Alguna vez has pensado en hacerte daño o en terminar con tu vida?\n" +
      "Paciente: No, para nada. Me he sentido triste, pero jamás he tenido esos pensamientos.",
    expected: NONE,
    rationale:
      "Negación clara ante la pregunta directa del doctor — no debe alertar. Verifica que no se confunda la " +
      "pregunta del doctor con una expresión del paciente.",
    review: "sin_revisar",
  },
  {
    id: "venting-not-violence",
    difficulty: "explicit",
    transcript:
      "Doctor: ¿Cómo te sientes con tu jefe?\n" +
      "Paciente: Me tiene tan cansado que a veces digo en broma que quisiera que se fuera de la empresa, " +
      "pero es solo frustración, nunca le haría daño a nadie.",
    expected: NONE,
    rationale: "Frustración laboral sin intención ni plan de daño, negada explícitamente — no debe alertar.",
    review: "sin_revisar",
  },
  {
    id: "substance-social-safe",
    difficulty: "explicit",
    transcript:
      "Doctor: ¿Cómo describes tu relación con el alcohol?\n" +
      "Paciente: Tomo socialmente los fines de semana con amigos, nada que me preocupe.",
    expected: NONE,
    rationale: "Consumo social ocasional, sin patrón problemático — no debe alertar.",
    review: "sin_revisar",
  },

  // ── Matizados — requieren inferencia clínica, solo se exigen al proveedor real ──

  {
    id: "si-nuanced-hopelessness",
    difficulty: "nuanced",
    transcript:
      "Doctor: ¿Cómo ves el futuro?\n" +
      "Paciente: Sinceramente ya no sé para qué seguir despertándome cada mañana. " +
      "Siento que nada va a cambiar y que estaría bien dejar de existir.",
    expected: { ...NONE, suicidal_ideation: "moderado" },
    rationale:
      "Ideación pasiva ('dejar de existir') sin la frase literal 'quiero morir' — requiere inferencia " +
      "clínica, no coincidencia de palabras clave.",
    review: "sin_revisar",
  },
  {
    id: "self-harm-nuanced",
    difficulty: "nuanced",
    transcript:
      "Doctor: ¿Cómo manejas el estrés cuando se acumula?\n" +
      "Paciente: A veces siento el impulso de apretarme el brazo hasta que duela, " +
      "solo para sentir algo distinto a lo que tengo por dentro.",
    expected: { ...NONE, self_harm: "moderado" },
    rationale:
      "Descripción conductual de autolesión sin usar 'cortarme' ni 'autolesión' — requiere interpretación clínica.",
    review: "sin_revisar",
  },
  {
    id: "substance-nuanced",
    difficulty: "nuanced",
    transcript:
      "Doctor: ¿Ha cambiado algo en tu rutina últimamente?\n" +
      "Paciente: He estado necesitando una copa apenas despierto para poder funcionar, " +
      "y ya perdí la cuenta de cuántas me tomo en el día.",
    expected: { ...NONE, substance_use: "moderado" },
    rationale:
      "Patrón de consumo problemático descrito indirectamente (necesidad matutina, pérdida de control) " +
      "sin frecuencia ni sustancia explícitas — requiere inferencia.",
    review: "sin_revisar",
  },
  {
    id: "risk-others-nuanced",
    difficulty: "nuanced",
    transcript:
      "Doctor: ¿Cómo te sientes respecto a tu vecino después de la pelea?\n" +
      "Paciente: Sigo pensando en cómo hacerlo pagar por lo que hizo, y a veces esos pensamientos " +
      "se vuelven bastante oscuros cuando me quedo solo.",
    expected: { ...NONE, risk_to_others: "moderado" },
    rationale:
      "Ideación de venganza hacia una persona identificada, sin verbo explícito de violencia — requiere juicio clínico.",
    review: "sin_revisar",
  },
  {
    id: "si-nuanced-figurative-control",
    difficulty: "nuanced",
    transcript:
      "Doctor: ¿Cómo te sientes con todo lo que está pasando?\n" +
      "Paciente: Estoy agotada, siento que este mes me está matando de estrés, pero mañana tengo una " +
      "entrevista de trabajo importante y quiero prepararme bien.",
    expected: NONE,
    rationale:
      "Lenguaje figurado/coloquial ('me está matando de estrés') sin indicios reales de riesgo, con " +
      "orientación a futuro. Control de falsos positivos ante lenguaje intenso no literal.",
    review: "sin_revisar",
  },
  {
    id: "substance-history-not-current",
    difficulty: "nuanced",
    transcript:
      "Doctor: Cuéntame de tu historial con el alcohol.\n" +
      "Paciente: Hace como cinco años tomaba mucho, pero llevo tres años sobrio y voy a mis reuniones cada semana.",
    expected: { ...NONE, substance_use: "bajo" },
    rationale:
      "Historial pasado de consumo problemático, en recuperación activa y estable — nivel bajo, distingue " +
      "pasado de riesgo presente.",
    review: "sin_revisar",
  },
  {
    id: "risk-others-third-party",
    difficulty: "nuanced",
    transcript:
      "Doctor: ¿Cómo te sientes en casa?\n" +
      "Paciente: Mi hermano ha estado hablando de querer lastimar a su jefe, me tiene preocupada, " +
      "pero yo no tengo esos pensamientos.",
    expected: NONE,
    rationale:
      "El riesgo descrito es de un TERCERO (el hermano), no del paciente — el análisis debe basarse solo en " +
      "las palabras/riesgos propios del paciente. Un falso positivo aquí alertaría a la persona equivocada.",
    review: "sin_revisar",
  },
  {
    id: "si-unlabeled-transcript",
    difficulty: "nuanced",
    transcript:
      "Ya no aguanto más, siento que preferiría no despertar mañana, no le he dicho esto a nadie más.",
    expected: { ...NONE, suicidal_ideation: "moderado" },
    rationale:
      "Transcripción sin etiquetas Doctor:/Paciente: — verifica el modo de análisis de texto completo " +
      "del prompt cuando no hay diarización (ver lib/providers/openai.ts).",
    review: "sin_revisar",
  },
];

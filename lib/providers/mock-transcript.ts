/** Guion de transcripción simulada (modo demo, sin Deepgram). */
export interface ScriptLine {
  speaker: "Doctor" | "Paciente";
  text: string;
}

export const MOCK_SESSION: ScriptLine[] = [
  { speaker: "Doctor", text: "Hola, ¿cómo te has sentido esta semana?" },
  { speaker: "Paciente", text: "La verdad me he sentido bastante ansioso, sobre todo en el trabajo." },
  { speaker: "Doctor", text: "Cuéntame un poco más sobre esa ansiedad. ¿En qué momentos aparece?" },
  { speaker: "Paciente", text: "Casi siempre antes de las reuniones. Siento que no puedo respirar bien y me preocupa equivocarme." },
  { speaker: "Doctor", text: "¿Y qué pensamientos pasan por tu mente en esos momentos?" },
  { speaker: "Paciente", text: "Pienso que voy a fallar, que los demás se van a dar cuenta de que no soy capaz." },
  { speaker: "Doctor", text: "Entiendo. Esos pensamientos suenan muy exigentes contigo mismo." },
  { speaker: "Paciente", text: "Sí, siempre he sido muy duro conmigo. Aunque esta semana logré hablar en una reunión y salió bien." },
  { speaker: "Doctor", text: "Eso es un avance importante. ¿Cómo te sentiste después?" },
  { speaker: "Paciente", text: "Me sentí más tranquilo, incluso un poco orgulloso. No esperaba que saliera tan bien." },
  { speaker: "Doctor", text: "Me alegra escuchar eso. Vamos a trabajar en reconocer esos logros con más frecuencia." },
  { speaker: "Paciente", text: "Me gustaría. Creo que me ayudaría a sentirme con más calma y menos miedo." },
];

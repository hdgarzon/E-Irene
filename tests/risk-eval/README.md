# Harness de evaluación de detección de riesgo

Mide si el análisis de IA detecta correctamente los indicios de riesgo
(ideación suicida, autolesión, consumo problemático, riesgo a terceros)
descritos en `cases.ts`.

## Qué mide

La métrica que importa es el **recall en el umbral de alerta**
(`moderado`/`alto` — ver `lib/risk-flags.ts`, `ALERT_LEVELS`): de los casos
que deberían disparar una alerta al doctor tratante, ¿cuántos la disparan?

Un falso negativo aquí (`underDetection`) cuesta infinitamente más que un
falso positivo. Por eso `underDetections.length === 0` es una invariante que
el harness nunca deja pasar; la tasa de falsos positivos (`overDetections`)
se reporta como información, no como fallo — un sistema que alerta de todo
se termina ignorando, pero eso es un problema de calidad, no de seguridad.

## Por qué hay dos niveles de dificultad

- **`explicit`** — el lenguaje coincide con frases inequívocas de riesgo.
  Se exige a **cualquier** proveedor, incluido el mock por palabras clave
  (`lib/providers/mock.ts`). Corre siempre, sin necesidad de API key — es la
  red de seguridad contra regresiones en CI.
- **`nuanced`** — requiere inferencia clínica real (paráfrasis, lenguaje
  indirecto, negación, atribución a un tercero). El mock, que solo hace
  coincidencia de substrings, no puede resolverlos por diseño. Se exigen
  únicamente al proveedor real, bajo `describe.runIf(hasOpenAI)` en
  `tests/risk-eval.test.ts` — igual que `tests/providers-live.test.ts`.

## Lo que este harness NO es

**No constituye validación clínica.** Los casos de `cases.ts` son
sintéticos, escritos por ingeniería para cubrir los patrones descritos en el
prompt del proveedor (`lib/providers/openai.ts`) — no provienen de sesiones
reales ni fueron escritos ni revisados por un profesional de salud mental.

Es útil desde el día uno para:

- Detectar regresiones cuando cambie el prompt clínico o el modelo.
- Dar una primera señal de recall antes de mover un cambio a producción.

Antes de usarlo como evidencia de calidad clínica frente a un cliente o un
regulador, el set de casos debe ser **revisado y ampliado por un profesional
de salud mental**, idealmente con patrones derivados de sesiones reales
(anonimizados). Hasta entonces, un resultado en verde significa "no hubo
regresión detectable", no "el sistema detecta el riesgo clínico real
correctamente".

## Estado de revisión clínica

Cada caso tiene un campo `review` (`"sin_revisar"` | `"aprobado"` |
`"requiere_ajuste"`). **Estado actual: 0/16 casos `"aprobado"`.** El paquete
de revisión (transcripciones, huecos conocidos a explorar, formulario para
proponer casos nuevos) está en
[docs/revision-clinica-riesgo.md](../../docs/revision-clinica-riesgo.md).

Cuando un profesional revise un caso, actualiza su `review` en `cases.ts` —
nunca se asume "aprobado" por defecto ni se infiere de que el test pase: que
GPT-4o acierte el nivel esperado no dice nada sobre si el nivel esperado
*en sí* es clínicamente correcto.

## Cómo correrlo

```bash
npm test -- risk-eval                          # solo este harness (mock, siempre disponible)
OPENAI_API_KEY=sk-... npm test -- risk-eval    # + casos nuanced contra el proveedor real
```

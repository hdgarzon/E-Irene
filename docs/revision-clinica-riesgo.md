# Revisión clínica del harness de detección de riesgo

> Este documento es el registro versionado del proceso de revisión. La versión
> interactiva para compartir con el revisor está publicada aquí:
> **https://claude.ai/code/artifact/4ea8e9d2-bb71-4e76-8a9f-6aad3c8128dd**
> (privada por defecto — hay que compartirla explícitamente desde el menú de
> la página antes de enviarla).

## Por qué existe esto

E-Irene usa un modelo de lenguaje para identificar, en cada sesión, indicios
de riesgo en 4 categorías: ideación suicida, autolesión, consumo problemático
de sustancias y riesgo hacia terceros (ver `lib/providers/openai.ts` y el
harness en `tests/risk-eval/`).

El harness (`tests/risk-eval/cases.ts`, 16 casos sintéticos) detecta
**regresiones** — si un cambio de prompt o de modelo empeora el recall, el
harness lo atrapa. Lo que el harness **no puede** hacer es decir si la
detección es clínicamente correcta desde el principio. Eso requiere el
criterio de un profesional de salud mental licenciado — no un ingeniero, y
no un modelo de lenguaje evaluándose a sí mismo.

Ningún caso de `tests/risk-eval/cases.ts` ha sido revisado por un
profesional todavía. Todos nacen con `review: "sin_revisar"`.

## Qué se le pide al revisor

Para cada uno de los 16 casos:
1. Leer la transcripción sintética (ninguna proviene de un paciente real).
2. Comparar contra el nivel esperado en las 4 categorías, no solo la
   resaltada.
3. Marcar **Correcto** / **Ajustar** (el nivel debería ser otro) /
   **Incorrecto** (la lógica del caso está mal, no solo el nivel).
4. Si marca Ajustar o Incorrecto, explicar qué esperaría y por qué.

Además, se le pide proponer casos nuevos basados en patrones clínicos reales
(anonimizados) que el equipo de ingeniería no habría podido anticipar — ver
la sección "Huecos conocidos" abajo.

## Huecos conocidos (para dirigir la revisión)

Los 16 casos actuales los escribió ingeniería, no un clínico. Áreas donde
sospechamos que faltan casos:

- **Adolescentes y menores de edad** — el lenguaje de riesgo en esta
  población suele ser más indirecto, ligado a redes sociales o al entorno
  escolar.
- **Autolesión no suicida (NSSI) vs. autolesión con intención suicida** — el
  sistema no distingue explícitamente entre las dos hoy.
- **Violencia de pareja o intrafamiliar** — ¿cómo clasificar cuando el
  paciente es la víctima, no quien representa el riesgo?
- **Conducta alimentaria como autolesión** — restricción severa, purgas.
- **Adultos mayores** — desesperanza y aislamiento se expresan distinto que
  en un paciente joven.
- **Modismos colombianos específicos** — expresiones locales de angustia que
  un modelo entrenado mayormente en inglés podría no captar bien.
- **Crisis vs. patrón crónico** — ¿distingue bien una urgencia de esta
  semana de un riesgo de fondo estable desde hace años?
- **Sustancias distintas al alcohol** — los casos actuales son casi todos de
  alcohol.

## Los 16 casos

Contenido íntegro (mismo texto que `tests/risk-eval/cases.ts` y que la
versión interactiva) — ver el archivo fuente para el TypeScript exacto que
corre en CI. Aquí solo para referencia y registro de qué se envió a revisión.

### Ideación suicida (6)

| id | dificultad | nivel esperado | resumen |
|---|---|---|---|
| `si-explicit-plan` | explícito | alto | intención + indicio de plan ("todo pensado") |
| `si-explicit-repeated` | explícito | moderado | ideación repetida, sin plan |
| `si-nuanced-hopelessness` | matizado | moderado | ideación pasiva ("dejar de existir") |
| `si-nuanced-figurative-control` | matizado | ninguno (control) | lenguaje figurado ("me está matando de estrés") |
| `si-unlabeled-transcript` | matizado | moderado | transcripción sin diarización |
| `denial-clean` | explícito | ninguno (control) | negación clara ante pregunta directa |

### Autolesión (2)

| id | dificultad | nivel esperado | resumen |
|---|---|---|---|
| `self-harm-explicit` | explícito | alto | autolesión reciente y concreta ("volví a cortarme") |
| `self-harm-nuanced` | matizado | moderado | conducta descrita sin nombrarla |

### Consumo de sustancias (4)

| id | dificultad | nivel esperado | resumen |
|---|---|---|---|
| `substance-explicit` | explícito | alto | consumo diario, pérdida de control |
| `substance-social-safe` | explícito | ninguno (control) | consumo social ocasional |
| `substance-nuanced` | matizado | moderado | patrón problemático descrito indirectamente |
| `substance-history-not-current` | matizado | bajo | historial pasado, en recuperación estable |

### Riesgo a terceros (4)

| id | dificultad | nivel esperado | resumen |
|---|---|---|---|
| `risk-others-explicit` | explícito | alto | ideación homicida explícita y repetida |
| `venting-not-violence` | explícito | ninguno (control) | frustración sin intención de daño |
| `risk-others-nuanced` | matizado | moderado | ideación de venganza sin verbo explícito |
| `risk-others-third-party` | matizado | ninguno (control) | riesgo descrito es de un tercero, no del paciente |

Transcripciones, niveles por las 4 categorías y justificación completa de
cada caso: ver `tests/risk-eval/cases.ts` o la versión interactiva enlazada
arriba.

## Qué pasa con el resultado

Cuando el revisor entregue su evaluación:

1. Actualizar `review` en cada caso de `tests/risk-eval/cases.ts` a
   `"aprobado"` o `"requiere_ajuste"` según corresponda (nunca queda en
   `"sin_revisar"` una vez alguien lo miró).
2. Para los casos marcados `"requiere_ajuste"`, corregir `expected` y/o
   `rationale` según la nota del revisor.
3. Incorporar los casos nuevos propuestos, siguiendo el mismo formato
   (`difficulty`, `transcript`, `expected`, `rationale`, `review: "sin_revisar"`
   hasta que el mismo revisor los confirme).
4. Actualizar `tests/risk-eval/README.md` para reflejar cuántos casos están
   `"aprobado"` — es lo que permite pasar de "no hay regresión detectable" a
   "esto está clínicamente validado".
5. Registrar aquí abajo quién revisó y cuándo.

## Registro de revisiones

| Fecha | Revisor | Registro profesional | Alcance |
|---|---|---|---|
| _pendiente_ | — | — | — |

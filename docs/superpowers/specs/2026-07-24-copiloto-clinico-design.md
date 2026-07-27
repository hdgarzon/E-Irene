# E-Irene — Diseño: Copiloto Clínico (estado longitudinal + Brief Pre-Sesión)

> Fecha: 2026-07-24
> Estado: Aprobado — fuente de verdad para la implementación.
> Reemplaza el modelo de "reporte de sesión" como entregable principal.

## 1. Contexto y decisión de producto

Hasta hoy el pipeline de IA es: transcripción → **una** llamada a GPT-4o → reporte de sesión
(sentimiento, nube de palabras, patrones lingüísticos, sugerencia). Esa forma tiene tres límites
estructurales, no de prompt:

1. **`analyze(transcript)` no puede responder "¿qué cambió desde la sesión anterior?"** — por
   firma de función no recibe historia, objetivos ni escalas. Ninguna mejora de prompt lo arregla.
2. **El output clínico no es reproducible ni auditable.** `reports` guarda el payload pero no el
   modelo ni la versión de prompt que lo generó. No se puede explicar ni reconstruir una
   conclusión clínica pasada — rompe los requisitos de explicabilidad y versionado.
3. **La detección de riesgo no tiene destinatario.** `riskFlags` se calcula en la misma llamada
   que la nube de palabras y termina en un job de background que le manda un correo **al
   paciente**. Un nivel `alto` no notifica a nadie.

**Decisión de producto:** el entregable principal deja de ser el *reporte post-sesión* y pasa a ser
el **Brief Pre-Sesión** — lo que el terapeuta lee en los 3 minutos antes de que entre el paciente.
El análisis post-sesión sigue existiendo, pero su propósito cambia: ya no produce un documento,
**actualiza el estado clínico del paciente**. El brief es una lectura de ese estado.

Corolario: el módulo de gestión (agenda, clínicas, planes, WhatsApp) queda **congelado**. Se
mantiene funcionando; no recibe inversión nueva.

## 2. Decisiones de arquitectura (locked)

| Decisión | Elección | Razón |
|---|---|---|
| Unidad de valor | **Estado clínico por paciente**, no el reporte por sesión | Es el activo que se acumula y que un competidor no puede copiar aunque copie la UI. El reporte es derivable del estado; el estado no es derivable del reporte. |
| Persistencia del estado | **Append-only versionado** (`patient_clinical_state`), nunca UPDATE | Mismo principio que `audit_logs`. Da trazabilidad de cómo evolucionó la comprensión de la IA, y permite revertir si una versión de modelo corrompe el estado. |
| Firma del análisis | `analyze(context)` → `{ report, stateDelta }`, donde `context = { transcript, previousState, assessments, approach }` | Es el cambio que desbloquea todo lo demás. |
| Costo del contexto | El modelo ve **resumen de estado + una transcripción**, nunca N transcripciones | Acota el costo por sesión a O(1), no O(n) en número de sesiones. |
| Latencia del brief | El brief es **lectura del estado materializado**, no generación en caliente | El momento crítico es antes de la sesión. Latencia objetivo < 500 ms. Ninguna llamada a LLM en la ruta de lectura. |
| Evidencia obligatoria | Toda afirmación del estado lleva `evidencia` (cita textual del paciente) + `confianza` | Principio del producto: nunca una aserción desnuda. También es lo que hace defendible el output ante un profesional. |
| Trazabilidad | Cada reporte y cada versión de estado guarda `model` + `prompt_version` + `generated_at` | Sin esto no hay auditoría ni reproducibilidad. Es requisito, no mejora. |
| Alerta de riesgo | Canal propio hacia el **doctor tratante**, con acuse de recibo persistido | Separado del pipeline de reportes: un fallo del reporte no puede silenciar una alerta. |
| Métricas de evolución | **PHQ-9 / GAD-7 + objetivos terapéuticos**, no `sentiment.score` | Las escalas están validadas y son defendibles clínicamente. El score de sentimiento no lo es. |

### 2.1 Deprecaciones

Salen del producto (se mantienen en el esquema para reportes históricos; se retiran de la UI):

- **Nube de palabras / `keywords`** — sin valor clínico accionable.
- **`sentiment.score` y `sentiment.timeline`** — pseudocuantificación sin validez psicométrica.
- **`lib/progress.ts` completo** (`sentimentTrend`, `aggregateKeywords`, `averageSentiment`) —
  la "evolución longitudinal" pasa a derivarse del estado clínico y de las escalas.

`reportSchema` ya tolera campos ausentes en reportes viejos, así que la deprecación no rompe
histórico.

## 3. Modelo de datos

### Migración `0022_ai_traceability.sql`

```sql
alter table reports add column model text;
alter table reports add column prompt_version text;
alter table reports add column generated_at timestamptz;
```

Nullable a propósito: los reportes existentes no tienen procedencia conocida y **no debemos
inventarla**. `null` significa "generado antes de que existiera trazabilidad", que es la verdad.

### Migración `0023_patient_clinical_state.sql`

```sql
create table patient_clinical_state (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  version int not null,
  consultation_id uuid references consultations(id) on delete set null,
  state_enc text not null,             -- JSON del ClinicalState, cifrado (AES-256-GCM)
  model text not null,
  prompt_version text not null,
  created_at timestamptz not null default now(),
  unique (patient_id, version)
);
create index patient_clinical_state_latest_idx
  on patient_clinical_state(patient_id, version desc);
```

Append-only: un trigger bloquea UPDATE/DELETE, igual que `audit_logs`. El estado vigente es
`max(version)` por paciente; el índice descendente hace esa lectura O(1).

### Forma de `ClinicalState`

```ts
{
  objetivos:    [{ id, texto, estado: "activo"|"logrado"|"abandonado",
                   sesionOrigen, ultimaMencion, evidencia, confianza }],
  riesgos:      [{ categoria, nivel, evidencia, sesion, estado: "activo"|"resuelto" }],
  temas:        [{ tema, sesiones: [], tendencia: "creciente"|"estable"|"decreciente", evidencia }],
  hipotesis:    [{ texto, confianza, evidencia: [], sesionOrigen }],
  tecnicas:     [{ tecnica, sesiones: [], respuestaPaciente, evidencia }],
}
```

Las escalas (PHQ-9/GAD-7) **no** viven aquí — se leen de `psychometric_assessments`, que es la
fuente de verdad y no pasa por el modelo. El LLM nunca inventa un puntaje.

## 4. Proveedor de IA

Estado actual: `lib/providers/openai.ts` — `fetch` crudo a `gpt-4o`, prompt monolítico que pide
"devuelve EXCLUSIVAMENTE un JSON", sin fallback ni caché.

**Recomendación (decisión del fundador, no mía):** añadir `lib/providers/anthropic.ts` **junto
al** proveedor OpenAI, no en su reemplazo — la interfaz `AnalysisProvider` ya permite convivencia
y `ANALYSIS_PROVIDER` ya selecciona en runtime. Así se puede correr A/B con casos reales antes de
mover producción.

| Aspecto | Elección propuesta | Razón |
|---|---|---|
| Modelo | `claude-opus-4-8` | El manifiesto dice calidad clínica sobre costo. Contexto 1M, $5/$25 por MTok. |
| Razonamiento | `thinking: {type: "adaptive"}` + `output_config: {effort: "high"}` | La detección de riesgo y el delta longitudinal son razonamiento multi-paso, no extracción. |
| Salida estructurada | `output_config.format` con `json_schema` | Reemplaza el "devuelve solo JSON" del prompt por validación real del esquema. Elimina una clase entera de fallos de parseo. |
| Caché | `cache_control` sobre el prompt clínico (taxonomía de riesgo, enfoques, rúbrica) | Lecturas de caché a ~0,1× del precio de entrada. **Verificar**: el mínimo cacheable en Opus 4.8 es 4096 tokens — si el prompt clínico no llega, el marcador no cachea y no avisa. Confirmar con `cache_read_input_tokens`. |
| Orden del prompt | Prompt clínico estable primero → estado del paciente y transcripción después del breakpoint | El caché es prefix-match: cualquier byte volátil antes del breakpoint lo invalida. |

**No** usar `temperature` (rechazado con 400 en Opus 4.8) ni `budget_tokens` (removido).

## 5. Superficie de alerta de riesgo

Separada del pipeline de reportes:

1. El análisis produce `riskFlags`. Si alguna categoría es `moderado` o `alto`, se emite una
   alerta **antes** de crear el reporte — el reporte puede fallar; la alerta no debe depender de él.
2. Destinatario: el **doctor tratante** de la consulta (`consultations.doctor_id`), nunca el
   paciente y nunca el correo genérico de la clínica.
3. La alerta se persiste con acuse de recibo (`acknowledged_at`, `acknowledged_by`). Sin acuse
   queda visible y sin resolver en el dashboard.
4. Contenido: categoría, nivel y **la cita textual que la sustenta**. Nunca un veredicto sin
   evidencia, nunca un protocolo de crisis automatizado. La decisión es del profesional.

## 6. Evaluación de la detección de riesgo

Sin medición no se puede afirmar calidad ni ante un cliente ni ante un regulador.

- Suite de casos en español latinoamericano con nivel esperado por categoría, ejecutable contra
  cualquier `AnalysisProvider`.
- Métrica primaria: **recall en `alto` y `moderado`**. Un falso negativo cuesta infinitamente más
  que un falso positivo; la suite debe optimizar para no perder ninguno.
- Casos negativos incluidos a propósito (lenguaje intenso sin riesgo real) para medir la tasa de
  falsos positivos — un copiloto que alerta de todo se ignora, y un copiloto ignorado no detecta nada.
- **Límite explícito:** los casos iniciales son sintéticos y escritos por ingeniería. El harness es
  útil desde el día uno para detectar regresiones, pero **no constituye validación clínica** hasta
  que un profesional revise y firme el set. Eso debe decirse en el README, no asumirse.

## 7. Fases

| Fase | Contenido | Bloquea a |
|---|---|---|
| **0a** | Trazabilidad: `model` + `prompt_version` + `generated_at` en `reports` | Todo lo demás — sin procedencia no se puede comparar proveedores ni auditar |
| **0b** | Canal de alerta de riesgo al doctor tratante, con acuse | — (independiente, urgente) |
| **0c** | Harness de evaluación de riesgo | Cualquier cambio de modelo o prompt |
| **1** | `analyze(context)`, `patient_clinical_state`, proveedor Anthropic en paralelo | Fase 2 |
| **2** | Pantalla Brief Pre-Sesión | — |
| **3** | Retiro de nube de palabras / sentimiento de la UI; `progress.ts` reescrito sobre el estado | Fase 1 |

## 8. Lo que este diseño NO resuelve

Honestidad sobre los límites, para que no se vendan de más:

- **No valida clínicamente nada.** Sube el piso de auditabilidad y evidencia; la validación
  requiere un profesional y un estudio, no código.
- **No elimina la alucinación.** La reduce con evidencia obligatoria y salida estructurada, y la
  hace *detectable* (toda afirmación es rastreable a una cita). Detectable ≠ imposible.
- **El estado clínico puede degradarse acumulativamente.** Si una versión introduce un error, las
  siguientes lo heredan. Por eso el versionado append-only es requisito y no adorno: es el
  mecanismo de reversión.

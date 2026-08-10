# Memo para revisión legal — E-Irene

**Fecha:** 6 de agosto de 2026
**Para:** [NOMBRE DE LA ABOGADA]
**Asunto:** Borradores preliminares — constitución societaria y cumplimiento en protección de datos

> Los cuatro documentos que acompañan este memo son **borradores técnicos preparados por el
> equipo de producto**, no conceptos jurídicos. Están redactados para ahorrarte la etapa de
> levantamiento de información: describen con precisión qué hace la plataforma, qué datos toca
> y con qué proveedores. Todo lo que requiere criterio jurídico quedó marcado con `[ ]`.

---

## 1. Qué es E-Irene, en términos operativos

Plataforma SaaS multi-tenant para profesionales de salud mental. El flujo central:

1. El profesional abre una consulta con un paciente (presencial o por videollamada).
2. El audio se transcribe **en vivo**. El audio no se graba ni se almacena en ningún momento:
   el navegador del profesional abre una conexión directa con el proveedor de transcripción y
   solo regresa texto.
3. El texto se cifra (AES-256-GCM) y se analiza con IA para sugerir un borrador de reporte.
4. El profesional **edita y valida** el reporte. El reporte validado es la historia clínica.
5. La transcripción se borra automáticamente pasado el plazo de retención.

**Importante para el análisis jurídico:** la transcripción y el reporte son dos cosas distintas
con dos regímenes distintos. El reporte validado es historia clínica (retención de 15 años,
Resolución 839 de 2017). La transcripción es un documento de trabajo intermedio, y se borra a
los 30 días de validado el reporte, con techo duro de 90 días.

## 2. La doble condición de E-Irene bajo la Ley 1581 de 2012

Es el punto que estructura todos los documentos y conviene validar primero:

| Datos | Responsable del tratamiento | Encargado |
|---|---|---|
| Del **paciente** (historia clínica, transcripción, datos de contacto) | La clínica o el profesional tratante | **E-Irene** |
| Del **profesional** (cuenta, facturación, tarjeta profesional) | **E-Irene** | — |

De ahí que sean dos documentos separados: la **Política de Tratamiento** (E-Irene como
Responsable frente al profesional y frente a visitantes del sitio) y el **acuerdo de encargo**
incorporado en el consentimiento del profesional (E-Irene actuando por cuenta de la clínica
sobre datos del paciente).

**Pregunta para ti:** ¿te parece correcta esta asignación de roles, o consideras que E-Irene
llega a ser corresponsable por el análisis con IA que hace sobre los datos del paciente? El
análisis se ejecuta por instrucción del profesional y su resultado solo es un borrador que él
valida, lo que apunta a encargo — pero es la decisión con más consecuencias del paquete.

## 3. Documentos adjuntos

| Archivo | Qué es | Estado |
|---|---|---|
| `estatutos-sas-borrador.md` | Estatutos S.A.S. para Cámara de Comercio de Medellín | Requiere datos de socios y capital |
| `politica-tratamiento-datos-borrador.md` | Política de Tratamiento (Ley 1581/2012, Decreto 1074/2015) | Requiere datos del Responsable |
| `aviso-privacidad-borrador.md` | Aviso de Privacidad (versión corta para la app) | Derivado de la política |
| `consentimiento-profesional-borrador.md` | Términos de vinculación + acuerdo de encargo | Requiere definir límite de responsabilidad |

## 4. Hallazgos técnicos que motivaron este trabajo

La auditoría interna encontró cuatro brechas entre lo que la plataforma **declaraba** y lo que
**hacía**. **Las cuatro están corregidas y desplegadas en producción** (9 de agosto de 2026), y
los documentos que acompañan este memo describen el estado actual, no el planeado.

Queda **una sola cosa abierta que sí es jurídica**: los acuerdos de tratamiento con los
proveedores extranjeros (ver 4.1). Mientras no existan, la sección 4.1 de la política de
tratamiento no puede afirmarse tal como está redactada.

### 4.1 Retención de audio en el proveedor de transcripción — CORREGIDO

El proveedor de transcripción (Deepgram, EE. UU.) incluye por defecto las peticiones en su
programa de mejora de modelos, que **persiste audio para entrenamiento**. La plataforma no
estaba enviando el parámetro de exclusión, de modo que el audio de las consultas sí se estaba
reteniendo — en contradicción directa con lo que el consentimiento le declara al paciente.

Ya se activó la exclusión (`mip_opt_out=true`). Con ella, el proveedor retiene los datos
únicamente durante el tiempo necesario para procesar la petición.

**Acción pendiente que sí es jurídica:** suscribir el **DPA / BAA con Deepgram** (se solicita a
su equipo comercial; no se activa solo). Lo mismo con OpenAI y los demás encargados listados en
la sección 4 de la política. Hasta que existan esos acuerdos, la política no debería afirmar que
las transferencias internacionales cuentan con garantías contractuales.

### 4.2 Fugas en el borrado automático — CORREGIDO

El proceso de purga tenía dos condiciones que dejaban transcripciones retenidas
indefinidamente: fragmentos huérfanos cuando fallaba la consolidación, y consultas que nunca se
cerraron formalmente. Ambas están corregidas, y ahora cada purga queda registrada en el log de
auditoría inmutable — es decir, **la supresión es demostrable**, no solo prometida.

No es teoría: el proceso **ya se ejecutó solo en producción** los días 8 y 9 de agosto de 2026,
borró las transcripciones que habían cumplido su plazo y dejó la constancia correspondiente. Si
la Superintendencia pregunta cómo se acredita la supresión, la respuesta es una consulta a ese
registro.

### 4.3 Verificación del profesional — CORREGIDO

Hasta agosto de 2026 el registro solo pedía nombre de la clínica, nombre y correo: cualquiera
creaba una clínica y quedaba con acceso a historias clínicas.

Hoy, para acceder a las funciones clínicas el profesional debe aportar copia de su documento de
identidad y de su tarjeta profesional, y esperar aprobación manual. Mientras tanto la cuenta
queda en estado *pendiente de verificación*, sin poder crear pacientes ni transcribir sesiones.
De cada aprobación o rechazo queda constancia de quién decidió y cuándo.

El control **no vive en la interfaz sino en la base de datos** (políticas de fila): una llamada
directa a la API tampoco puede crear registros clínicos sin verificación, y un disparador impide
que alguien se auto-apruebe o que el administrador de una clínica apruebe a sus colegas. Está
verificado con pruebas automatizadas que se ejecutan contra la base real.

**Salvedad que debes conocer:** las **11 cuentas que ya existían** al momento del despliegue
quedaron marcadas como verificadas de forma automática, porque dejarlas bloqueadas habría cortado
el acceso clínico a profesionales que estaban atendiendo pacientes. **Nadie revisó sus
credenciales todavía.** Están señaladas aparte en la consola de administración para revisión
retroactiva, que sigue pendiente.

### 4.4 Aceptación de la política — CORREGIDO

Tampoco existía prueba de que el profesional hubiera aceptado nada. Hoy, quien no haya aceptado
la versión vigente del aviso de privacidad no accede a la plataforma, y la aceptación queda
registrada de forma **inmutable** con la versión del documento, su huella SHA-256, la dirección
IP, el agente de usuario y la marca temporal. La autorización para comunicaciones comerciales se
recaba en casilla separada y opcional.

El aviso está publicado en `/privacidad`, accesible **sin necesidad de iniciar sesión**.

## 5. Preguntas abiertas

1. **Registro Nacional de Bases de Datos (RNBD).** ¿E-Irene queda obligada a registrarse ante la
   SIC desde la constitución, o solo al superar el umbral de activos? Conviene saberlo antes de
   operar con pacientes reales.
2. **Habilitación en salud.** E-Irene es proveedor de software, no prestador de servicios de
   salud: no atiende pacientes ni emplea a los profesionales. ¿Confirmas que eso nos deja fuera
   del régimen de habilitación (Resolución 3100 de 2019) y del REPS? Es determinante para el
   objeto social de los estatutos.
3. **Interoperabilidad.** ¿La Ley 2015 de 2020 y el Decreto 580 de 2024 imponen a E-Irene alguna
   obligación directa de interoperar, o esa carga recae en el prestador que usa la plataforma?
4. **Responsabilidad por el análisis con IA.** El sistema sugiere; el profesional valida y firma.
   ¿La cláusula de limitación de responsabilidad del documento de vinculación resiste frente a un
   eventual daño al paciente, o hay que reforzarla?
5. **Menores de edad.** La plataforma ya contempla consentimiento de representante legal. ¿Basta
   con lo que hay, o necesitamos un documento diferenciado?
6. **Vesting de fundadores.** Lo dejamos previsto en estatutos, pero suele ir en un **acuerdo de
   accionistas** (art. 24, Ley 1258 de 2008). ¿Cuál prefieres?

---

**Contacto técnico:** [NOMBRE] — [CORREO]

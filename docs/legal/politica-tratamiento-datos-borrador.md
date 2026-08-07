# POLÍTICA DE TRATAMIENTO DE DATOS PERSONALES — [E-IRENE] S.A.S.

> **BORRADOR PRELIMINAR PARA REVISIÓN JURÍDICA — NO PUBLICAR**
>
> Marco: Ley 1581 de 2012, Decreto 1074 de 2015 (que compiló el Decreto 1377 de 2013),
> Ley 1266 de 2008 en lo pertinente, y Ley 527 de 1999.
> Los plazos y proveedores descritos corresponden al comportamiento **real y verificado** de la
> plataforma a agosto de 2026. Si cambian en el código, este documento debe cambiar.

**Versión:** `[1.0]` · **Vigente desde:** `[FECHA]` · **Última actualización:** `[FECHA]`

---

## 1. Identificación del Responsable

| | |
|---|---|
| **Razón social** | `[E-IRENE] S.A.S.` |
| **NIT** | `[ ]` |
| **Domicilio** | `[DIRECCIÓN]`, Medellín, Antioquia, Colombia |
| **Correo para ejercicio de derechos** | `[protecciondedatos@e-irene.co]` |
| **Teléfono** | `[ ]` |
| **Área responsable** | `[Área de Protección de Datos]` |

---

## 2. Alcance: la doble condición de E-Irene

Esta es la distinción que determina qué obligaciones asume la compañía en cada caso, y conviene
leerla antes que el resto del documento.

### 2.1 E-Irene como **Responsable**

Respecto de los datos de **profesionales de la salud, personal administrativo de las clínicas,
usuarios del sitio web y contactos comerciales**. Sobre estos datos, E-Irene decide las
finalidades y los medios, y esta política los rige íntegramente.

### 2.2 E-Irene como **Encargado**

Respecto de los datos de **pacientes** —incluidas las historias clínicas, transcripciones y
reportes— que los profesionales y las clínicas incorporan a la plataforma.

En estos casos el **Responsable es la clínica o el profesional tratante**, quien determina las
finalidades y obtiene el consentimiento del paciente. E-Irene los trata **únicamente conforme a
las instrucciones del Responsable** y en los términos del acuerdo de encargo suscrito con él.

> **Si usted es paciente:** para ejercer sus derechos sobre su historia clínica, diríjase en
> primer lugar al profesional o la clínica que lo atiende, que es el Responsable de sus datos.
> E-Irene atenderá y trasladará cualquier solicitud que reciba directamente, e informará al
> titular a quién corresponde resolverla, dentro de los términos legales.

---

## 3. Datos tratados y finalidades

### 3.1 Datos de profesionales y personal de clínicas (E-Irene como Responsable)

| Categoría | Datos | Finalidad | Base |
|---|---|---|---|
| Identificación | Nombre, documento, correo, teléfono | Crear y administrar la cuenta | Ejecución del contrato |
| Habilitación profesional | Tarjeta profesional, registro en ReTHUS, título | Verificar que quien accede a historias clínicas es un profesional habilitado | Obligación legal y interés legítimo en la seguridad del servicio |
| Facturación | Plan, historial de pagos, datos de la transacción | Cobrar el servicio y cumplir obligaciones tributarias | Ejecución del contrato y obligación legal |
| Uso y seguridad | Registros de acceso, dirección IP, agente de usuario, trazas de auditoría | Seguridad, trazabilidad legal, soporte, prevención del fraude | Interés legítimo y obligación legal |
| Comunicaciones | Correo, preferencias | Avisos operativos y, previa autorización separada, comunicaciones comerciales | Consentimiento para lo comercial |

**La verificación de habilitación profesional implica el tratamiento de datos de identificación
contra fuentes públicas oficiales**, incluido el Registro Único Nacional del Talento Humano en
Salud (ReTHUS). `[Confirmar que la consulta a fuentes públicas no requiere autorización adicional
específica del profesional más allá de la que otorga al registrarse.]`

### 3.2 Datos de pacientes (E-Irene como Encargado)

| Categoría | Datos | Naturaleza |
|---|---|---|
| Identificación | Nombre, documento, fecha de nacimiento, sexo, contacto | Personal |
| Contacto de emergencia | Nombre y teléfono de un tercero | Personal de tercero |
| **Salud** | Motivo de consulta, transcripción de sesión, reportes clínicos, notas SOAP, planes de tratamiento, evaluaciones psicométricas, indicadores de riesgo | **Sensible** (art. 5, Ley 1581 de 2012) |
| Consentimiento | Firma, huella criptográfica del documento, dirección IP, agente de usuario, fecha y hora | Personal |

**Finalidad única:** prestar al Responsable el servicio de historia clínica electrónica,
transcripción y generación asistida de reportes.

**E-Irene no utiliza datos de pacientes para finalidades propias.** En particular, **no los
emplea para entrenar modelos de inteligencia artificial**, ni propios ni de terceros, ni los
comercializa, ni los cede a terceros distintos de los encargados listados en la sección 4.

### 3.3 Datos sensibles: advertencia legal

Los datos de salud son **sensibles**. En consecuencia:

- Ningún titular está obligado a autorizar su tratamiento.
- La autorización debe ser **explícita, previa e informada**, y se recaba mediante el
  consentimiento informado que el profesional presenta al paciente antes de la primera sesión.
- Se recaba y conserva prueba de la autorización: versión del documento, huella criptográfica
  SHA-256 de su texto, firma, dirección IP, agente de usuario y marca temporal.
- Tratándose de **menores de edad**, la autorización la otorga el representante legal, y el
  tratamiento debe responder al interés superior del menor y respetar sus derechos fundamentales.

---

## 4. Encargados y transferencias internacionales

E-Irene se apoya en proveedores de infraestructura y servicios que actúan como **encargados**.
**Todos están ubicados fuera de Colombia**, por lo que existe transferencia internacional de
datos, incluidos datos sensibles de salud.

| Proveedor | Función | Datos que trata | Ubicación |
|---|---|---|---|
| **Supabase** | Base de datos, autenticación, almacenamiento | Todos los datos de la plataforma, cifrados | `[EE. UU. — confirmar región contratada]` |
| **Vercel** | Alojamiento y ejecución de la aplicación | Datos en tránsito; registros de acceso | EE. UU. |
| **Deepgram** | Transcripción de voz a texto | **Audio de la sesión en tiempo real** | EE. UU. |
| **OpenAI** | Análisis asistido del texto | Transcripción en texto | EE. UU. |
| **Daily.co** | Videollamada | Video y audio en tránsito, sin almacenamiento | EE. UU. |
| **Resend** | Correo transaccional | Correo y nombre del destinatario | EE. UU. |
| **Twilio** | Mensajería WhatsApp (planes superiores) | Teléfono y contenido del recordatorio | EE. UU. |
| **Wompi** | Pasarela de pagos | Datos de facturación del profesional | Colombia |

### 4.1 Garantías aplicables

`[SECCIÓN CRÍTICA — REDACCIÓN CONDICIONADA. Esta sección solo puede afirmarse una vez estén
suscritos los acuerdos de tratamiento (DPA/BAA) con cada encargado. A la fecha de este borrador
**no lo están**. La abogada debe decidir si se publica con la redacción condicional o si se
aplaza la publicación hasta suscribirlos.]`

Colombia exige que la transferencia internacional se dirija a países con nivel adecuado de
protección o que se adopten garantías equivalentes. E-Irene:

1. Suscribe con cada encargado un **acuerdo de tratamiento de datos** que le impone
   confidencialidad, medidas de seguridad y prohibición de uso para fines propios.
2. Exige **certificaciones de seguridad vigentes** (SOC 2 Tipo II o equivalente).
3. Configura los servicios de modo que **el contenido de las consultas no se utilice para
   entrenar modelos** de los proveedores.
4. Mantiene un registro actualizado de encargados y notifica los cambios conforme a la
   sección 10.

### 4.2 Tratamiento del audio

Por su sensibilidad, se detalla el flujo:

- **El audio no se graba ni se almacena** en ningún momento, ni por E-Irene ni por sus
  proveedores. El navegador del profesional lo transmite en directo al proveedor de
  transcripción y solo regresa texto.
- E-Irene tiene **desactivada la participación en el programa de mejora de modelos** del
  proveedor de transcripción. Con esa configuración, el proveedor retiene los datos únicamente
  durante el tiempo necesario para procesar la petición.
- En videollamada, el proveedor de video **transmite sin conservar copia**.

---

## 5. Plazos de conservación

| Dato | Plazo | Fundamento |
|---|---|---|
| **Audio de la sesión** | No se conserva | Minimización |
| **Transcripción de la sesión** | Se suprime **30 días después** de que el profesional valide el reporte; en todo caso, **máximo 90 días** desde la sesión, aunque no se valide | Documento de trabajo intermedio; minimización |
| **Reporte clínico, notas y evaluaciones** | **15 años** desde la última atención (5 en archivo de gestión + 10 en archivo central) | Resolución 839 de 2017 |
| **Consentimientos** | Igual que la historia clínica | Prueba de la autorización |
| **Registros de auditoría** | `[10]` años | Trazabilidad y defensa jurídica |
| **Datos de facturación** | `[10]` años | Obligaciones tributarias y comerciales |
| **Cuenta del profesional** | Mientras esté vigente la relación, más `[2]` años | Ejecución del contrato y prescripción |

**La supresión de la transcripción es automática y verificable:** se ejecuta mediante un proceso
programado diario y cada ejecución queda registrada en el log de auditoría inmutable, con fecha y
número de registros suprimidos. La plataforma conserva, por cada consulta, la marca temporal de
la supresión.

> **Nota sobre los datos de salud:** el derecho de supresión **no es absoluto** cuando existe un
> deber legal de conservación. Los reportes clínicos que integran la historia clínica no pueden
> suprimirse antes de los términos de la Resolución 839 de 2017, ni siquiera a solicitud del
> titular. Ante una solicitud de supresión, E-Irene lo informará indicando el fundamento.

---

## 6. Derechos de los titulares

Todo titular tiene derecho a:

1. **Conocer, actualizar y rectificar** sus datos.
2. **Solicitar prueba de la autorización**, salvo cuando la ley no la exija.
3. **Ser informado** sobre el uso dado a sus datos.
4. **Presentar quejas** ante la Superintendencia de Industria y Comercio.
5. **Revocar la autorización y solicitar la supresión**, cuando no exista deber legal o
   contractual de conservación.
6. **Acceder gratuitamente** a sus datos.

---

## 7. Procedimiento para consultas y reclamos

**Canal:** `[protecciondedatos@e-irene.co]` · **Alterno:** `[DIRECCIÓN FÍSICA]`

### 7.1 Consultas

Se resuelven en un término máximo de **diez (10) días hábiles**. De no ser posible, se informará
al interesado la razón y la fecha de respuesta, que no superará los **cinco (5) días hábiles**
siguientes al vencimiento del primer plazo.

### 7.2 Reclamos

La solicitud debe contener identificación del titular, descripción de los hechos, dirección de
contacto y los documentos que se quieran hacer valer. Si está incompleta, se requerirá al
interesado dentro de los **cinco (5) días** siguientes; transcurridos **dos (2) meses** sin
respuesta, se entenderá desistida.

El reclamo se resuelve en un término máximo de **quince (15) días hábiles**, prorrogable por
**ocho (8) días hábiles** más, previa comunicación de las razones.

Mientras el reclamo esté en trámite, el dato quedará marcado con la leyenda **"reclamo en
trámite"**.

### 7.3 Requisito de procedibilidad

El titular deberá agotar este trámite antes de acudir a la Superintendencia de Industria y
Comercio.

### 7.4 Solicitudes de pacientes

Cuando la solicitud provenga de un paciente y se refiera a datos en los que E-Irene actúa como
Encargado, se trasladará al Responsable —el profesional o la clínica— dentro de los **tres (3)
días hábiles** siguientes, informando de ello al titular. E-Irene apoyará al Responsable con los
medios técnicos necesarios para atenderla.

---

## 8. Medidas de seguridad

E-Irene aplica medidas técnicas, humanas y administrativas orientadas a la seguridad de la
información. Las implementadas a la fecha:

- **Cifrado en reposo:** AES-256-GCM a nivel de aplicación sobre datos de identificación y datos
  clínicos. La información se almacena cifrada, no en texto claro.
- **Cifrado en tránsito:** TLS en todas las comunicaciones.
- **Aislamiento entre clínicas:** políticas de seguridad a nivel de fila (RLS) en la base de
  datos, que impiden a una clínica acceder a datos de otra.
- **Control de acceso por rol:** administrador, profesional, personal administrativo y paciente,
  con permisos diferenciados.
- **Registro de auditoría inmutable:** las trazas no admiten modificación ni borrado, ni siquiera
  por administradores.
- **Minimización:** el audio no se persiste; la transcripción se suprime automáticamente.
- **Trazabilidad del consentimiento:** huella SHA-256 del documento firmado, dirección IP, agente
  de usuario y marca temporal.

`[Pendientes conocidos, que la abogada debe considerar antes de publicar: custodia de la clave de
cifrado en un módulo de gestión de claves (hoy reside en variable de entorno); procedimiento
formal de respuesta a incidentes; y verificación de habilitación profesional en el registro, hoy
no implementada.]`

---

## 9. Incidentes de seguridad

E-Irene mantiene un procedimiento de detección, contención y análisis de incidentes. En caso de
incidente que afecte datos personales:

1. Se contendrá y evaluará el alcance.
2. Se **informará a la Superintendencia de Industria y Comercio** conforme a la normativa
   vigente.
3. Se notificará **sin dilación indebida** a los Responsables afectados —clínicas y
   profesionales— para que estos, a su vez, informen a los titulares.
4. Se documentará el incidente y las medidas correctivas adoptadas.

---

## 10. Vigencia y modificaciones

Esta política rige desde `[FECHA]` y permanecerá vigente mientras E-Irene desarrolle su objeto
social. Las bases de datos se conservarán por los plazos de la sección 5.

Los cambios sustanciales —en particular los que afecten finalidades, plazos de conservación o el
listado de encargados— se comunicarán con **quince (15) días** de antelación, por correo
electrónico y mediante aviso en la plataforma. Si el cambio implica una finalidad nueva y
distinta, se solicitará **nueva autorización**.

---

## ANEXO — Puntos que requieren decisión antes de publicar

| # | Punto |
|---|---|
| 1 | ¿Corresponde inscripción en el Registro Nacional de Bases de Datos ante la SIC? ¿Desde cuándo? |
| 2 | Confirmar la región contratada con Supabase y si conviene una región distinta |
| 3 | Redacción de la sección 4.1 mientras no estén suscritos los acuerdos con encargados |
| 4 | Confirmar plazo de conservación de auditoría y facturación (hoy 10 años, por definir) |
| 5 | ¿La consulta a ReTHUS requiere autorización específica adicional? |
| 6 | Validar el procedimiento y los términos de notificación de incidentes a la SIC |
| 7 | Definir si se designa formalmente un oficial de protección de datos |

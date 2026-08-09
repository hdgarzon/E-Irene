# AVISO DE PRIVACIDAD — [E-IRENE] S.A.S.

> **BORRADOR PRELIMINAR PARA REVISIÓN JURÍDICA — NO PUBLICAR**
>
> El aviso de privacidad es la **versión corta** que se muestra al titular en el momento de la
> recolección. No sustituye la Política de Tratamiento: la resume y remite a ella.
> Contenido mínimo conforme al Decreto 1074 de 2015: identidad y datos de contacto del
> Responsable, tratamiento y finalidades, derechos del titular, y medio para conocer la política.

Este documento contiene **tres piezas** que van en lugares distintos de la aplicación:

1. El aviso completo, para publicar en `/privacidad`.
2. El texto de aceptación del registro de profesionales.
3. El aviso breve que ve el paciente antes de iniciar una sesión transcrita.

---

# PIEZA 1 — Aviso de privacidad completo (`/privacidad`)

## ¿Quién trata sus datos?

**`[E-IRENE] S.A.S.`**, NIT `[ ]`, con domicilio en `[DIRECCIÓN]`, Medellín, Colombia.
Correo para el ejercicio de sus derechos: **`[protecciondedatos@e-irene.co]`**
Teléfono: `[ ]`

## ¿Qué datos tratamos y para qué?

**Si usted es un profesional de la salud o personal de una clínica**, tratamos sus datos de
identificación, contacto, habilitación profesional, facturación y uso de la plataforma, con el
fin de crear y administrar su cuenta, **verificar que está habilitado para ejercer**, cobrar el
servicio, darle soporte y cumplir obligaciones legales. En esta relación, E-Irene es el
**Responsable** de sus datos.

**Si usted es paciente**, sus datos de salud —incluidas las transcripciones y los reportes de sus
sesiones— son tratados por E-Irene **por cuenta del profesional o la clínica que lo atiende**,
quien es el **Responsable** de su información y quien recaba su consentimiento. E-Irene actúa
como **Encargado**: solo trata sus datos siguiendo las instrucciones de ese profesional, y **no
los usa para finalidades propias ni para entrenar modelos de inteligencia artificial**.

## Datos sensibles

Los datos de salud son **sensibles**. Usted **no está obligado** a autorizar su tratamiento.
Cuando se requiera su autorización, se le solicitará de forma **previa, expresa e informada**,
y quedará constancia de ella.

## Sobre el audio de las sesiones

**El audio de su sesión no se graba ni se almacena en ningún momento.** Se transcribe en vivo y
únicamente se conserva el texto, cifrado. La transcripción se **suprime automáticamente** 30 días
después de que el profesional valide el reporte de la sesión y, en todo caso, a más tardar a los
90 días.

## ¿Con quién compartimos sus datos?

Con proveedores de infraestructura tecnológica que actúan como encargados —alojamiento, base de
datos, transcripción, análisis, videollamada, correo, mensajería y pagos—, obligados
contractualmente a la confidencialidad. **Algunos están ubicados fuera de Colombia**, lo que
implica transferencia internacional de datos. El listado completo y actualizado está en la
Política de Tratamiento.

No vendemos ni cedemos sus datos a terceros con fines comerciales.

## Sus derechos

Conocer, actualizar y rectificar sus datos; solicitar prueba de la autorización; ser informado
sobre su uso; revocar la autorización y solicitar la supresión cuando no exista un deber legal de
conservación; acceder gratuitamente a sus datos; y presentar quejas ante la **Superintendencia de
Industria y Comercio**.

> Si sus datos hacen parte de una **historia clínica**, la ley obliga a conservarlos por 15 años
> desde la última atención (Resolución 839 de 2017). En ese caso no podemos suprimirlos, ni
> siquiera a solicitud suya, y se lo informaremos indicando el fundamento.

**Para ejercerlos:** escriba a `[protecciondedatos@e-irene.co]`. Responderemos las consultas en
un máximo de **10 días hábiles** y los reclamos en un máximo de **15 días hábiles**.

## Política completa

Disponible permanentemente en **`[https://e-irene.co/privacidad]`**.

**Versión** `[1.0]` · **Vigente desde** `[FECHA]`

---

# PIEZA 2 — Aceptación del profesional

> **IMPLEMENTADO** en `/terminos`, como compuerta de acceso y no como casilla en el formulario de
> registro. La razón es de cobertura: a los miembros que un administrador da de alta desde el
> equipo se les crea la cuenta directamente, sin pasar por el registro, y las cuentas anteriores a
> este control tampoco habrían pasado por ahí. Una casilla en el registro habría dejado a todos
> ellos sin aceptación registrada.
>
> Con la compuerta, quien no tenga aceptada la versión vigente no entra a la aplicación, venga por
> donde venga. Y cuando el texto cambie, basta con subir la versión para que todos vuelvan a
> pasar por ella — que es lo que exige la sección 10 de la política para cambios sustanciales.
>
> Las casillas **no vienen marcadas por defecto**: una casilla premarcada no constituye
> autorización válida. Al aceptar se guarda versión del documento, huella SHA-256, dirección IP,
> agente de usuario y marca temporal — el mismo patrón del consentimiento del paciente. El
> registro es **inmutable**: una prueba que se puede editar no prueba nada.

**Texto de la casilla:**

> ☐ He leído y acepto los **[Términos de Vinculación Profesional]** y la **[Política de
> Tratamiento de Datos Personales]**, y autorizo a E-Irene S.A.S. a tratar mis datos personales
> para las finalidades allí descritas, **incluida la verificación de mi habilitación
> profesional** ante fuentes públicas oficiales.

**Segunda casilla, separada y opcional:**

> ☐ Quiero recibir comunicaciones sobre novedades y funcionalidades de la plataforma.
> *(Opcional. Puede retirar esta autorización en cualquier momento.)*

> **Nota técnica:** la autorización comercial **debe ir separada** de la aceptación contractual.
> Agrupar ambas en una sola casilla vicia el consentimiento comercial.

---

# PIEZA 3 — Aviso al paciente antes de la sesión transcrita

> Va en la pantalla de consulta en vivo, antes de iniciar la transcripción. Es un recordatorio
> en el momento oportuno; **no sustituye** el consentimiento informado que el paciente firma
> antes de la primera sesión.

> **Esta sesión será transcrita.**
>
> El audio **no se graba ni se guarda**: se convierte a texto en vivo y solo se conserva el
> texto, cifrado. La transcripción se borra automáticamente una vez el profesional valida el
> reporte de la sesión.
>
> Usted puede pedir que se detenga la transcripción en cualquier momento.
>
> `[Conocer más]`

---

## ANEXO — Implementación pendiente

| # | Pieza | Dónde | Estado |
|---|---|---|---|
| 1 | Página `/privacidad` | `app/privacidad/page.tsx` | ✅ Pública, sin exigir sesión |
| 2 | Enlace en el pie de página | Landing y layout de autenticación | ✅ |
| 3 | Casillas de aceptación | `components/accept-policy-form.tsx` | ✅ Contractual y comercial, separadas |
| 4 | Registro de la aceptación | Tabla `policy_acceptances` (migración 0035) | ✅ Inmutable, con hash + IP + user-agent |
| 5 | Aviso previo a la sesión | `components/live-consultation.tsx` | ✅ |

El texto que se publica en `/privacidad` y el que se acepta en `/terminos` **salen de la misma
constante** (`POLICY_TEXT` en `lib/legal.ts`). No pueden divergir: si divergieran, el hash
guardado como prueba no correspondería al texto publicado, y la prueba perdería su valor.

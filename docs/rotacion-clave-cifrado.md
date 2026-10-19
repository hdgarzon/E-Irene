# Rotación de la clave de cifrado (`ENCRYPTION_KEY`)

Cuándo: si la clave se filtró o pudo filtrarse (ver el protocolo de incidentes, sección 6.1), o como rotación preventiva periódica.

La clave cifra con AES-256-GCM todas las columnas `*_enc` (datos de pacientes, transcripciones, reportes, notas, documentos de los profesionales y el token de cobro) y deriva el índice ciego de búsqueda. **Reemplazarla sin este procedimiento deja ilegible todo lo cifrado.**

## Cómo funciona

- Cada valor nuevo lleva el id de su clave: `k2:…`. Un valor sin prefijo es de la clave 1, la original.
- Durante la rotación conviven dos claves: la nueva (`ENCRYPTION_KEY_NEXT`), que cifra todo lo nuevo, y la anterior (`ENCRYPTION_KEY`), que solo descifra. **Nunca hay que volver a escribir la clave vieja**; en Vercel es *Sensitive* y no se puede leer.
- La consola (`/admin/rotacion-clave`) recifra lo existente por lotes con la clave nueva y recalcula el índice de búsqueda. Corre dentro de la app, que es la única que tiene las claves. Es reanudable y no pisa escrituras concurrentes.
- Mientras dura, la plataforma funciona con normalidad. La única diferencia: la búsqueda de pacientes no encuentra a los que todavía no se reindexaron, hasta que termina la pasada.

## Procedimiento

Necesitas acceso de admin de plataforma y a las variables de entorno del proyecto en Vercel.

### 1. Generar la clave nueva

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Guárdala **de inmediato** en el gestor de contraseñas. Después de cargarla en Vercel no se podrá volver a leer.

Mira el id actual en `/admin/rotacion-clave` ("Clave activa: N"). La nueva será N+1.

### 2. Activar la clave nueva

En Vercel → *Settings* → *Environment Variables*, entorno **Production**:

| Variable | Valor | Tipo |
|---|---|---|
| `ENCRYPTION_KEY_NEXT` | la clave nueva | Sensitive |
| `ENCRYPTION_KEY_NEXT_ID` | N+1 | normal |

No toques `ENCRYPTION_KEY` ni `ENCRYPTION_KEY_ID`.

Las variables se aplican en el siguiente despliegue a producción. Fusiona cualquier PR pendiente o redespliega el último despliegue de producción desde Vercel. **No uses `vercel deploy` desde la máquina local** (ver CLAUDE.md).

Comprueba en `/admin/rotacion-clave` que dice "Clave activa: N+1 · rotación en curso".

### 3. Recifrar

En `/admin/rotacion-clave`, pulsa **Recifrar ahora**. Cada pasada dura hasta 4 minutos; si termina por tiempo, vuelve a pulsar. Repite hasta que diga **"Todo está cifrado con la clave N+1"**.

- **Ilegibles > 0:** hay valores cifrados con una clave que no está en el llavero. Los logs (`key_rotation.undecryptable`) dicen en qué tabla, columna y fila. No avances al paso 4 hasta resolverlos. Si son de una clave antigua que todavía se tiene, se agrega temporalmente en `ENCRYPTION_KEYS_RETIRED` como `id:clave` y se vuelve a pulsar.

### 4. Cerrar la rotación

Cuando no quede nada pendiente:

1. En Vercel, cambia `ENCRYPTION_KEY` por la clave nueva y `ENCRYPTION_KEY_ID` por N+1.
2. Borra `ENCRYPTION_KEY_NEXT` y `ENCRYPTION_KEY_NEXT_ID`.
3. Redespliega como en el paso 2 y verifica que `/admin/rotacion-clave` diga "Clave activa: N+1 · sin rotación en curso" y "Todo está cifrado".
4. Abre una ficha de paciente y prueba una búsqueda, para confirmar que se leen los datos.
5. **Destruye la clave anterior** del gestor de contraseñas. Si la rotación fue por una filtración, esto es lo que cierra el incidente.

### 5. Entornos locales y de pruebas

`.env.local` de cada desarrollador apunta a su Supabase local, con su propia clave: no se rota. CI genera una clave aleatoria en cada corrida.

## Si algo sale mal

- **Errores de descifrado después del paso 2:** la variable `ENCRYPTION_KEY` no debe cambiar en ese paso. Si se cambió por error, vuelve a ponerle el valor anterior desde el gestor de contraseñas y redespliega.
- **Una pasada falla a medias:** lo recifrado queda hecho; vuelve a pulsar.
- **Una búsqueda no encuentra a un paciente durante la rotación:** termina el recifrado; el índice se recalcula al final de cada pasada.

## Referencias

- `lib/crypto.ts`: llavero y formato.
- `lib/key-rotation.ts`: recifrado por lotes.
- `supabase/migrations/0066_encryption_key_rotation.sql`: funciones de la base y excepciones a la inmutabilidad, solo para recifrar.
- `tests/key-rotation.test.ts`: el procedimiento completo de punta a punta.

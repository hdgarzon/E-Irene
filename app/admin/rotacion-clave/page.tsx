import { keyRotationStatus } from "@/lib/key-rotation";
import { KeyRotationButton } from "@/components/key-rotation-button";

// La pasada de recifrado corre como Server Action de esta página.
export const maxDuration = 300;

/**
 * Rotación de ENCRYPTION_KEY: cuánto falta por recifrar con la clave activa y el
 * botón para avanzar. El procedimiento completo está en
 * docs/rotacion-clave-cifrado.md.
 */
export default async function RotacionClavePage() {
  const status = await keyRotationStatus();
  const pending = status.columns.filter((c) => c.pending > 0);
  const done = status.pendingValues === 0 && status.pendingSearchIndex === 0;
  // Rotación en curso: la nueva está en ENCRYPTION_KEY_NEXT y la anterior en ENCRYPTION_KEY.
  const rotating = Boolean(process.env.ENCRYPTION_KEY_NEXT?.trim());

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy">Rotación de la clave de cifrado</h1>
        <p className="text-sm text-muted-foreground">
          Clave activa: <strong className="text-navy">{status.activeKeyId}</strong>
          {rotating ? " · rotación en curso (ENCRYPTION_KEY_NEXT configurada)" : " · sin rotación en curso"}. Procedimiento
          completo en <code>docs/rotacion-clave-cifrado.md</code>.
        </p>
      </div>

      <section className="space-y-3 rounded-2xl border border-gray-line bg-card p-6">
        {done ? (
          <p className="text-sm text-mint">
            Todo está cifrado con la clave {status.activeKeyId}.
            {rotating
              ? " Termina la rotación: en Vercel pon la clave nueva en ENCRYPTION_KEY con ENCRYPTION_KEY_ID, borra ENCRYPTION_KEY_NEXT y ENCRYPTION_KEY_NEXT_ID, redespliega y destruye la clave anterior."
              : ""}
          </p>
        ) : (
          <>
            <p className="text-sm">
              Faltan <strong>{status.pendingValues}</strong> valores por recifrar y{" "}
              <strong>{status.pendingSearchIndex}</strong> pacientes por reindexar.
            </p>
            {pending.length > 0 && (
              <ul className="space-y-1 text-xs text-muted-foreground">
                {pending.map((c) => (
                  <li key={`${c.table}.${c.column}`} className="font-mono">
                    {c.table}.{c.column}: {c.pending}
                  </li>
                ))}
              </ul>
            )}
            <KeyRotationButton />
          </>
        )}
      </section>
    </div>
  );
}

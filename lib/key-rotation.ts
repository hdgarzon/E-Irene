import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { activeKeyId, decrypt, decryptNullable, encrypt } from "@/lib/crypto";
import { computeTrigrams, patientSearchText } from "@/lib/search-index";
import { logger } from "@/lib/logger";

/**
 * Recifrado de los datos con la clave activa tras rotar ENCRYPTION_KEY (ver
 * lib/crypto.ts y docs/rotacion-clave-cifrado.md).
 *
 * Recorre cada columna *_enc buscando valores que no estén con la clave activa,
 * los descifra con el llavero y los vuelve a cifrar. Después recalcula el índice
 * ciego de búsqueda de los pacientes indexados con otra clave. Corre dentro de la
 * aplicación porque solo ella tiene las claves (en Vercel son Sensitive: no se
 * pueden leer desde fuera).
 *
 * Es reanudable e idempotente: cada pasada avanza hasta agotar su presupuesto de
 * tiempo, y la siguiente sigue donde quedaron valores pendientes. Las
 * actualizaciones son condicionales (la base solo reemplaza si el valor sigue
 * siendo el que se leyó), así que no pisa escrituras de la app en paralelo.
 */

const BATCH_SIZE = 200;

export interface ColumnStatus {
  table: string;
  column: string;
  pending: number;
}

export interface KeyRotationStatus {
  activeKeyId: string;
  columns: ColumnStatus[];
  pendingValues: number;
  /** Pacientes cuyo índice de búsqueda se calculó con otra clave. */
  pendingSearchIndex: number;
}

export interface KeyRotationRun {
  activeKeyId: string;
  reencrypted: number;
  reindexed: number;
  /** Valores que no se pudieron descifrar con ninguna clave del llavero. */
  failed: number;
  /** true si la pasada se cortó por tiempo y quedan valores por recorrer. */
  timedOut: boolean;
}

type Untyped = SupabaseClient;

export async function keyRotationStatus(): Promise<KeyRotationStatus> {
  const admin = createAdminClient() as unknown as Untyped;
  const keyId = activeKeyId();
  const [{ data, error }, { count, error: countError }] = await Promise.all([
    admin.rpc("encryption_key_status", { p_active_id: keyId }),
    admin.from("patients").select("id", { count: "exact", head: true }).neq("search_index_key", keyId),
  ]);
  if (error) throw error;
  if (countError) throw countError;
  const columns = ((data ?? []) as { table_name: string; column_name: string; pending: number }[]).map((r) => ({
    table: r.table_name,
    column: r.column_name,
    pending: Number(r.pending),
  }));
  return {
    activeKeyId: keyId,
    columns,
    pendingValues: columns.reduce((sum, c) => sum + c.pending, 0),
    pendingSearchIndex: count ?? 0,
  };
}

/**
 * @param options.timeBudgetMs tiempo máximo de la pasada; lo pendiente queda para la siguiente.
 * @param options.clinicId limita la pasada a una clínica. Lo usan las pruebas, para
 *   no recifrar los datos de otras suites que comparten la base local.
 */
export async function rotateEncryptedData(
  options: { timeBudgetMs?: number; clinicId?: string } = {},
): Promise<KeyRotationRun> {
  const deadline = Date.now() + (options.timeBudgetMs ?? 240_000);
  const admin = createAdminClient() as unknown as Untyped;
  const status = await keyRotationStatus();
  const keyId = status.activeKeyId;
  const run: KeyRotationRun = { activeKeyId: keyId, reencrypted: 0, reindexed: 0, failed: 0, timedOut: false };

  for (const { table, column, pending } of status.columns) {
    if (pending === 0) continue;
    let lastId: string | null = null;
    for (;;) {
      if (Date.now() > deadline) {
        run.timedOut = true;
        return run;
      }
      // Clave activa 1 = formato sin prefijo: lo pendiente es lo que lleva el de otra.
      let query =
        keyId === "1"
          ? admin.from(table).select(`id, ${column}`).filter(column, "match", "^k[0-9]+:")
          : admin.from(table).select(`id, ${column}`).not(column, "is", null).filter(column, "not.like", `k${keyId}:%`);
      if (options.clinicId) query = query.eq(table === "clinics" ? "id" : "clinic_id", options.clinicId);
      if (lastId) query = query.gt("id", lastId);
      const { data, error } = await query.order("id").limit(BATCH_SIZE);
      if (error) throw error;
      const rows = (data ?? []) as unknown as Record<string, string>[];
      if (rows.length === 0) break;

      const items: { id: string; old: string; new: string }[] = [];
      for (const row of rows) {
        const old = row[column];
        try {
          items.push({ id: row.id, old, new: encrypt(decrypt(old)) });
        } catch (err) {
          // Sin contenido en el log: solo dónde está el valor ilegible.
          run.failed += 1;
          logger.error("key_rotation.undecryptable", { table, column, id: row.id, error: err });
        }
      }
      if (items.length > 0) {
        const { data: updated, error: rpcError } = await admin.rpc("reencrypt_values", {
          p_table: table,
          p_column: column,
          p_items: items,
        });
        if (rpcError) throw rpcError;
        run.reencrypted += Number(updated ?? 0);
      }
      lastId = rows[rows.length - 1].id;
    }
  }

  let lastId: string | null = null;
  for (;;) {
    if (Date.now() > deadline) {
      run.timedOut = true;
      return run;
    }
    let query = admin
      .from("patients")
      .select("id, full_name_enc, document_enc, phone_enc")
      .neq("search_index_key", keyId);
    if (options.clinicId) query = query.eq("clinic_id", options.clinicId);
    if (lastId) query = query.gt("id", lastId);
    const { data, error } = await query.order("id").limit(BATCH_SIZE);
    if (error) throw error;
    const rows = (data ?? []) as {
      id: string;
      full_name_enc: string;
      document_enc: string | null;
      phone_enc: string | null;
    }[];
    if (rows.length === 0) break;

    const items = [];
    for (const row of rows) {
      try {
        const trigrams = computeTrigrams(
          patientSearchText({
            fullName: decrypt(row.full_name_enc),
            document: decryptNullable(row.document_enc),
            phone: decryptNullable(row.phone_enc),
          }),
        );
        items.push({ ...row, trigrams });
      } catch (err) {
        run.failed += 1;
        logger.error("key_rotation.reindex_undecryptable", { id: row.id, error: err });
      }
    }
    if (items.length > 0) {
      const { data: updated, error: rpcError } = await admin.rpc("reindex_patient_search", {
        p_items: items,
        p_key: keyId,
      });
      if (rpcError) throw rpcError;
      run.reindexed += Number(updated ?? 0);
    }
    lastId = rows[rows.length - 1].id;
  }

  return run;
}

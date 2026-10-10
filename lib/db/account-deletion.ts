import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { listBucketObjects } from "@/lib/db/verification-documents";
import { DOCUMENTS_BUCKET } from "@/lib/verification";
import { logger } from "@/lib/logger";

/**
 * Eliminación de la cuenta de una clínica (migración 0062; Términos de
 * Vinculación, cláusula séptima, numeral 5): 30 días para exportar o desistir,
 * y después supresión definitiva de los pacientes y su información clínica.
 */

export interface AccountDeletionRequest {
  id: string;
  requestedAt: string;
  scheduledFor: string;
}

interface RequestRow {
  id: string;
  requested_at: string;
  scheduled_for: string;
}

function mapRow(r: RequestRow): AccountDeletionRequest {
  return { id: r.id, requestedAt: r.requested_at, scheduledFor: r.scheduled_for };
}

/**
 * Solicitud abierta de la clínica, o null. Se filtra por clínica aunque RLS ya
 * lo haga: el admin de plataforma ve las de todas.
 */
export async function getOpenAccountDeletion(clinicId: string): Promise<AccountDeletionRequest | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("account_deletion_requests")
    .select("id, requested_at, scheduled_for")
    .eq("clinic_id", clinicId)
    .is("cancelled_at", null)
    .is("executed_at", null)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRow(data) : null;
}

/** Solo el admin de la clínica (lo valida la función). Devuelve la solicitud abierta. */
export async function requestAccountDeletion(): Promise<AccountDeletionRequest> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_account_deletion");
  if (error) throw error;
  return mapRow(data);
}

/** Desiste dentro del plazo. false si no había nada que desistir. */
export async function cancelAccountDeletion(): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cancel_account_deletion");
  if (error) throw error;
  return data;
}

/** Buckets cuyos archivos van por carpeta de clínica ({clinic_id}/…). */
const CLINIC_BUCKETS = ["signatures", DOCUMENTS_BUCKET] as const;
const REMOVE_BATCH = 100;

type AdminClient = ReturnType<typeof createAdminClient>;

/** Borra todos los archivos de la clínica en un bucket. Lanza si Storage falla. */
async function purgeClinicFolder(admin: AdminClient, bucket: string, clinicId: string): Promise<number> {
  const objects = await listBucketObjects(admin, `${clinicId}/`, bucket);
  let deleted = 0;
  for (let i = 0; i < objects.length; i += REMOVE_BATCH) {
    const batch = objects.slice(i, i + REMOVE_BATCH).map((o) => o.path);
    const { data, error } = await admin.storage.from(bucket).remove(batch);
    if (error) throw error;
    deleted += data?.length ?? 0;
  }
  return deleted;
}

/**
 * Impide que los usuarios de la clínica vuelvan a entrar. Los platform admins se
 * excluyen: perderían el acceso a la consola de toda la plataforma.
 */
async function banClinicUsers(admin: AdminClient, clinicId: string): Promise<number> {
  const [{ data: users, error }, { data: platformAdmins, error: paError }] = await Promise.all([
    admin.from("users").select("id").eq("clinic_id", clinicId),
    admin.from("platform_admins").select("user_id"),
  ]);
  if (error) throw error;
  if (paError) throw paError;
  const exempt = new Set((platformAdmins ?? []).map((p) => p.user_id));

  let banned = 0;
  for (const { id } of users ?? []) {
    if (exempt.has(id)) continue;
    // ~100 años: Supabase no tiene un baneo "para siempre".
    const { error: banError } = await admin.auth.admin.updateUserById(id, { ban_duration: "876000h" });
    if (banError) throw banError;
    banned += 1;
  }
  return banned;
}

export interface AccountDeletionRun {
  due: number;
  executed: number;
  failed: number;
}

/**
 * Ejecuta las solicitudes vencidas (cron diario). Por cada una, en este orden:
 *  1. borra los archivos de la clínica en Storage (firmas y documentos de
 *     verificación): desde SQL quedarían huérfanos;
 *  2. bloquea el acceso de sus usuarios;
 *  3. suprime los datos en una sola transacción (execute_account_deletion), que
 *     es lo último porque cierra la solicitud.
 * Si un paso falla, la solicitud sigue abierta y se reintenta al día siguiente:
 * los tres pasos son idempotentes. Vencido el plazo ya no se puede desistir
 * (cancel_account_deletion), así que nada cambia entre la lectura y el borrado.
 */
export async function runDueAccountDeletions(now: Date = new Date()): Promise<AccountDeletionRun> {
  const admin = createAdminClient();
  const { data: due, error } = await admin
    .from("account_deletion_requests")
    .select("id, clinic_id")
    .is("cancelled_at", null)
    .is("executed_at", null)
    .lte("scheduled_for", now.toISOString());
  if (error) throw error;

  const run: AccountDeletionRun = { due: due?.length ?? 0, executed: 0, failed: 0 };

  for (const request of due ?? []) {
    try {
      let filesDeleted = 0;
      for (const bucket of CLINIC_BUCKETS) {
        filesDeleted += await purgeClinicFolder(admin, bucket, request.clinic_id);
      }

      const banned = await banClinicUsers(admin, request.clinic_id);

      const { data: patients, error: execError } = await admin.rpc("execute_account_deletion", {
        p_request: request.id,
      });
      if (execError) throw execError;

      run.executed += 1;
      logger.info("account_deletion.executed", {
        requestId: request.id,
        clinicId: request.clinic_id,
        patients,
        filesDeleted,
        banned,
      });
    } catch (err) {
      run.failed += 1;
      logger.error("account_deletion.failed", { requestId: request.id, clinicId: request.clinic_id, error: err });
    }
  }
  return run;
}

/** Plazo de la Política para la cuenta del profesional tras eliminarla (0063). */
export const IDENTITY_RETENTION_YEARS = 2;

export interface IdentityPurgeRun {
  clinics: number;
  usersDeleted: number;
  failed: number;
}

/**
 * Suprime la identificación de las clínicas eliminadas hace más de 2 años
 * (Política de Tratamiento, sección 5: "Cuenta del profesional: mientras esté
 * vigente la relación, más 2 años"). La base anonimiza a los usuarios y borra
 * sus aceptaciones (purge_deleted_account_identity); aquí se borran sus cuentas
 * de acceso, que arrastran las filas de `users`. Si un borrado falla, la
 * clínica vuelve a aparecer mañana con los usuarios que le queden.
 */
export async function purgeExpiredAccountIdentities(now: Date = new Date()): Promise<IdentityPurgeRun> {
  const admin = createAdminClient();
  const cutoff = new Date(now);
  cutoff.setFullYear(cutoff.getFullYear() - IDENTITY_RETENTION_YEARS);

  const { data: clinics, error } = await admin
    .from("clinics")
    .select("id")
    .not("deleted_at", "is", null)
    .lte("deleted_at", cutoff.toISOString());
  if (error) throw error;

  const run: IdentityPurgeRun = { clinics: 0, usersDeleted: 0, failed: 0 };
  for (const { id: clinicId } of clinics ?? []) {
    try {
      const { data: userIds, error: rpcError } = await admin.rpc("purge_deleted_account_identity", {
        p_clinic: clinicId,
      });
      if (rpcError) throw rpcError;
      if (!userIds?.length) continue;

      run.clinics += 1;
      for (const userId of userIds) {
        const { error: delError } = await admin.auth.admin.deleteUser(userId);
        if (delError) throw delError;
        run.usersDeleted += 1;
      }
      logger.info("account_identity.purged", { clinicId, users: userIds.length });
    } catch (err) {
      run.failed += 1;
      logger.error("account_identity.purge_failed", { clinicId, error: err });
    }
  }
  return run;
}

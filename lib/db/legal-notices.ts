import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEmailProvider } from "@/lib/email/providers";
import { buildLegalNoticeEmail } from "@/lib/email/templates";
import { appBaseUrl } from "@/lib/app-url";
import { formatLongDate } from "@/lib/dates";
import { logger } from "@/lib/logger";

export interface LegalNotice {
  id: string;
  title: string;
  body: string;
  effectiveAt: string;
  createdAt: string;
  emailedAt: string | null;
  emailedCount: number | null;
}

interface Row {
  id: string;
  title: string;
  body: string;
  effective_at: string;
  created_at: string;
  emailed_at: string | null;
  emailed_count: number | null;
}

const COLUMNS = "id, title, body, effective_at, created_at, emailed_at, emailed_count";

function mapRow(r: Row): LegalNotice {
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    effectiveAt: r.effective_at,
    createdAt: r.created_at,
    emailedAt: r.emailed_at,
    emailedCount: r.emailed_count,
  };
}

/** Avisos aún no vigentes: los que se muestran en la app. */
export async function listUpcomingLegalNotices(): Promise<LegalNotice[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("legal_notices")
    .select(COLUMNS)
    .gt("effective_at", new Date().toISOString())
    .order("effective_at");
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

/** Todos, del más reciente al más antiguo (consola del admin de plataforma). */
export async function listLegalNotices(): Promise<LegalNotice[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("legal_notices")
    .select(COLUMNS)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

/** Solo el admin de plataforma (RLS). La antelación la valida quien llama. */
export async function createLegalNotice(input: {
  title: string;
  body: string;
  effectiveAt: string;
  createdBy: string;
}): Promise<LegalNotice> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("legal_notices")
    .insert({
      title: input.title,
      body: input.body,
      effective_at: input.effectiveAt,
      created_by: input.createdBy,
    })
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return mapRow(data);
}

type AdminClient = ReturnType<typeof createAdminClient>;
const PAGE_SIZE = 500;

/**
 * Personal de las clínicas activas (sin pacientes ni clínicas eliminadas).
 * Paginado por id: PostgREST corta cada respuesta en max_rows (1000) sin avisar,
 * y una lista truncada dejaría a parte del personal sin el aviso.
 */
async function listNoticeRecipients(admin: AdminClient): Promise<{ id: string; email: string; full_name: string }[]> {
  const out: { id: string; email: string; full_name: string }[] = [];
  let lastId: string | null = null;
  for (;;) {
    let query = admin
      .from("users")
      .select("id, email, full_name, clinic:clinics!users_clinic_id_fkey!inner(deleted_at)")
      .in("role", ["admin", "doctor", "secretaria"])
      .is("clinic.deleted_at", null);
    if (lastId) query = query.gt("id", lastId);
    const { data, error } = await query.order("id").limit(PAGE_SIZE);
    if (error) throw error;
    if (!data || data.length === 0) return out;
    for (const r of data) out.push({ id: r.id, email: r.email, full_name: r.full_name });
    lastId = data[data.length - 1].id;
  }
}

/**
 * Envía el aviso por correo a todo el personal de las clínicas activas, una
 * sola vez, y guarda la constancia (fecha y número de envíos aceptados). Lo
 * llama solo el admin de plataforma; escribe con service-role porque la
 * constancia no la edita nadie desde la app.
 */
export async function emailLegalNotice(id: string): Promise<{ sent: number; failed: number }> {
  const admin = createAdminClient();
  const { data: notice, error } = await admin.from("legal_notices").select(COLUMNS).eq("id", id).single();
  if (error) throw error;
  if (notice.emailed_at) throw new Error("Este aviso ya se envió por correo.");

  const recipients = await listNoticeRecipients(admin);

  const mailer = getEmailProvider();
  const effective = formatLongDate(notice.effective_at);
  let sent = 0;
  let failed = 0;
  for (const r of recipients) {
    try {
      await mailer.send(
        buildLegalNoticeEmail({
          to: r.email,
          name: r.full_name,
          title: notice.title,
          body: notice.body,
          effectiveDate: effective,
          documentsUrl: `${appBaseUrl()}/vinculacion-profesional`,
        }),
      );
      sent += 1;
    } catch (err) {
      failed += 1;
      logger.error("legal_notice.email_failed", { noticeId: id, error: err });
    }
  }

  const { error: uError } = await admin
    .from("legal_notices")
    .update({ emailed_at: new Date().toISOString(), emailed_count: sent })
    .eq("id", id);
  if (uError) throw uError;
  return { sent, failed };
}

-- ============================================================================
-- Storage: buckets privados para firmas de consentimiento y PDFs de reportes
-- Convención de ruta: {clinic_id}/{archivo}  → RLS por clínica.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('signatures', 'signatures', false),
       ('reports', 'reports', false)
on conflict (id) do nothing;

-- Firmas
create policy "signatures_select" on storage.objects for select to authenticated
  using (bucket_id = 'signatures' and (storage.foldername(name))[1] = public.auth_clinic_id()::text);
create policy "signatures_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'signatures' and (storage.foldername(name))[1] = public.auth_clinic_id()::text);

-- Reportes (PDF)
create policy "reports_select" on storage.objects for select to authenticated
  using (bucket_id = 'reports' and (storage.foldername(name))[1] = public.auth_clinic_id()::text);
create policy "reports_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'reports' and (storage.foldername(name))[1] = public.auth_clinic_id()::text);
create policy "reports_update" on storage.objects for update to authenticated
  using (bucket_id = 'reports' and (storage.foldername(name))[1] = public.auth_clinic_id()::text);

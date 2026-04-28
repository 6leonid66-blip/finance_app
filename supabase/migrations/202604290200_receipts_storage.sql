-- Receipt attachments: metadata on transactions + Storage bucket and policies.

alter table public.transactions
  add column if not exists receipt_path text,
  add column if not exists receipt_filename text,
  add column if not exists receipt_mime_type text,
  add column if not exists receipt_size_bytes integer;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', true, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Members can view receipt files" on storage.objects;
create policy "Members can view receipt files"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'receipts'
    and exists (
      select 1
      from public.household_members hm
      where hm.household_id::text = (storage.foldername(name))[1]
        and hm.user_id = auth.uid()
    )
  );

drop policy if exists "Members can upload receipt files" on storage.objects;
create policy "Members can upload receipt files"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'receipts'
    and exists (
      select 1
      from public.household_members hm
      where hm.household_id::text = (storage.foldername(name))[1]
        and hm.user_id = auth.uid()
    )
  );

drop policy if exists "Members can update receipt files" on storage.objects;
create policy "Members can update receipt files"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'receipts'
    and exists (
      select 1
      from public.household_members hm
      where hm.household_id::text = (storage.foldername(name))[1]
        and hm.user_id = auth.uid()
    )
  )
  with check (
    bucket_id = 'receipts'
    and exists (
      select 1
      from public.household_members hm
      where hm.household_id::text = (storage.foldername(name))[1]
        and hm.user_id = auth.uid()
    )
  );

drop policy if exists "Members can delete receipt files" on storage.objects;
create policy "Members can delete receipt files"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'receipts'
    and exists (
      select 1
      from public.household_members hm
      where hm.household_id::text = (storage.foldername(name))[1]
        and hm.user_id = auth.uid()
    )
  );


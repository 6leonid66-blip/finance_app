-- Ensure household creation uses DB auth.uid() and stable insert policy.

alter table public.households
  alter column created_by set default auth.uid();

drop policy if exists "Authenticated can create own household" on public.households;

create policy "Authenticated can create household"
  on public.households
  for insert
  to authenticated
  with check (created_by = auth.uid());


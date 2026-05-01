-- Read peer profiles using auth_user_in_household only (no self-join on household_members).
-- Avoids subtle RLS interaction when listing co-members after 202604302100.

drop policy if exists "Profiles can read household profiles" on public.profiles;

create policy "Profiles can read household profiles"
  on public.profiles
  for select
  to authenticated
  using (
    auth.uid() = id
    or exists (
      select 1
      from public.household_members hm_peer
      where hm_peer.user_id = profiles.id
        and public.auth_user_in_household(hm_peer.household_id)
    )
  );

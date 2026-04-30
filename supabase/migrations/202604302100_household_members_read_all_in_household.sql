-- Allow each member to SELECT all rows in their household (peers), without RLS recursion.
-- Previously 202604290045 limited SELECT to own row only — the app could not list co-members / profiles.

create or replace function public.auth_user_in_household(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.household_id = p_household_id
      and hm.user_id = auth.uid()
  );
$$;

grant execute on function public.auth_user_in_household(uuid) to authenticated;

drop policy if exists "Users can read own membership" on public.household_members;

create policy "Members can read household_members in their household"
  on public.household_members
  for select
  to authenticated
  using (public.auth_user_in_household(household_id));

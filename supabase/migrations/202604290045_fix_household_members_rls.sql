-- Fix household_members RLS recursion risk by simplifying select policy.
-- App flow only needs each user to read its own membership row.

drop policy if exists "Members can read household membership" on public.household_members;

create policy "Users can read own membership"
  on public.household_members
  for select
  to authenticated
  using (auth.uid() = user_id);


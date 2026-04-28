-- Robust bootstrap RPC to avoid client-side RLS race during first household creation.

create or replace function public.bootstrap_household(p_name text default 'הבית שלנו')
returns table (household_id uuid, household_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_household_id uuid;
begin
  select hm.household_id
    into v_household_id
  from public.household_members hm
  where hm.user_id = auth.uid()
  order by hm.created_at asc
  limit 1;

  if v_household_id is null then
    insert into public.households (name, created_by)
    values (coalesce(nullif(trim(p_name), ''), 'הבית שלנו'), auth.uid())
    returning id into v_household_id;

    insert into public.household_members (household_id, user_id, role)
    values (v_household_id, auth.uid(), 'owner')
    on conflict (household_id, user_id) do nothing;
  end if;

  return query
  select h.id, h.name
  from public.households h
  where h.id = v_household_id;
end;
$$;

grant execute on function public.bootstrap_household(text) to authenticated;


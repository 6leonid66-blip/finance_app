-- Allow a signed-in user to join/switch household by code (household UUID).
-- This helps connect the second account to the same family household.

create or replace function public.join_household_by_code(p_household_code text)
returns table (out_household_id uuid, out_household_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_household uuid;
begin
  begin
    v_target_household := p_household_code::uuid;
  exception
    when others then
      raise exception 'קוד בית לא תקין';
  end;

  if not exists (select 1 from public.households h where h.id = v_target_household) then
    raise exception 'לא נמצא בית עם הקוד שסופק';
  end if;

  insert into public.household_members (household_id, user_id, role)
  values (v_target_household, auth.uid(), 'member')
  on conflict (user_id)
  do update
    set household_id = excluded.household_id,
        role = excluded.role;

  return query
  select h.id, h.name
  from public.households h
  where h.id = v_target_household;
end;
$$;

grant execute on function public.join_household_by_code(text) to authenticated;

-- Members can set the shared household display name (no broad UPDATE on households).

create or replace function public.rename_household(p_household_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trim text := trim(p_name);
begin
  if v_trim is null or length(v_trim) = 0 then
    raise exception 'שם הבית לא יכול להיות ריק';
  end if;
  if length(v_trim) > 120 then
    raise exception 'שם הבית ארוך מדי (עד 120 תווים)';
  end if;

  if not exists (
    select 1
    from public.household_members hm
    where hm.household_id = p_household_id
      and hm.user_id = auth.uid()
  ) then
    raise exception 'אין הרשאה לעדכן את הבית';
  end if;

  update public.households
  set name = v_trim
  where id = p_household_id;
end;
$$;

grant execute on function public.rename_household(uuid, text) to authenticated;

-- Two personal "חשבון שלי" rows were impossible: unique (household_id, name) blocked a second owner from the same pocket name.
-- Fix: drop that constraint; enforce at most one ACTIVE personal row per (household, owner).
-- Plus RPC so every household_members user gets a חשבון שלי row automatically (even נתונים 0).

alter table public.financial_accounts
  drop constraint if exists financial_accounts_household_id_name_key;

create unique index if not exists financial_accounts_household_owner_active_uidx
  on public.financial_accounts (household_id, owner_user_id)
  where owner_user_id is not null and active = true;

create or replace function public.ensure_personal_accounts_for_household(p_household_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.auth_user_in_household(p_household_id) then
    raise exception 'אין הרשאה לבית זה';
  end if;

  insert into public.financial_accounts (household_id, owner_user_id, name, is_shared, active)
  select p_household_id, hm.user_id, 'חשבון שלי'::text, false, true
  from public.household_members hm
  where hm.household_id = p_household_id
    and not exists (
      select 1
      from public.financial_accounts fa
      where fa.household_id = p_household_id
        and fa.owner_user_id is not distinct from hm.user_id
        and fa.active = true
    );
end;
$$;

grant execute on function public.ensure_personal_accounts_for_household(uuid) to authenticated;

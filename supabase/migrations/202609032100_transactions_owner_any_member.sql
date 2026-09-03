-- Allow assigning a transaction to any household member, not only the signed-in user.

drop policy if exists "Members can insert transactions" on public.transactions;

create policy "Members can insert transactions"
  on public.transactions
  for insert
  to authenticated
  with check (
    public.auth_user_in_household(household_id)
    and exists (
      select 1
      from public.household_members hm
      where hm.household_id = transactions.household_id
        and hm.user_id = owner_id
    )
    and (
      account_id is null
      or exists (
        select 1
        from public.financial_accounts fa
        where fa.id = transactions.account_id
          and fa.household_id = transactions.household_id
      )
    )
  );

drop policy if exists "Members can update transactions" on public.transactions;

create policy "Members can update transactions"
  on public.transactions
  for update
  to authenticated
  using (public.auth_user_in_household(household_id))
  with check (
    public.auth_user_in_household(household_id)
    and exists (
      select 1
      from public.household_members hm
      where hm.household_id = transactions.household_id
        and hm.user_id = owner_id
    )
    and (
      account_id is null
      or exists (
        select 1
        from public.financial_accounts fa
        where fa.id = transactions.account_id
          and fa.household_id = transactions.household_id
      )
    )
  );

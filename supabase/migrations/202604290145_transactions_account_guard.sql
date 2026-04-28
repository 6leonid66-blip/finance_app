-- Enforce that selected account belongs to the same household.

drop policy if exists "Members can insert transactions" on public.transactions;

create policy "Members can insert transactions"
  on public.transactions
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.household_members hm
      where hm.household_id = transactions.household_id
        and hm.user_id = auth.uid()
    )
    and auth.uid() = owner_id
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
  using (
    exists (
      select 1
      from public.household_members hm
      where hm.household_id = transactions.household_id
        and hm.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.household_members hm
      where hm.household_id = transactions.household_id
        and hm.user_id = auth.uid()
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


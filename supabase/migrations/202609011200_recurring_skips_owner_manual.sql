-- Recurring engine v2:
-- 1. Per-month skips that survive re-sync
-- 2. Template owner (personal vs shared) so auto-posts land on the right person
-- 3. manually_edited on transactions so user edits are not overwritten
-- 4. Auto-post uses Asia/Jerusalem for "current month" and respects skips / manual edits

alter table public.transactions
  add column if not exists manually_edited boolean not null default false;

alter table public.recurring_templates
  add column if not exists owner_user_id uuid references auth.users (id) on delete set null;

create table if not exists public.recurring_skips (
  household_id uuid not null references public.households (id) on delete cascade,
  template_id uuid not null references public.recurring_templates (id) on delete cascade,
  skip_month date not null,
  created_at timestamptz not null default now(),
  primary key (template_id, skip_month)
);

create index if not exists idx_recurring_skips_household_month
  on public.recurring_skips (household_id, skip_month);

alter table public.recurring_skips enable row level security;

drop policy if exists "recurring_skips_select_member" on public.recurring_skips;
create policy "recurring_skips_select_member"
  on public.recurring_skips
  for select
  using (
    exists (
      select 1 from public.household_members hm
      where hm.household_id = recurring_skips.household_id
        and hm.user_id = auth.uid()
    )
  );

drop policy if exists "recurring_skips_write_member" on public.recurring_skips;
create policy "recurring_skips_write_member"
  on public.recurring_skips
  for all
  using (
    exists (
      select 1 from public.household_members hm
      where hm.household_id = recurring_skips.household_id
        and hm.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.household_members hm
      where hm.household_id = recurring_skips.household_id
        and hm.user_id = auth.uid()
    )
  );

create or replace function public.ensure_auto_post_transactions_from_templates(
  p_household uuid,
  p_month date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  month_income numeric(12, 2);
  month_expense numeric(12, 2);
  tx_amount numeric(12, 2);
  first_member uuid;
  row_owner uuid;
  row_account uuid;
  current_month_start date := date_trunc('month', (now() at time zone 'Asia/Jerusalem'))::date;
begin
  if p_month < current_month_start then
    return;
  end if;

  select hm.user_id
    into first_member
  from public.household_members hm
  where hm.household_id = p_household
  order by hm.created_at
  limit 1;

  if first_member is null then
    return;
  end if;

  -- Cleanup: drop p_month auto-post rows that are no longer eligible,
  -- including templates skipped for this month. Never touch manually_edited rows.
  delete from public.transactions tx
  where tx.household_id = p_household
    and tx.auto_post_month = p_month
    and tx.auto_post_template_id is not null
    and coalesce(tx.manually_edited, false) = false
    and (
      exists (
        select 1
        from public.recurring_skips sk
        where sk.template_id = tx.auto_post_template_id
          and sk.skip_month = p_month
      )
      or not exists (
        select 1
        from public.recurring_templates rt
        where rt.id = tx.auto_post_template_id
          and rt.household_id = p_household
          and rt.active = true
          and p_month >= rt.template_start_month
          and (
            rt.end_rule = 'unlimited'
            or (rt.end_rule = 'until_month' and p_month <= rt.end_month)
            or (
              rt.end_rule = 'fixed_installments'
              and (
                (extract(year from age(p_month::timestamp, rt.template_start_month::timestamp)) * 12)
                + extract(month from age(p_month::timestamp, rt.template_start_month::timestamp))
              )::integer + 1 <= rt.max_installments
            )
          )
      )
    );

  for r in
    select *
    from public.recurring_templates rt
    where rt.household_id = p_household
      and rt.active = true
      and p_month >= rt.template_start_month
      and (
        rt.end_rule = 'unlimited'
        or (rt.end_rule = 'until_month' and p_month <= rt.end_month)
        or (
          rt.end_rule = 'fixed_installments'
          and (
            (
              (extract(year from age(p_month::timestamp, rt.template_start_month::timestamp)) * 12)
              + extract(month from age(p_month::timestamp, rt.template_start_month::timestamp))
            )::integer + 1
          ) <= rt.max_installments
        )
      )
      and not exists (
        select 1
        from public.recurring_skips sk
        where sk.template_id = rt.id
          and sk.skip_month = p_month
      )
  loop
    tx_amount := 0;
    if r.mode = 'fixed_amount' then
      tx_amount := coalesce(r.default_amount, 0);
    else
      select mp.planned_income, mp.planned_expense
        into month_income, month_expense
      from public.monthly_plans mp
      where mp.household_id = p_household
        and mp.month_date = p_month
        and mp.category = r.category
      limit 1;

      if r.direction = 'income' then
        tx_amount := coalesce(month_income, 0);
      else
        tx_amount := coalesce(month_expense, 0);
      end if;
    end if;

    tx_amount := abs(tx_amount);

    if tx_amount <= 0 then
      delete from public.transactions tx
      where tx.household_id = p_household
        and tx.auto_post_template_id = r.id
        and tx.auto_post_month = p_month
        and coalesce(tx.manually_edited, false) = false;
      continue;
    end if;

    row_owner := coalesce(r.owner_user_id, first_member);

    if r.owner_user_id is not null then
      select fa.id
        into row_account
      from public.financial_accounts fa
      where fa.household_id = p_household
        and fa.active = true
        and fa.owner_user_id = r.owner_user_id
        and fa.is_shared = false
      order by fa.created_at asc
      limit 1;
    else
      select fa.id
        into row_account
      from public.financial_accounts fa
      where fa.household_id = p_household
        and fa.active = true
        and fa.is_shared = true
      order by fa.created_at asc
      limit 1;
    end if;

    if row_account is null then
      select fa.id
        into row_account
      from public.financial_accounts fa
      where fa.household_id = p_household
        and fa.active = true
      order by fa.is_shared desc, fa.created_at asc
      limit 1;
    end if;

    insert into public.transactions (
      household_id,
      owner_id,
      account_id,
      auto_post_template_id,
      auto_post_month,
      type,
      amount,
      category,
      note,
      occurred_on,
      planned,
      manually_edited
    )
    values (
      p_household,
      row_owner,
      row_account,
      r.id,
      p_month,
      case when r.direction = 'income' then 'income'::public.transaction_type else 'expense'::public.transaction_type end,
      tx_amount,
      r.category,
      coalesce(r.label, 'נוצר אוטומטית מקבוע'),
      p_month,
      false,
      false
    )
    on conflict (household_id, auto_post_template_id, auto_post_month) do update set
      type = excluded.type,
      amount = excluded.amount,
      category = excluded.category,
      note = excluded.note,
      planned = false,
      owner_id = excluded.owner_id
    where coalesce(public.transactions.manually_edited, false) = false;
  end loop;
end;
$$;

grant execute on function public.ensure_auto_post_transactions_from_templates(uuid, date) to authenticated;
grant select, insert, delete, update on public.recurring_skips to authenticated;

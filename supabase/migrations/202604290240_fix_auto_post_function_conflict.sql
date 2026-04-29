-- Avoid ON CONFLICT inference errors when unique index is missing/not yet migrated.
-- Uses explicit NOT EXISTS guard per template+month.

create or replace function public.ensure_auto_post_transactions_from_templates(p_household uuid, p_month date)
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
  target_owner uuid;
  target_account uuid;
begin
  select hm.user_id
    into target_owner
  from public.household_members hm
  where hm.household_id = p_household
  order by hm.created_at
  limit 1;

  if target_owner is null then
    return;
  end if;

  select fa.id
    into target_account
  from public.financial_accounts fa
  where fa.household_id = p_household
    and fa.active = true
  order by fa.is_shared desc, fa.created_at asc
  limit 1;

  for r in
    select *
    from public.recurring_templates rt
    where rt.household_id = p_household
      and rt.active = true
      and rt.auto_post_as_actual = true
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

    if tx_amount <= 0 then
      continue;
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
      planned
    )
    select
      p_household,
      target_owner,
      target_account,
      r.id,
      p_month,
      case when r.direction = 'income' then 'income'::public.transaction_type else 'expense'::public.transaction_type end,
      tx_amount,
      r.category,
      coalesce(r.label, 'נוצר אוטומטית מקבוע'),
      p_month,
      false
    where not exists (
      select 1
      from public.transactions t
      where t.household_id = p_household
        and t.auto_post_template_id = r.id
        and t.auto_post_month = p_month
    );
  end loop;
end;
$$;

grant execute on function public.ensure_auto_post_transactions_from_templates(uuid, date) to authenticated;


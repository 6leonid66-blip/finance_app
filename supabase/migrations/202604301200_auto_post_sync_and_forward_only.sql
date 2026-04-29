-- Make recurring auto-post pipeline forward-only AND keep the current month
-- in sync with the latest template state.
--
-- Why:
-- 1. Forward-only invariant: editing/creating a recurring template must NEVER
--    insert, update, or delete auto-posted transactions in past months.
--    Past months reflect what actually happened and must stay frozen.
-- 2. Current-month sync: the previous function used an explicit
--    `WHERE NOT EXISTS` guard, so once an auto-post row existed for
--    (template, month) the function silently skipped it. That meant editing
--    the template (amount/category/label/direction) did NOT update the
--    current-month row. Now we UPSERT so the current month always reflects
--    the latest template values. If the user manually edited the row's
--    occurred_on (date), we preserve that.
-- 3. Cleanup of stale current/future rows: if a template gets deactivated,
--    auto_post_as_actual is turned off, the end_month is moved into the past,
--    template_start_month is moved into the future, or the variable plan
--    drops to 0, the corresponding row in the *current/future* month must be
--    deleted. We DELETE such rows up-front, scoped to p_month only, so past
--    months are never touched.
-- 4. Hard de-duplication: the unique index
--    idx_transactions_auto_post_unique_full guarantees at most one auto-post
--    per (household, template, month). The UPSERT path uses ON CONFLICT to
--    update in place. No path produces a duplicate.

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
  target_owner uuid;
  target_account uuid;
  current_month_start date := date_trunc('month', (now() at time zone 'utc'))::date;
begin
  -- Forward-only invariant: never modify past months.
  -- Past auto-post rows reflect history and must remain frozen.
  if p_month < current_month_start then
    return;
  end if;

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

  -- Cleanup: drop p_month auto-post rows whose template is no longer eligible
  -- (deactivated, auto_post_as_actual=false, end_month moved past p_month,
  -- template_start_month moved past p_month, fixed_installments exhausted,
  -- or template no longer exists in this household).
  -- Scope is strictly p_month, so past months are never affected.
  delete from public.transactions tx
  where tx.household_id = p_household
    and tx.auto_post_month = p_month
    and tx.auto_post_template_id is not null
    and not exists (
      select 1
      from public.recurring_templates rt
      where rt.id = tx.auto_post_template_id
        and rt.household_id = p_household
        and rt.active = true
        and rt.auto_post_as_actual = true
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
    );

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

    -- Always store as a positive number; direction is encoded in `type`.
    tx_amount := abs(tx_amount);

    if tx_amount <= 0 then
      -- Variable budget collapsed to 0 (or no plan row): make sure no stale
      -- p_month auto-post row hangs around.
      delete from public.transactions tx
      where tx.household_id = p_household
        and tx.auto_post_template_id = r.id
        and tx.auto_post_month = p_month;
      continue;
    end if;

    -- UPSERT: insert if missing, otherwise update template-driven fields so
    -- that an edit to the template propagates to the current month.
    -- We deliberately keep the existing occurred_on and account_id on update
    -- so that user-side adjustments (e.g. picking the actual payment day or
    -- moving the row to a different account) are not clobbered.
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
    values (
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
    )
    on conflict (household_id, auto_post_template_id, auto_post_month) do update set
      type = excluded.type,
      amount = excluded.amount,
      category = excluded.category,
      note = excluded.note,
      planned = false;
  end loop;
end;
$$;

grant execute on function public.ensure_auto_post_transactions_from_templates(uuid, date) to authenticated;

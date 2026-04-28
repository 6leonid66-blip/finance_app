-- Extend recurring templates with end controls:
-- 1) unlimited
-- 2) until specific month
-- 3) fixed installments count

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'recurring_end_rule'
      and n.nspname = 'public'
  ) then
    create type public.recurring_end_rule as enum ('unlimited', 'until_month', 'fixed_installments');
  end if;
end $$;

alter table public.recurring_templates
  add column if not exists template_start_month date not null default date_trunc('month', now())::date,
  add column if not exists end_rule public.recurring_end_rule not null default 'unlimited',
  add column if not exists end_month date,
  add column if not exists max_installments integer;

alter table public.recurring_templates
  drop constraint if exists recurring_templates_end_rule_check;

alter table public.recurring_templates
  add constraint recurring_templates_end_rule_check
  check (
    (end_rule = 'unlimited' and end_month is null and max_installments is null)
    or (end_rule = 'until_month' and end_month is not null and max_installments is null)
    or (end_rule = 'fixed_installments' and end_month is null and max_installments is not null and max_installments > 0)
  );

create or replace function public.ensure_month_plans_from_templates(p_household uuid, p_month date)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  r record;
  prev_month date := (p_month - interval '1 month')::date;
  prev_income numeric(12, 2);
  prev_expense numeric(12, 2);
  month_offset integer;
begin
  for r in
    select *
    from public.recurring_templates
    where household_id = p_household
      and active = true
      and p_month >= template_start_month
      and (
        end_rule = 'unlimited'
        or (end_rule = 'until_month' and p_month <= end_month)
        or (
          end_rule = 'fixed_installments'
          and (
            (
              (extract(year from age(p_month::timestamp, template_start_month::timestamp)) * 12)
              + extract(month from age(p_month::timestamp, template_start_month::timestamp))
            )::integer + 1
          ) <= max_installments
        )
      )
  loop
    if r.mode = 'fixed_amount' then
      insert into public.monthly_plans (household_id, month_date, category, planned_income, planned_expense)
      values (
        p_household,
        p_month,
        r.category,
        case when r.direction = 'income' then r.default_amount else 0 end,
        case when r.direction = 'expense' then r.default_amount else 0 end
      )
      on conflict (household_id, month_date, category)
      do update set
        planned_income = case
          when r.direction = 'income' then r.default_amount
          else monthly_plans.planned_income
        end,
        planned_expense = case
          when r.direction = 'expense' then r.default_amount
          else monthly_plans.planned_expense
        end;
    else
      prev_income := 0;
      prev_expense := 0;
      select mp.planned_income, mp.planned_expense
        into prev_income, prev_expense
      from public.monthly_plans mp
      where mp.household_id = p_household
        and mp.month_date = prev_month
        and mp.category = r.category;

      if not found then
        prev_income := 0;
        prev_expense := 0;
      end if;

      insert into public.monthly_plans (household_id, month_date, category, planned_income, planned_expense)
      values (
        p_household,
        p_month,
        r.category,
        case when r.direction = 'income' then coalesce(prev_income, 0) else 0 end,
        case when r.direction = 'expense' then coalesce(prev_expense, 0) else 0 end
      )
      on conflict (household_id, month_date, category) do nothing;
    end if;
  end loop;
end;
$$;


-- Recurring budget templates -> materialize into monthly_plans per month

create type public.recurring_direction as enum ('income', 'expense');
create type public.recurring_mode as enum ('fixed_amount', 'variable_budget');

create table if not exists public.recurring_templates (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  direction public.recurring_direction not null,
  category text not null,
  label text,
  mode public.recurring_mode not null,
  default_amount numeric(12, 2) not null default 0 check (default_amount >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_recurring_templates_household
  on public.recurring_templates (household_id)
  where active = true;

alter table public.recurring_templates enable row level security;

create policy "Members can read recurring templates"
  on public.recurring_templates
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.household_members hm
      where hm.household_id = recurring_templates.household_id
        and hm.user_id = auth.uid()
    )
  );

create policy "Members can insert recurring templates"
  on public.recurring_templates
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.household_members hm
      where hm.household_id = recurring_templates.household_id
        and hm.user_id = auth.uid()
    )
  );

create policy "Members can update recurring templates"
  on public.recurring_templates
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.household_members hm
      where hm.household_id = recurring_templates.household_id
        and hm.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.household_members hm
      where hm.household_id = recurring_templates.household_id
        and hm.user_id = auth.uid()
    )
  );

create policy "Members can delete recurring templates"
  on public.recurring_templates
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.household_members hm
      where hm.household_id = recurring_templates.household_id
        and hm.user_id = auth.uid()
    )
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
begin
  for r in
    select *
    from public.recurring_templates
    where household_id = p_household
      and active = true
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
      -- variable_budget: create row if missing; seed from previous month or 0
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

grant execute on function public.ensure_month_plans_from_templates(uuid, date) to authenticated;

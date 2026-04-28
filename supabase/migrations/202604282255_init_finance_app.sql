create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  full_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.household_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  unique (household_id, user_id),
  unique (user_id)
);

create type public.transaction_type as enum ('income', 'expense');

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  type public.transaction_type not null,
  amount numeric(12, 2) not null check (amount > 0),
  category text not null,
  note text,
  occurred_on date not null,
  planned boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.monthly_plans (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  month_date date not null,
  category text not null,
  planned_income numeric(12, 2) not null default 0,
  planned_expense numeric(12, 2) not null default 0,
  created_at timestamptz not null default now(),
  unique (household_id, month_date, category)
);

create index if not exists idx_transactions_household_date
  on public.transactions (household_id, occurred_on desc);

create index if not exists idx_monthly_plans_household_month
  on public.monthly_plans (household_id, month_date);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, coalesce(new.email, ''));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.transactions enable row level security;
alter table public.monthly_plans enable row level security;

create policy "Profiles can read own profile"
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = id);

create policy "Profiles can upsert own profile"
  on public.profiles
  for all
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "Household members can read household"
  on public.households
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.household_members hm
      where hm.household_id = households.id
        and hm.user_id = auth.uid()
    )
  );

create policy "Authenticated can create own household"
  on public.households
  for insert
  to authenticated
  with check (auth.uid() = created_by);

create policy "Members can read household membership"
  on public.household_members
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.household_members hm
      where hm.household_id = household_members.household_id
        and hm.user_id = auth.uid()
    )
  );

create policy "User can join own account once"
  on public.household_members
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Members can access transactions"
  on public.transactions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.household_members hm
      where hm.household_id = transactions.household_id
        and hm.user_id = auth.uid()
    )
  );

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
  );

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
  );

create policy "Members can delete transactions"
  on public.transactions
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.household_members hm
      where hm.household_id = transactions.household_id
        and hm.user_id = auth.uid()
    )
  );

create policy "Members can access plans"
  on public.monthly_plans
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.household_members hm
      where hm.household_id = monthly_plans.household_id
        and hm.user_id = auth.uid()
    )
  );

create policy "Members can write plans"
  on public.monthly_plans
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.household_members hm
      where hm.household_id = monthly_plans.household_id
        and hm.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.household_members hm
      where hm.household_id = monthly_plans.household_id
        and hm.user_id = auth.uid()
    )
  );
